import { Hono } from 'hono'

type ShareRow = { id: string; member_id: string; amount_cents: number; paid_at: string | null }
type BillRow = { id: string; home_id: string; title: string; total_cents: number }

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const name = getStringField(body, 'name')
  if (!name) return c.json({ error: 'name must be a non-empty string' }, 422)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const { homeId } = c.req.param()
  const body: unknown = await c.req.json().catch(() => null)
  const name = getStringField(body, 'name')
  if (!name) return c.json({ error: 'name must be a non-empty string' }, 422)
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)
  const member = { id: crypto.randomUUID(), homeId, name }
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(member.id, homeId, name)
    .run()
  return c.json(member, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()
  const body: unknown = await c.req.json().catch(() => null)
  const title = getStringField(body, 'title')
  const totalCents = getNumberField(body, 'totalCents')
  if (!title) return c.json({ error: 'title must be a non-empty string' }, 422)
  if (totalCents === null || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole number' }, 422)
  }
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)
  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) return c.json({ error: 'home has no members' }, 422)

  const billId = crypto.randomUUID()
  const base = Math.floor(totalCents / members.length)
  const remainder = totalCents % members.length
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: base + (index < remainder ? 1 : 0),
    paidAt: null,
  }))
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ]
  await c.env.DB.batch(statements)
  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

// The assignment's page needs to reload bills, so this read endpoint complements bill creation.
app.get('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)
  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY rowid',
  )
    .bind(homeId)
    .all<BillRow>()
  const result = await Promise.all(
    bills.map(async (bill) => {
      const { results } = await c.env.DB.prepare(
        'SELECT id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY rowid',
      )
        .bind(bill.id)
        .all<ShareRow>()
      return {
        id: bill.id,
        homeId: bill.home_id,
        title: bill.title,
        totalCents: bill.total_cents,
        shares: results.map((share) => ({
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        })),
      }
    }),
  )
  return c.json({ bills: result })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const { billId, shareId } = c.req.param()
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
  if (!idempotencyKey) return c.json({ error: 'Idempotency-Key header is required' }, 400)
  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()
  if (!bill) return c.json({ error: 'bill not found' }, 404)
  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow & { idempotency_key: string | null }>()
  if (!share) return c.json({ error: 'share not found' }, 404)

  if (share.paid_at) {
    if (share.idempotency_key !== idempotencyKey)
      return c.json({ error: 'share is already paid' }, 409)
    return c.json(paymentResult(share))
  }

  const paidAt = new Date().toISOString()
  const updated = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, idempotencyKey, shareId)
    .run()
  if (updated.meta.changes === 0) {
    const current = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
    )
      .bind(shareId)
      .first<ShareRow & { idempotency_key: string | null }>()
    if (!current) return c.json({ error: 'share not found' }, 404)
    if (current.idempotency_key !== idempotencyKey)
      return c.json({ error: 'share is already paid' }, 409)
    return c.json(paymentResult(current))
  }
  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const { homeId } = c.req.param()
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)
  const { results } = await c.env.DB.prepare(`
    SELECT m.id AS member_id, m.name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstanding_cents
    FROM members m LEFT JOIN shares s ON s.member_id = m.id
    WHERE m.home_id = ? GROUP BY m.id, m.name ORDER BY m.rowid
  `)
    .bind(homeId)
    .all<{ member_id: string; name: string; outstanding_cents: number }>()
  return c.json({
    balances: results.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      outstandingCents: row.outstanding_cents,
    })),
  })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'internal server error' }, 500)
})

function getStringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !(key in value)) return null
  const field = (value as Record<string, unknown>)[key]
  if (typeof field !== 'string' || field.trim().length === 0) return null
  return field.trim()
}

function getNumberField(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null || !(key in value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' ? field : null
}

function paymentResult(share: ShareRow) {
  return {
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt: share.paid_at,
  }
}

export default app
