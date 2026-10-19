// /admin/billing/customers
//
// Suite CXO customers and where their billing stands on Whop: status, seats,
// monthly price, the Whop membership, comped clients. Billing state is written
// by the Whop webhook (app/api/webhooks/whop/route.ts) and the admin actions.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { seatCount, seatMonthlyCents } from '@/lib/billing/whop'

export const dynamic = 'force-dynamic'

type RepRow = {
  id: string
  display_name: string
  email: string | null
  brand: string | null
  billing_status: string | null
  max_seats: number | null
  whop_membership_id: string | null
  whop_checkout_url: string | null
  comped_at: string | null
}

export default async function AdminBillingCustomers() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { data: reps } = await supabase
    .from('reps')
    .select('id, display_name, email, brand, billing_status, max_seats, whop_membership_id, whop_checkout_url, comped_at')
    .eq('brand', 'cxo')
    .order('updated_at', { ascending: false })
    .limit(500)

  const rows = ((reps ?? []) as RepRow[]).map((r) => {
    const seats = seatCount(Math.max(1, Number(r.max_seats) || 1))
    return { ...r, seats, monthlyCents: seatMonthlyCents(seats), status: r.billing_status ?? 'none' }
  })

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Billing</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>Customers</h1>
        <p className="sub" style={{ margin: 0 }}>
          {rows.length} Suite CXO customer{rows.length === 1 ? '' : 's'} · billed on Whop
        </p>
        <p className="nav" style={{ marginTop: '0.5rem' }}>
          <Link href="/admin/billing">← Cost & margin</Link>
          <span>·</span>
          <Link href="/admin/billing/audit">Audit log</Link>
          <span>·</span>
          <Link href="/admin/clients">Clients</Link>
        </p>
      </header>

      <section className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <th style={th}>Customer</th>
              <th style={th}>Status</th>
              <th style={th}>Seats</th>
              <th style={th}>Monthly</th>
              <th style={th}>Whop membership</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.email ?? '—'} · {r.id}</div>
                </td>
                <td style={{ ...td, color: statusColor(r.status) }}>{r.status}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.seats}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                  {r.status === 'comped' ? 'comped' : `$${(r.monthlyCents / 100).toFixed(2)}`}
                </td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {r.whop_membership_id ?? (r.whop_checkout_url ? 'checkout sent' : '—')}
                </td>
                <td style={td}>
                  <Link href={`/admin/billing/customers/${r.id}`} style={{ color: 'var(--red)', fontWeight: 600 }}>
                    open →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 14, color: 'var(--muted)' }}>No Suite CXO customers yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

const th: React.CSSProperties = { padding: '8px 6px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '8px 6px', verticalAlign: 'top' }

function statusColor(s: string): string {
  switch (s) {
    case 'active': case 'comped': return '#065f46'
    case 'past_due': return 'var(--red)'
    case 'canceled': case 'paused': return 'var(--muted)'
    default: return 'var(--ink)'
  }
}
