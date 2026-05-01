// POST /api/billing/subscribe
// Body: { hoursPerWeek: number, pricePerHour?: number }
//
// Creates (or rotates) the agent's Stripe subscription using the picked
// plan size. Requires a saved card — call /api/billing/setup-intent first
// and confirm it with Stripe Elements before hitting this.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { subscribeAgentToPlan, getAgentBilling, ensureOpenPeriod } from '@/lib/billing/agentBilling'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { pricePerHourForReps } from '@/app/offer/AiSdrPricingCalculator'

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

  let body: { hoursPerWeek?: number; pricePerHour?: number }
  try {
    body = (await req.json()) as { hoursPerWeek?: number; pricePerHour?: number }
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
  // Default to the individual $6/hr starting tier; UI can pass an explicit
  // price (e.g. $5.50 if the rep is on a multi-seat enterprise account).
  const pricePerHour = Number(body.pricePerHour ?? pricePerHourForReps(1))

  const billing = await getAgentBilling(session.member.id)
  if (!billing?.stripe_payment_method_id) {
    return NextResponse.json(
      { ok: false, reason: 'no_card', message: 'No payment method on file. Save a card first.' },
      { status: 400 },
    )
  }

  const { subscriptionId, status } = await subscribeAgentToPlan({
    memberId: session.member.id,
    hoursPerWeek,
    pricePerHour,
  })
  // Open this month's period immediately so the dialer can run today.
  await ensureOpenPeriod(session.member.id)
  return NextResponse.json({ ok: true, subscriptionId, status })
}
