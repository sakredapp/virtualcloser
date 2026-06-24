// /dashboard/billing — plan & payment-method editor.
//
// The card + plan picker. Weekly usage and invoices live on /billing/account
// (the canonical billing screen, linked from the header). This page only
// handles: save a card, pick / change your weekly plan, see plan status.

import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import PageHeader from '@/app/components/PageHeader'
import { getAgentBilling, ensureAgentBilling } from '@/lib/billing/agentBilling'
import { isStripeConfigured } from '@/lib/billing/stripe'
import BillingClient from './BillingClient'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const session = await requireMember()
  const { member, tenant } = session

  if (!isStripeConfigured()) {
    return <NotConfigured />
  }

  // Lazily create the Stripe customer + agent_billing row on first visit so
  // the form always has something to bind to.
  await ensureAgentBilling({
    memberId: member.id,
    repId: tenant.id,
    email: member.email ?? '',
    displayName: member.display_name ?? member.email ?? 'Agent',
  })

  const billing = await getAgentBilling(member.id)
  const isAdmin = isAtLeast(member.role, 'admin')

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Plan & payment"
        title="Plan & payment method"
        subtitle="Save a card on file and choose your plan. Your weekly usage and invoices live on the Billing page."
        actions={<Link href="/dashboard/billing/account">← Billing &amp; usage</Link>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 320px)', gap: '1.2rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Card + plan picker — interactive */}
          <BillingClient billing={billing} />
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
              value={billing?.weekly_hours_quota ? `${billing.weekly_hours_quota} hrs / wk` : '—'}
            />
            <Row label="Overflow" value={billing?.overflow_enabled ? 'On — overage billed weekly' : 'Off — hard cap at quota'} />
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
