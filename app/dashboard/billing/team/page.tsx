// /dashboard/billing/team — admin/owner-only page that lists every agent
// in the tenant with their current billing status + a "Self pays / Org
// pays" toggle. Picked at onboarding (or any time) by the admin.

import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { listMembers } from '@/lib/members'
import { supabase } from '@/lib/supabase'
import { secondsToHours, centsToDollars } from '@/lib/billing/units'
import TeamBillingClient from './TeamBillingClient'

export const dynamic = 'force-dynamic'

export default async function TeamBillingPage() {
  const session = await requireMember()
  if (!isAtLeast(session.member.role, 'admin')) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1rem' }}>
        <h1 style={{ fontSize: 22 }}>Admins only</h1>
        <p style={{ color: '#64748b' }}>You need admin role to manage team billing.</p>
        <p>
          <Link href="/dashboard/billing" style={{ color: '#ff2800', fontWeight: 700 }}>
            ← back to your own billing
          </Link>
        </p>
      </main>
    )
  }

  const members = await listMembers(session.tenant.id)
  const memberIds = members.map((m) => m.id)
  const { data: billingRows } = memberIds.length
    ? await supabase
        .from('agent_billing')
        .select('member_id, payer_model, status, plan_minutes_per_month, plan_price_cents, card_brand, card_last4')
        .in('member_id', memberIds)
    : { data: [] }

  const billingByMember = new Map<string, {
    payer_model: 'self' | 'org'
    status: string
    plan_minutes_per_month: number | null
    plan_price_cents: number | null
    card_brand: string | null
    card_last4: string | null
  }>()
  for (const row of (billingRows ?? []) as Array<{
    member_id: string
    payer_model: 'self' | 'org'
    status: string
    plan_minutes_per_month: number | null
    plan_price_cents: number | null
    card_brand: string | null
    card_last4: string | null
  }>) {
    billingByMember.set(row.member_id, row)
  }

  const rows = members.map((m) => {
    const b = billingByMember.get(m.id)
    return {
      memberId: m.id,
      email: m.email ?? '',
      displayName: (m as { display_name?: string }).display_name ?? m.email ?? 'Agent',
      role: m.role,
      payerModel: (b?.payer_model ?? 'self') as 'self' | 'org',
      status: b?.status ?? 'pending_setup',
      planHoursPerMonth: secondsToHours((b?.plan_minutes_per_month ?? 0) * 60),
      planPrice: b?.plan_price_cents ? centsToDollars(b.plan_price_cents) : '—',
      card: b?.card_brand && b?.card_last4 ? `${b.card_brand} •••• ${b.card_last4}` : '—',
    }
  })

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <header style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff2800', margin: 0 }}>
          Team billing
        </p>
        <h1 style={{ margin: '4px 0 0', fontSize: 28, color: '#0f172a' }}>Who pays for each agent?</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#64748b' }}>
          For each agent: <strong>Self pays</strong> means the rep saves their
          own card and is billed monthly. <strong>Org pays</strong> means this
          tenant&rsquo;s account picks up the tab — no per-agent card needed,
          their AI SDR is just on as soon as you flip the toggle.
        </p>
      </header>
      <TeamBillingClient initialRows={rows} />
    </main>
  )
}
