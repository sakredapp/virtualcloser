// /admin/billing/customers/[repId]
//
// Per-customer billing detail. Shows org-level subscription (if any),
// every member with their per-member subscription, recent invoices, this
// week's usage breakdown, and admin write-actions (refund, comp, cancel,
// add custom setup fee).

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { weekBoundsForDate } from '@/lib/billing/weekly'
import { CustomerActions } from './CustomerActions'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ repId: string }> }

export default async function AdminBillingCustomerDetail({ params }: Props) {
  if (!(await isAdminAuthed())) redirect('/admin/login')
  const { repId } = await params

  const { isoWeek } = weekBoundsForDate()

  const [{ data: rep }, { data: members }, { data: agents }, { data: invoices }, { data: orgWeeks }, { data: agentWeeks }, { data: audit }] = await Promise.all([
    supabase.from('reps').select('*').eq('id', repId).maybeSingle(),
    supabase.from('members').select('id, email, display_name, role').eq('rep_id', repId),
    supabase.from('agent_billing').select('*').eq('rep_id', repId),
    supabase.from('invoices').select('*').eq('rep_id', repId).order('created_at', { ascending: false }).limit(20),
    supabase.from('org_billing_week').select('*').eq('rep_id', repId).order('week_start', { ascending: false }).limit(8),
    supabase.from('agent_billing_week').select('*').eq('rep_id', repId).order('week_start', { ascending: false }).limit(40),
    supabase.from('billing_audit').select('*').eq('rep_id', repId).order('created_at', { ascending: false }).limit(20),
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

  const memberById = new Map<string, { email: string; display_name: string; role: string }>()
  for (const m of (members ?? []) as { id: string; email: string; display_name: string; role: string }[]) {
    memberById.set(m.id, { email: m.email, display_name: m.display_name, role: m.role })
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Billing</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>{rep.display_name}</h1>
        <p className="sub" style={{ margin: 0 }}>
          {rep.tier} · {rep.email ?? '—'} · {rep.id}
        </p>
        <p className="nav" style={{ marginTop: '0.5rem' }}>
          <Link href="/admin/billing/customers">← Customers</Link>
          <span>·</span>
          <Link href={`/admin/clients/${rep.id}`}>Client overview</Link>
        </p>
      </header>

      {/* Org-level summary */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Subscription</h2>
        <Grid>
          <Field label="Tier" value={String(rep.tier ?? '—')} />
          <Field label="Status" value={String(rep.billing_status ?? 'none')} tone={rep.billing_status === 'past_due' ? 'bad' : 'normal'} />
          <Field label="Weekly quota" value={`${rep.weekly_hours_quota ?? 0}h`} />
          <Field label="Volume tier" value={String(rep.volume_tier ?? '—')} />
          <Field label="Overflow" value={rep.overflow_enabled ? 'on' : 'off'} />
          <Field label="Cancel at week end" value={rep.cancel_at_week_end ? 'YES' : 'no'} tone={rep.cancel_at_week_end ? 'bad' : 'normal'} />
          <Field label="Stripe customer" value={rep.stripe_customer_id ?? '—'} mono />
          <Field label="Stripe subscription" value={rep.stripe_subscription_id ?? '—'} mono />
          <Field label="Card" value={rep.card_brand ? `${rep.card_brand} ···· ${rep.card_last4} (${rep.card_exp_month}/${rep.card_exp_year})` : '—'} />
          <Field label="Current week ends" value={rep.current_week_end ? new Date(rep.current_week_end).toUTCString() : '—'} />
        </Grid>

        <CustomerActions
          repId={rep.id}
          subscriptionId={rep.stripe_subscription_id}
          customerId={rep.stripe_customer_id}
          tier={String(rep.tier)}
          billingStatus={rep.billing_status as string | null}
          hasPendingPlan={!!rep.pending_plan}
        />
      </section>

      {/* Members */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Members ({(members ?? []).length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Member</th>
            <th style={th}>Role</th>
            <th style={th}>Payer</th>
            <th style={th}>Quota</th>
            <th style={th}>Status</th>
            <th style={th}>Stripe sub</th>
          </tr></thead>
          <tbody>
            {((agents ?? []) as Record<string, unknown>[]).map((a, i) => {
              const m = memberById.get(a.member_id as string)
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                  <td style={td}>{m?.display_name ?? '?'}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{m?.email}</div></td>
                  <td style={td}>{m?.role ?? '—'}</td>
                  <td style={td}>{String(a.payer_model)}</td>
                  <td style={td}>{Number(a.weekly_hours_quota ?? 0)}h</td>
                  <td style={{ ...td, color: a.status === 'past_due' ? 'var(--red)' : 'var(--ink)' }}>{String(a.status)}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{(a.stripe_subscription_id as string) ?? '—'}</td>
                </tr>
              )
            })}
            {(agents ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ padding: 14, color: 'var(--muted)' }}>No member subscriptions.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Invoices */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Invoices</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Date</th>
            <th style={th}>Number</th>
            <th style={th}>Status</th>
            <th style={th}>Amount</th>
            <th style={th}></th>
          </tr></thead>
          <tbody>
            {((invoices ?? []) as Record<string, unknown>[]).map((inv, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                <td style={td}>{inv.created_at ? new Date(inv.created_at as string).toLocaleDateString() : '—'}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{(inv.number as string) ?? (inv.id as string)}</td>
                <td style={{ ...td, color: inv.status === 'paid' ? '#065f46' : inv.status === 'open' ? '#d97706' : 'var(--ink)' }}>{String(inv.status)}</td>
                <td style={td}>${((Number(inv.amount_due ?? 0)) / 100).toFixed(2)}</td>
                <td style={td}>{inv.hosted_invoice_url ? <a href={inv.hosted_invoice_url as string} target="_blank" rel="noreferrer">view</a> : '—'}</td>
              </tr>
            ))}
            {(invoices ?? []).length === 0 && (
              <tr><td colSpan={5} style={{ padding: 14, color: 'var(--muted)' }}>No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Weekly usage */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Recent weeks</h2>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px' }}>Current week: {isoWeek}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Week</th>
            <th style={th}>Scope</th>
            <th style={th}>Member</th>
            <th style={th}>Planned</th>
            <th style={th}>Used</th>
            <th style={th}>Overage</th>
            <th style={th}>Status</th>
          </tr></thead>
          <tbody>
            {((orgWeeks ?? []) as Record<string, unknown>[]).map((w, i) => (
              <tr key={`o${i}`} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                <td style={td}>{String(w.iso_week)}</td>
                <td style={td}>org</td>
                <td style={td}>—</td>
                <td style={td}>{Number(w.planned_hours ?? 0)}h</td>
                <td style={td}>{(Number(w.consumed_seconds ?? 0) / 3600).toFixed(2)}h</td>
                <td style={{ ...td, color: Number(w.overage_hours ?? 0) > 0 ? '#d97706' : 'var(--ink)' }}>{Number(w.overage_hours ?? 0)}h</td>
                <td style={td}>{String(w.status)}</td>
              </tr>
            ))}
            {((agentWeeks ?? []) as Record<string, unknown>[]).map((w, i) => {
              const m = memberById.get(w.member_id as string)
              return (
                <tr key={`a${i}`} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                  <td style={td}>{String(w.iso_week)}</td>
                  <td style={td}>agent</td>
                  <td style={td}>{m?.display_name ?? '?'}</td>
                  <td style={td}>{Number(w.planned_hours ?? 0)}h</td>
                  <td style={td}>{(Number(w.consumed_seconds ?? 0) / 3600).toFixed(2)}h</td>
                  <td style={{ ...td, color: Number(w.overage_hours ?? 0) > 0 ? '#d97706' : 'var(--ink)' }}>{Number(w.overage_hours ?? 0)}h</td>
                  <td style={td}>{String(w.status)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Audit log */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Recent admin actions</h2>
        <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12 }}>
          {((audit ?? []) as Record<string, unknown>[]).map((a, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--muted)' }}>{new Date(a.created_at as string).toLocaleString()}</span>
              {' '}<strong>{String(a.action)}</strong>
              {a.actor_id ? <> by {String(a.actor_id)}</> : null}
              {a.amount_cents != null ? <> · ${(Number(a.amount_cents) / 100).toFixed(2)}</> : null}
              {a.notes ? <span style={{ color: 'var(--muted)' }}> — {String(a.notes)}</span> : null}
            </li>
          ))}
          {(audit ?? []).length === 0 && (
            <li style={{ color: 'var(--muted)' }}>No admin actions yet.</li>
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
