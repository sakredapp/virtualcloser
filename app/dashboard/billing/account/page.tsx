// /dashboard/billing/account
//
// Weekly billing dashboard. Role-branched:
//
//   owner  → full self-serve. Plan summary, week-to-date usage, invoices,
//            payment method (Stripe portal link), cancel-at-week-end toggle.
//   admin  → same as owner (treated as owner for billing).
//   manager→ read-only summary + change-request form (creates a row in
//            billing_change_requests; owner gets notified).
//   rep    → just their own usage meter.
//   observer → just status.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { weekBoundsForDate } from '@/lib/billing/weekly'
import { ManagePortalButton, RequestChangeForm, OverflowToggle } from './AccountActions'

export const dynamic = 'force-dynamic'

export default async function DashboardBillingAccount() {
  let session
  try { session = await requireMember() } catch { redirect('/login') }
  const { member, tenant } = session
  const role = (member as { role?: string }).role ?? 'rep'

  const { isoWeek } = weekBoundsForDate()

  const [{ data: rep }, { data: ab }, { data: orgWeek }, { data: agentWeek }, { data: invoices }] = await Promise.all([
    supabase.from('reps').select('*').eq('id', tenant.id).maybeSingle(),
    supabase.from('agent_billing').select('*').eq('member_id', member.id).maybeSingle(),
    supabase.from('org_billing_week').select('*').eq('rep_id', tenant.id).eq('iso_week', isoWeek).maybeSingle(),
    supabase.from('agent_billing_week').select('*').eq('member_id', member.id).eq('iso_week', isoWeek).maybeSingle(),
    supabase.from('invoices').select('*').or(`rep_id.eq.${tenant.id},member_id.eq.${member.id}`).order('created_at', { ascending: false }).limit(10),
  ])

  const isOwnerLike = role === 'owner' || role === 'admin'
  const isManager = role === 'manager'
  const isRep = role === 'rep' || role === 'observer'

  // Rep-only view: just their meter.
  if (isRep) {
    const week = agentWeek as Record<string, unknown> | null
    const consumedH = week ? Number(week.consumed_seconds ?? 0) / 3600 : 0
    const plannedH = week ? Number(week.planned_hours ?? 0) : Number(ab?.weekly_hours_quota ?? 0)
    const pct = plannedH > 0 ? Math.min(100, Math.round((consumedH / plannedH) * 100)) : 0
    return (
      <main className="wrap">
        <BillingHeader />
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>This week</h2>
          <p style={{ margin: '4px 0 12px', color: 'var(--muted)', fontSize: 12 }}>{isoWeek} · {Math.round(consumedH * 10) / 10}h of {plannedH}h used</p>
          <Bar pct={pct} />
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            Quota resets every Monday. Talk to your manager if you need more hours.
          </p>
        </section>
      </main>
    )
  }

  // Owner / Admin / Manager shared chrome.
  const orgQuotaH = Number(rep?.weekly_hours_quota ?? 0)
  const orgConsumedH = orgWeek ? Number((orgWeek as { consumed_seconds?: number }).consumed_seconds ?? 0) / 3600 : 0
  const orgPct = orgQuotaH > 0 ? Math.min(100, Math.round((orgConsumedH / orgQuotaH) * 100)) : 0
  const status = (rep?.billing_status as string) ?? (ab?.status as string) ?? 'none'
  const overflow = !!(rep?.overflow_enabled || ab?.overflow_enabled)
  const cancelAtWeekEnd = !!rep?.cancel_at_week_end
  const card = rep?.card_brand
    ? `${rep.card_brand} ···· ${rep.card_last4} (exp ${rep.card_exp_month}/${rep.card_exp_year})`
    : ab?.card_brand
      ? `${ab.card_brand} ···· ${ab.card_last4} (exp ${ab.card_exp_month}/${ab.card_exp_year})`
      : null

  return (
    <main className="wrap">
      <BillingHeader />

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Your plan</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="Tier" value={String(rep?.tier ?? '—')} />
          <Field label="Status" value={status} tone={status === 'past_due' ? 'bad' : 'normal'} />
          <Field label="Weekly quota" value={`${orgQuotaH}h`} />
          <Field label="Overflow billing" value={overflow ? 'on' : 'off'} />
          <Field label="Card on file" value={card ?? '—'} />
          <Field label="Cancel at week end" value={cancelAtWeekEnd ? 'YES — service ends Sunday' : 'no'} tone={cancelAtWeekEnd ? 'bad' : 'normal'} />
        </div>
        {isOwnerLike && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ManagePortalButton />
            <OverflowToggle current={overflow} />
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>This week ({isoWeek})</h2>
        <p style={{ margin: '4px 0 10px', color: 'var(--muted)', fontSize: 12 }}>
          {Math.round(orgConsumedH * 10) / 10}h of {orgQuotaH}h used · {orgPct}%
        </p>
        <Bar pct={orgPct} />
        {orgWeek && Number((orgWeek as { overage_hours?: number }).overage_hours ?? 0) > 0 && (
          <p style={{ marginTop: 8, color: '#d97706', fontSize: 12 }}>
            Overage: {Number((orgWeek as { overage_hours: number }).overage_hours).toFixed(1)}h — {overflow ? 'will appear on next invoice' : 'capped'}
          </p>
        )}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Recent invoices</h2>
        {(invoices ?? []).length === 0 && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>No invoices yet — first weekly bill goes out Monday.</p>}
        <ul style={{ paddingLeft: 16, margin: 0, fontSize: 13 }}>
          {((invoices ?? []) as Record<string, unknown>[]).map((inv, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--muted)' }}>{new Date(inv.created_at as string).toLocaleDateString()}</span>
              {' · '}
              <strong>${(Number(inv.amount_due ?? 0) / 100).toFixed(2)}</strong>
              {' · '}
              <span style={{ color: inv.status === 'paid' ? '#065f46' : 'var(--ink)' }}>{String(inv.status)}</span>
              {inv.hosted_invoice_url ? <> · <a href={inv.hosted_invoice_url as string} target="_blank" rel="noreferrer">view</a></> : null}
            </li>
          ))}
        </ul>
      </section>

      {isManager && (
        <section className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Request a change</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 12 }}>
            Owners control billing. Submit a change here and the owner gets notified.
          </p>
          <RequestChangeForm />
        </section>
      )}
    </main>
  )
}

function BillingHeader() {
  return (
    <header className="hero">
      <p className="eyebrow">Billing</p>
      <h1 style={{ margin: '0 0 0.3rem' }}>Account</h1>
      <p className="nav" style={{ marginTop: '0.5rem' }}>
        <Link href="/dashboard">← Dashboard</Link>
        <span>·</span>
        <Link href="/dashboard/billing">Per-agent billing</Link>
      </p>
    </header>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'normal' | 'bad' }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, color: tone === 'bad' ? 'var(--red)' : 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 10, borderRadius: 6, background: 'var(--paper-2)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? 'var(--red)' : pct >= 70 ? '#d97706' : '#10b981' }} />
    </div>
  )
}
