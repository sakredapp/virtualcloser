import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { listProspects, type Prospect } from '@/lib/prospects'

export const dynamic = 'force-dynamic'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return s
  }
}

function statusStyle(status: Prospect['status']) {
  switch (status) {
    case 'booked':
      return { background: 'var(--royal-soft)', borderColor: 'var(--royal-ring)', color: 'var(--royal)' }
    case 'won':
      return { background: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.45)', color: '#065f46' }
    case 'canceled':
    case 'lost':
      return { background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#991b1b' }
    default:
      return {}
  }
}

export default async function AdminProspectsPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const prospects = await listProspects(500)

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Prospects</p>
        <h1>Booking CRM</h1>
        <p className="sub">
          Every call booked through Cal.com lands here. Qualify, convert, or mark lost.
        </p>
        <p className="nav">
          <Link href="/admin/clients">← Clients</Link>
          <span>·</span>
          <Link href="https://cal.com/virtualcloser/30min">Cal.com booking page</Link>
          <span>·</span>
          <Link href="/offer">Public offer</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head">
          <h2>Recent bookings</h2>
          <p>{prospects.length}</p>
        </div>

        {prospects.length === 0 ? (
          <p className="empty">
            No bookings yet. Point Cal.com webhooks at{' '}
            <code>/api/cal/webhook</code> (trigger <code>BOOKING_CREATED</code>) to start
            capturing.
          </p>
        ) : (
          <ul className="list">
            {prospects.map((p) => (
              <li key={p.id} className="row">
                <div>
                  <p className="name">
                    {p.name || p.email || 'Unnamed prospect'}
                    {p.tier_interest ? (
                      <span
                        className="status hot"
                        style={{
                          marginLeft: '0.5rem',
                          background: 'var(--royal-soft)',
                          borderColor: 'var(--royal-ring)',
                          color: 'var(--royal)',
                        }}
                      >
                        {p.tier_interest}
                      </span>
                    ) : null}
                  </p>
                  <p className="meta">
                    {p.email ?? 'no email'}
                    {p.company ? ` · ${p.company}` : ''}
                    {p.phone ? ` · ${p.phone}` : ''}
                  </p>
                  {p.notes ? (
                    <p className="meta" style={{ marginTop: '0.2rem', fontStyle: 'italic' }}>
                      “{p.notes.length > 160 ? p.notes.slice(0, 160) + '…' : p.notes}”
                    </p>
                  ) : null}
                </div>
                <div className="right">
                  <span className="status hot" style={statusStyle(p.status)}>
                    {p.status}
                  </span>
                  <p className="meta">
                    Meeting: {fmtDate(p.meeting_at)}
                  </p>
                  <p className="meta">Booked: {fmtDate(p.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
