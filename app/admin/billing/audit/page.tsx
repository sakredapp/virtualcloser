// /admin/billing/audit
//
// Append-only log of every admin billing action.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function AdminBillingAudit() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { data } = await supabase
    .from('billing_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Billing</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>Audit log</h1>
        <p className="sub" style={{ margin: 0 }}>
          Last {data?.length ?? 0} billing-impacting actions.
        </p>
        <p className="nav" style={{ marginTop: '0.5rem' }}>
          <Link href="/admin/billing/customers">← Customers</Link>
        </p>
      </header>

      <section className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
            <th style={th}>When</th>
            <th style={th}>Actor</th>
            <th style={th}>Action</th>
            <th style={th}>Customer</th>
            <th style={th}>Amount</th>
            <th style={th}>Notes</th>
            <th style={th}>Stripe</th>
          </tr></thead>
          <tbody>
            {((data ?? []) as Record<string, unknown>[]).map((a, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                <td style={td}>{new Date(a.created_at as string).toLocaleString()}</td>
                <td style={td}>{String(a.actor_kind)}{a.actor_id ? ` · ${a.actor_id}` : ''}</td>
                <td style={{ ...td, fontWeight: 600 }}>{String(a.action)}</td>
                <td style={td}>{a.rep_id ? <Link href={`/admin/billing/customers/${a.rep_id}`}>{String(a.rep_id)}</Link> : '—'}</td>
                <td style={td}>{a.amount_cents != null ? `$${(Number(a.amount_cents) / 100).toFixed(2)}` : '—'}</td>
                <td style={{ ...td, color: 'var(--muted)' }}>{(a.notes as string) ?? ''}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>{(a.stripe_object_id as string) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}

const th: React.CSSProperties = { padding: '6px 5px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '6px 5px', verticalAlign: 'top' }
