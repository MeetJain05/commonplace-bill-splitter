import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }
type Member = { id: string; homeId: string; name: string }
type Balance = { memberId: string; name: string; outstandingCents: number }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

function Home() {
  const [homeId, setHomeId] = useState(
    () => window.localStorage.getItem('bill-splitter-home') ?? '',
  )
  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [title, setTitle] = useState('')
  const [totalCents, setTotalCents] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [loading, setLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async (id: string) => {
    if (!id.trim()) {
      setBills([])
      setBalances([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const [billResult, balanceResult] = await Promise.all([
        request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(id)}/bills`),
        request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(id)}/balances`),
      ])
      setBills(billResult.bills)
      setBalances(balanceResult.balances)
    } catch (cause) {
      setBills([])
      setBalances([])
      setError(cause instanceof Error ? cause.message : 'Could not load this home.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(homeId)
  }, [homeId, refresh])

  async function createHome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await perform(async () => {
      const home = await request<{ id: string; name: string }>('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ name: homeName }),
      })
      setHomeId(home.id)
      window.localStorage.setItem('bill-splitter-home', home.id)
      setHomeName('')
      setNotice(`Created ${home.name}. Add a member to get started.`)
    })
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await perform(async () => {
      const member = await request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ name: memberName }),
      })
      setMemberName('')
      setBalances((current) => [
        ...current,
        { memberId: member.id, name: member.name, outstandingCents: 0 },
      ])
      setNotice(`${member.name} joined the home.`)
    })
  }

  async function createBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await perform(async () => {
      await request<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
        method: 'POST',
        body: JSON.stringify({ title, totalCents: Number(totalCents) }),
      })
      setTitle('')
      setTotalCents('')
      await refresh(homeId)
      setNotice('Bill added and split between the members.')
    })
  }

  async function payShare(billId: string, shareId: string) {
    await perform(async () => {
      await request<Share>(
        `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      )
      await refresh(homeId)
      setNotice('Share marked as paid.')
    })
  }

  async function perform(action: () => Promise<void>) {
    setActionBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/">
          Commonplace
        </a>
        <span className="topbar-note">Shared home expenses</span>
      </header>
      <section className="hero">
        <p className="eyebrow">A calmer way to split the household</p>
        <h1>
          Good homes run
          <br />
          <em>on shared things.</em>
        </h1>
        <p className="hero-copy">
          Keep track of household bills, see what each person owes, and settle up without the
          spreadsheet shuffle.
        </p>
        <div className="hero-mark" aria-hidden="true">
          <span>÷</span>
          <span>+</span>
          <span>✓</span>
        </div>
      </section>

      <section className="workspace" aria-label="Bill splitter workspace">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Your household</p>
            <h2>Bill desk</h2>
          </div>
          {homeId && (
            <span className="home-chip">
              <span className="status-dot" /> Home connected
            </span>
          )}
        </div>
        {error && (
          <div className="banner error-banner" role="alert">
            <span>Something needs attention</span>
            {error}
          </div>
        )}
        {notice && (
          <div className="banner success-banner" role="status">
            {notice}
          </div>
        )}

        <div className="setup-grid">
          <form className="panel form-panel" onSubmit={createHome}>
            <div className="panel-title">
              <span className="step">01</span>
              <div>
                <h3>Create a home</h3>
                <p>Start a shared space.</p>
              </div>
            </div>
            <label htmlFor="home-name">Home name</label>
            <div className="inline-form">
              <input
                id="home-name"
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                placeholder="e.g. Cedar House"
                required
                maxLength={100}
              />
              <button type="submit" disabled={actionBusy}>
                Create
              </button>
            </div>
          </form>
          <form className="panel form-panel" onSubmit={addMember}>
            <div className="panel-title">
              <span className="step">02</span>
              <div>
                <h3>Add a housemate</h3>
                <p>Members share each new bill.</p>
              </div>
            </div>
            <label htmlFor="home-id">
              Home ID <span className="label-hint">(saved in this browser)</span>
            </label>
            <input
              id="home-id"
              value={homeId}
              onChange={(event) => {
                setHomeId(event.target.value)
                window.localStorage.setItem('bill-splitter-home', event.target.value)
              }}
              placeholder="Create a home or paste its ID"
            />
            <label htmlFor="member-name">Member name</label>
            <div className="inline-form">
              <input
                id="member-name"
                value={memberName}
                onChange={(event) => setMemberName(event.target.value)}
                placeholder="e.g. Sam"
                required
                maxLength={100}
              />
              <button type="submit" disabled={!homeId || actionBusy}>
                Add
              </button>
            </div>
          </form>
        </div>

        <div className="content-grid">
          <section className="panel bills-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Activity</p>
                <h3>Household bills</h3>
              </div>
              <span className="count-pill">
                {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
              </span>
            </div>
            <form className="bill-form" onSubmit={createBill}>
              <input
                aria-label="Bill title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Bill name"
                required
                maxLength={100}
              />
              <div className="money-input">
                <span>$</span>
                <input
                  aria-label="Amount in cents"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={totalCents}
                  onChange={(event) => setTotalCents(event.target.value)}
                  placeholder="Amount in cents"
                  required
                />
              </div>
              <button type="submit" disabled={!homeId || actionBusy}>
                Add bill
              </button>
            </form>
            {loading ? (
              <div className="state-block" aria-live="polite">
                <span className="spinner" />
                Loading household bills…
              </div>
            ) : bills.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">↗</div>
                <h4>No bills yet</h4>
                <p>
                  Add your first bill above. It will be split evenly, with leftover cents assigned
                  in member order.
                </p>
              </div>
            ) : (
              <div className="bill-list">
                {bills.map((bill) => (
                  <article className="bill-card" key={bill.id}>
                    <div className="bill-card-head">
                      <div>
                        <h4>{bill.title}</h4>
                        <p>
                          {bill.shares.length} {bill.shares.length === 1 ? 'share' : 'shares'}
                        </p>
                      </div>
                      <strong>{formatMoney(bill.totalCents)}</strong>
                    </div>
                    <ul className="share-list">
                      {bill.shares.map((share) => {
                        const member = balances.find((item) => item.memberId === share.memberId)
                        return (
                          <li key={share.id}>
                            <span className="avatar">
                              {member?.name.slice(0, 1).toUpperCase() ?? '?'}
                            </span>
                            <span className="share-name">{member?.name ?? 'Housemate'}</span>
                            <span className="share-amount">{formatMoney(share.amountCents)}</span>
                            {share.paidAt ? (
                              <span className="paid-tag">Paid</span>
                            ) : (
                              <button
                                type="button"
                                className="pay-button"
                                disabled={actionBusy}
                                onClick={() => void payShare(bill.id, share.id)}
                              >
                                Mark paid
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="panel balance-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">At a glance</p>
                <h3>Outstanding</h3>
              </div>
              <span className="balance-icon">◎</span>
            </div>
            {!homeId ? (
              <p className="muted-message">Create a home or enter a home ID to see balances.</p>
            ) : balances.length === 0 && !loading ? (
              <p className="muted-message">Add housemates to start tracking balances.</p>
            ) : (
              <ul className="balance-list">
                {balances.map((balance) => (
                  <li key={balance.memberId}>
                    <span className="avatar">{balance.name.slice(0, 1).toUpperCase()}</span>
                    <span>{balance.name}</span>
                    <strong>{formatMoney(balance.outstandingCents)}</strong>
                  </li>
                ))}
              </ul>
            )}
            <div className="balance-footnote">
              Amounts are tracked in cents to keep every split precise.
            </div>
          </aside>
        </div>
        <footer className="workspace-footer">
          <span>
            {loading
              ? 'Updating household…'
              : homeId
                ? 'Changes save as you go'
                : 'Create a home to begin'}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => void refresh(homeId)}
            disabled={!homeId || loading}
          >
            Refresh data ↻
          </button>
        </footer>
      </section>
      <footer className="site-footer">
        <span>Commonplace</span>
        <span>Fair shares. Clear heads.</span>
      </footer>
    </main>
  )
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
