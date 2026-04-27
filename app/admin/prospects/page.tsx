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
      return { background: 'rgba(37,99,235,0.12)', borderColor: 'rgba(37,99,235,0.3)', color: '#1e40af' }
    case 'won':
      return { background: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.45)', color: '#065f46' }
    case 'canceled':
    case 'lost':
      return { background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#991b1b' }
    case 'contacted':
      return { background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)', color: '#92400e' }
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
          Every call booked through Cal.com lands here. Click a prospect to qualify, plan their build, and track costs.
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="name">
                    <Link href={`/admin/prospects/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {p.name || p.email || 'Unnamed prospect'}
                    </Link>
                    {p.tier_interest ? (
                      <span
                        className="status"
                        style={{
                          marginLeft: '0.5rem',
                          background: 'rgba(255,40,0,0.1)',
                          borderColor: 'rgba(255,40,0,0.2)',
                          color: 'var(--red)',
                        }}
                      >
                        {p.tier_interest}
                      </span>
                    ) : null}
                    {p.build_plan ? (
                      <span style={{ marginLeft: '0.4rem', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 7px', borderRadius: '999px', background: 'rgba(16,185,129,0.12)', color: '#065f46', border: '1px solid rgba(16,185,129,0.3)' }}>
                        plan ready
                      </span>
                    ) : null}
                  </p>
                  <p className="meta">
                    {p.email ?? 'no email'}
                    {p.company ? ` · ${p.company}` : ''}
                    {p.phone ? ` · ${p.phone}` : ''}
                  </p>
                  {p.build_summary ? (
                    <p className="meta" style={{ marginTop: '0.2rem', color: 'var(--ink)' }}>
                      {p.build_summary.length > 120 ? p.build_summary.slice(0, 120) + '…' : p.build_summary}
                    </p>
                  ) : p.notes ? (
                    <p className="meta" style={{ marginTop: '0.2rem', fontStyle: 'italic' }}>
                      &ldquo;{p.notes.length > 120 ? p.notes.slice(0, 120) + '…' : p.notes}&rdquo;
                    </p>
                  ) : null}
                </div>
                <div className="right">
                  <span className="status" style={statusStyle(p.status)}>
                    {p.status}
                  </span>
                  {p.build_cost_estimate != null && (
                    <p className="meta" style={{ marginTop: '0.2rem', fontWeight: 700, color: 'var(--ink)' }}>
                      ${p.build_cost_estimate.toLocaleString()} build
                    </p>
                  )}
                  {p.maintenance_estimate != null && (
                    <p className="meta">${p.maintenance_estimate.toLocaleString()}/mo</p>
                  )}
                  <p className="meta">Meeting: {fmtDate(p.meeting_at)}</p>
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
