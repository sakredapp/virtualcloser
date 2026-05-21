// POST /api/billing/subscribe
// Body: { hoursPerWeek: number }   (pricePerHour is accepted but ignored —
//        weekly pricing comes from the customer's volume tier in the catalog.)
//
// Creates (or replaces) the agent's WEEKLY Stripe subscription for the picked
// plan size. Requires a saved card — call /api/billing/setup-intent first and
// confirm it with Stripe Elements before hitting this.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getAgentBilling } from '@/lib/billing/agentBilling'
import { createWeeklySubscription, persistMemberPlan } from '@/lib/billing/subscribe'
import { isStripeConfigured } from '@/lib/billing/stripe'
import type { Tier } from '@/lib/billing/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOURS_MIN = 10
const HOURS_MAX = 80

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'stripe_not_configured', message: 'Set STRIPE_SECRET_KEY in env.' },
      { status: 501 },
    )
  }
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  let body: { hoursPerWeek?: number }
  try {
    body = (await req.json()) as { hoursPerWeek?: number }
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  const hoursPerWeek = Math.round(Number(body.hoursPerWeek ?? 0))
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek < HOURS_MIN || hoursPerWeek > HOURS_MAX) {
    return NextResponse.json(
      { ok: false, reason: 'bad_hours', message: `hoursPerWeek must be ${HOURS_MIN}-${HOURS_MAX}.` },
      { status: 400 },
    )
  }

  const billing = await getAgentBilling(session.member.id)
  if (!billing?.stripe_customer_id || !billing.stripe_payment_method_id) {
    return NextResponse.json(
      { ok: false, reason: 'no_card', message: 'No payment method on file. Save a card first.' },
      { status: 400 },
    )
  }

  // Individual self-pay starts at t1; the tier on file (set when an org/seat
  // count is known) wins if present.
  const volumeTier = ((billing.volume_tier as Tier | null) ?? 't1') as Tier
  const overflowEnabled = Boolean(billing.overflow_enabled)

  const sub = await createWeeklySubscription({
    scope: 'member',
    customerId: billing.stripe_customer_id,
    paymentMethodId: billing.stripe_payment_method_id,
    weeklyHours: hoursPerWeek,
    trainerWeeklyHours: 0,
    receptionistWeeklyHours: 0,
    overflowEnabled,
    volumeTier,
    addons: [],
    metadata: { vc_member_id: session.member.id, vc_rep_id: session.tenant.id },
  })

  await persistMemberPlan({
    memberId: session.member.id,
    weeklyHours: hoursPerWeek,
    trainerWeeklyHours: 0,
    overflowEnabled,
    volumeTier,
    subscriptionId: sub.id,
    status: sub.status,
  })

  return NextResponse.json({ ok: true, subscriptionId: sub.id, status: sub.status })
}
