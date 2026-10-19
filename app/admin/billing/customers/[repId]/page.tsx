// /admin/billing/customers/[repId]
//
// One Suite CXO customer's billing on Whop: status, seats, the Whop
// membership, payments (read live from Whop), the audit trail, and the admin
// actions (seat checkout, charge link, comp, refund, cancel, pause, resume).

import { accountsOnboardingUrl } from '@/lib/accountsLinks'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { seatCount, seatMonthlyCents, whopMoneyToCents } from '@/lib/billing/whop'
import { clientPayments } from '@/lib/billing/cxoBillingActions'
import { CustomerActions } from './CustomerActions'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ repId: string }> }

const when = (iso: unknown) => (typeof iso === 'string' && iso ? new Date(iso).toLocaleString() : '—')

export default async function AdminBillingCustomerDetail({ params }: Props) {
  if (!(await isAdminAuthed())) redirect('/admin/login')
  const { repId } = await params

  const [{ data: rep }, { data: members }, { data: audit }] = await Promise.all([
    supabase.from('reps').select('*').eq('id', repId).maybeSingle(),
    supabase.from('members').select('id, email, display_name, role, is_active').eq('rep_id', repId),
    supabase.from('billing_audit').select('*').eq('rep_id', repId).order('created_at', { ascending: false }).limit(30),
  ])

  if (!rep) {
    return (
      <main className="wrap">
        <header className="hero">
          <h1>Customer not found</h1>
          <Link href="/admin/billing/customers">← Back</Link>
        </header>
      </main>
    )
  }

  const seats = seatCount(Math.max(1, Number(rep.max_seats) || 1))
  const membershipId = (rep.whop_membership_id as string | null) ?? null
  const payments = await clientPayments(membershipId)
  const memberRows = (members ?? []) as { id: string; email: string; display_name: string; role: string; is_active: boolean | null }[]

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Billing</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>{rep.display_name}</h1>
        <p className="sub" style={{ margin: 0 }}>
          {rep.email ?? '—'} · {rep.id}
        </p>
        <p className="nav" style={{ marginTop: '0.5rem' }}>
          <Link href="/admin/billing/customers">← Customers</Link>
          <span>·</span>
          <a href={accountsOnboardingUrl(rep.id)}>Onboarding in Accounts</a>
        </p>
      </header>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Subscription (Whop)</h2>
        <Grid>
          <Field label="Status" value={String(rep.billing_status ?? 'none')} tone={rep.billing_status === 'past_due' ? 'bad' : 'normal'} />
          <Field label="Seats" value={String(seats)} />
          <Field label="Monthly" value={rep.billing_status === 'comped' ? 'comped' : `$${(seatMonthlyCents(seats) / 100).toFixed(2)}`} />
          <Field label="Whop membership" value={membershipId ?? '—'} mono />
          <Field label="Last payment" value={(rep.whop_last_payment_id as string | null) ?? '—'} mono />
          <Field label="Activated" value={when(rep.subscription_activated_at)} />
          <Field label="Build fee paid" value={rep.build_fee_paid_at ? `${when(rep.build_fee_paid_at)}${rep.build_fee_paid_cents != null ? ` · $${(Number(rep.build_fee_paid_cents) / 100).toFixed(2)}` : ''}` : '—'} />
          <Field label="Comped" value={rep.comped_at ? `${when(rep.comped_at)} · ${String(rep.comped_reason ?? '')}` : '—'} />
        </Grid>
        {rep.whop_checkout_url && !membershipId ? (
          <p style={{ fontSize: 12, margin: '10px 0 0' }}>
            Seat checkout sent: <a href={String(rep.whop_checkout_url)} target="_blank" rel="noreferrer">{String(rep.whop_checkout_url)}</a>
          </p>
        ) : null}

        <CustomerActions repId={rep.id} membershipId={membershipId} billingStatus={(rep.billing_status as string | null) ?? null} />
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Payments</h2>
        {payments.error ? <p style={{ fontSize: 12, color: 'var(--red)', margin: '0 0 8px' }}>Could not read Whop: {payments.error}</p> : null}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Date</th>
            <th style={th}>Payment</th>
            <th style={th}>Status</th>
            <th style={th}>Amount</th>
            <th style={th}>Refunded</th>
          </tr></thead>
          <tbody>
            {payments.rows.map((p) => {
              const total = whopMoneyToCents(p.total ?? p.usd_total)
              const refunded = whopMoneyToCents(p.refunded_amount)
              return (
                <tr key={p.id} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                  <td style={td}>{when(p.paid_at ?? p.created_at)}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{p.id}</td>
                  <td style={td}>{String(p.status ?? '—')}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{total != null ? `$${(total / 100).toFixed(2)}` : '—'}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{refunded ? `$${(refunded / 100).toFixed(2)}` : '—'}</td>
                </tr>
              )
            })}
            {payments.rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 14, color: 'var(--muted)' }}>{membershipId ? 'No payments on this membership yet.' : 'No Whop membership yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Members ({memberRows.length})</h2>
        <ul style={{ paddingLeft: 16, margin: 0, fontSize: 13 }}>
          {memberRows.map((m) => (
            <li key={m.id} style={{ marginBottom: 4 }}>
              {m.display_name} <span style={{ color: 'var(--muted)' }}>· {m.email} · {m.role}{m.is_active === false ? ' · inactive' : ''}</span>
            </li>
          ))}
          {memberRows.length === 0 && <li style={{ color: 'var(--muted)' }}>No members.</li>}
        </ul>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Billing log</h2>
        <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12 }}>
          {((audit ?? []) as Record<string, unknown>[]).map((a, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--muted)' }}>{when(a.created_at)}</span>
              {' '}<strong>{String(a.action)}</strong>
              {a.actor_id ? <> by {String(a.actor_id)}</> : null}
              {a.amount_cents != null ? <> · ${(Number(a.amount_cents) / 100).toFixed(2)}</> : null}
              {a.notes ? <span style={{ color: 'var(--muted)' }}> — {String(a.notes)}</span> : null}
            </li>
          ))}
          {(audit ?? []).length === 0 && (
            <li style={{ color: 'var(--muted)' }}>Nothing yet.</li>
          )}
        </ul>
      </section>
    </main>
  )
}

function Field({ label, value, tone, mono }: { label: string; value: string; tone?: 'normal' | 'bad'; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, color: tone === 'bad' ? 'var(--red)' : 'var(--ink)', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{value}</div>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>
}

const th: React.CSSProperties = { padding: '8px 6px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '8px 6px', verticalAlign: 'top' }
