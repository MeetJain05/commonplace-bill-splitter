import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

describe('concurrent share payments', () => {
  it('accepts only one of two different keys for the same share', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    const path = `/api/bills/${bill.body.id}/shares/${share.id}/pay`

    const [first, second] = await Promise.all([
      call<Share>('POST', path, { headers: { 'Idempotency-Key': 'concurrent-first' } }),
      call<Share>('POST', path, { headers: { 'Idempotency-Key': 'concurrent-second' } }),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    const balances = await call<{ balances: Array<{ outstandingCents: number }> }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )
    expect(balances.body.balances.map((balance) => balance.outstandingCents)).toEqual([0, 500])
  })

  it('returns the original result for two concurrent requests with the same key', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    const path = `/api/bills/${bill.body.id}/shares/${share.id}/pay`
    const headers = { 'Idempotency-Key': 'same-concurrent-key' }

    const [first, second] = await Promise.all([
      call<Share>('POST', path, { headers }),
      call<Share>('POST', path, { headers }),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
  })
})
