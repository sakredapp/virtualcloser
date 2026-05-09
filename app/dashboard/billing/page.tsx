// /dashboard/billing — agent billing self-serve.
//
// Shows: current plan, card on file, this month's usage bar, recent
// invoices. Lets the agent: save a card, pick / change a plan, see
// when the next reset hits.

import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { getAgentBilling, ensureAgentBilling, getOpenPeriod, listPeriods, ensureOpenPeriod, reconcilePeriodUsage } from '@/lib/billing/agentBilling'
import { secondsToHours, centsToDollars, plannedVsConsumedPct } from '@/lib/billing/units'
import { isStripeConfigured } from '@/lib/billing/stripe'
import BillingClient from './BillingClient'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const session = await requireMember()
  const { member, tenant } = session

  if (!isStripeConfigured()) {
    return <NotConfigured />
  }

  // Lazily create the Stripe customer + agent_billing row on first visit
  // so the form always has something to bind to.
  await ensureAgentBilling({
    memberId: member.id,
    repId: tenant.id,
    email: member.email ?? '',
    displayName: member.display_name ?? member.email ?? 'Agent',
  })
  // Make sure this month's period exists (the cron handles ongoing rollover).
  await ensureOpenPeriod(member.id).catch(() => null)
  await reconcilePeriodUsage(member.id).catch(() => null)

  const billing = await getAgentBilling(member.id)
  const period = await getOpenPeriod(member.id)
  const history = await listPeriods(member.id, 6)
  const isAdmin = isAtLeast(member.role, 'admin')

  const pct = period ? plannedVsConsumedPct(period.planned_seconds, period.consumed_seconds) : 0

  return (
    <main className="wrap">
      <header style={{ marginBottom: 18 }}>
        <p className="eyebrow">Agent billing</p>
        <h1 style={{ margin: '4px 0 0', fontSize: 28, color: 'var(--ink)' }}>Your AI SDR — billing &amp; plan</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-meta)' }}>
          You pay monthly for the hours your AI SDR runs. Hours reset on the
          1st of every month — no rollover. Pause or change your plan any time.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 320px)', gap: '1.2rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Current period card */}
          <section style={cardStyle}>
            <h2 style={h2Style}>This month</h2>
            {period ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-meta)' }}>
                    Period {period.period_year_month}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>
                    {secondsToHours(period.consumed_seconds)} / {secondsToHours(period.planned_seconds)} hrs used
                  </span>
                </div>
                <div style={{ height: 10, background: 'var(--border-soft)', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: pct >= 100 ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#16a34a',
                      transition: 'width 200ms ease',
                    }}
                  />
                </div>
                {period.overage_seconds > 0 && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: '#dc2626', fontWeight: 700 }}>
                    Overage: {secondsToHours(period.overage_seconds)} hrs past plan
                    {billing?.payer_model === 'self' && billing?.price_per_minute_cents
                      ? ` — will bill ~${centsToDollars(Math.round(Math.ceil(period.overage_seconds / 60) * Number(billing.price_per_minute_cents)))} at month close.`
                      : ' — reported on the next org invoice.'}
                  </p>
                )}
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-meta)' }}>
                  Resets at midnight UTC on the 1st. No rollover.
                </p>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-meta)' }}>
                No open period yet. Pick a plan below to start billing.
              </p>
            )}
          </section>

          {/* Card + plan picker — interactive */}
          <BillingClient billing={billing} />

          {/* History */}
          <section style={cardStyle}>
            <h2 style={h2Style}>Past months</h2>
            {history.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-meta)' }}>No history yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
                {history.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      padding: '8px 0',
                      borderBottom: '1px dashed #e2e8f0',
                      color: 'var(--ink)',
                    }}
                  >
                    <span>
                      {p.period_year_month}
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-meta)' }}>
                        {p.status === 'closed' ? 'closed' : 'open'}
                      </span>
                    </span>
                    <span>
                      {secondsToHours(p.consumed_seconds)} / {secondsToHours(p.planned_seconds)} hrs
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside
          style={{
            ...cardStyle,
            position: 'sticky',
            top: '1rem',
            alignSelf: 'start',
            border: '1.5px solid var(--red)',
            background: 'linear-gradient(180deg, var(--paper) 0%, #fff5f3 100%)',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--red)', margin: 0 }}>
            Status
          </p>
          <p style={{ margin: '4px 0 12px', fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
            {labelStatus(billing?.status ?? 'pending_setup')}
          </p>
          <dl style={{ margin: 0, fontSize: 13, color: 'var(--ink)' }}>
            <Row label="Payer" value={billing?.payer_model === 'org' ? 'Org pays' : 'Self pays'} />
            <Row
              label="Card"
              value={billing?.card_brand && billing.card_last4 ? `${billing.card_brand} •••• ${billing.card_last4}` : 'Not on file'}
            />
            <Row
              label="Plan"
              value={billing?.plan_minutes_per_month ? `${secondsToHours((billing.plan_minutes_per_month ?? 0) * 60)} hrs / mo` : '—'}
            />
            <Row label="Monthly" value={billing?.plan_price_cents ? centsToDollars(billing.plan_price_cents) : '—'} />
          </dl>
          <Link href="/dashboard/shifts" style={linkBtnStyle}>
            Edit dialing shifts →
          </Link>
          {isAdmin && (
            <Link href="/dashboard/billing/team" style={{ ...linkBtnStyle, marginTop: 8, background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--border-soft)' }}>
              Team billing (admin) →
            </Link>
          )}
        </aside>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <dt style={{ color: 'var(--text-meta)' }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 700 }}>{value}</dd>
    </div>
  )
}

function labelStatus(s: string): string {
  switch (s) {
    case 'active': return 'Active'
    case 'pending_setup': return 'Setup needed'
    case 'past_due': return 'Past due'
    case 'cancelled': return 'Cancelled'
    default: return s
  }
}

function NotConfigured() {
  return (
    <main className="wrap">
      <h1>Billing isn&rsquo;t wired up yet</h1>
      <p style={{ color: 'var(--text-meta)' }}>
        Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>, and{' '}
        <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> in env to enable the card-on-file flow.
      </p>
    </main>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  padding: '1rem 1.1rem',
  boxShadow: 'var(--shadow-card)',
}

const h2Style: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink)',
}

const linkBtnStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 14,
  padding: '10px 14px',
  background: 'var(--ink)',
  color: 'var(--text-inv)',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  textAlign: 'center',
  textDecoration: 'none',
}
