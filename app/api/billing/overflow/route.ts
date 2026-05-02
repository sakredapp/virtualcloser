// POST /api/billing/overflow
// Body: { enabled: boolean }
//
// Owner-only. Toggles overflow billing for the org subscription. Adds /
// removes the metered overage subscription items.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { can } from '@/lib/permissions'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { resolvePriceId, sdrOveragePriceKey, trainerOveragePriceKey, type Tier } from '@/lib/billing/catalog'
import { audit } from '@/lib/billing/auditLog'
import type Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  let session
  try { session = await requireMember() } catch { return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) }
  if (!can(session.member, 'billing.manage')) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const enabled = !!body.enabled
  const repId = session.tenant.id

  // Pick the live subscription. Try org first, fall back to member.
  const { data: rep } = await supabase.from('reps').select('stripe_subscription_id, volume_tier').eq('id', repId).maybeSingle()
  const { data: ab } = await supabase.from('agent_billing').select('stripe_subscription_id, volume_tier').eq('member_id', session.member.id).maybeSingle()
  const subscriptionId = (rep?.stripe_subscription_id as string | null) ?? (ab?.stripe_subscription_id as string | null)
  const tier = ((rep?.volume_tier as Tier | null) ?? (ab?.volume_tier as Tier | null) ?? 't1') as Tier
  if (!subscriptionId) return NextResponse.json({ ok: false, reason: 'no_subscription' }, { status: 400 })

  const stripe = getStripe()
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
  const itemsParam: Stripe.SubscriptionUpdateParams.Item[] = []

  const sdrOverageId = resolvePriceId(sdrOveragePriceKey(tier))
  const trainerOverageId = resolvePriceId(trainerOveragePriceKey(tier))
  const hasSdrOverage = sub.items.data.find((it) => it.price.id === sdrOverageId)
  const hasTrainerOverage = sub.items.data.find((it) => it.price.id === trainerOverageId)

  if (enabled) {
    if (!hasSdrOverage) itemsParam.push({ price: sdrOverageId })
    if (!hasTrainerOverage) itemsParam.push({ price: trainerOverageId })
  } else {
    if (hasSdrOverage) itemsParam.push({ id: hasSdrOverage.id, deleted: true })
    if (hasTrainerOverage) itemsParam.push({ id: hasTrainerOverage.id, deleted: true })
  }

  if (itemsParam.length > 0) {
    await stripe.subscriptions.update(subscriptionId, { items: itemsParam, proration_behavior: 'none' })
  }

  // Mirror to whichever local tables apply.
  if (rep?.stripe_subscription_id) {
    await supabase.from('reps').update({ overflow_enabled: enabled }).eq('id', repId)
  }
  if (ab?.stripe_subscription_id) {
    await supabase.from('agent_billing').update({ overflow_enabled: enabled }).eq('member_id', session.member.id)
  }

  await audit({
    actorKind: 'customer',
    actorId: session.member.email,
    action: enabled ? 'overflow.enable' : 'overflow.disable',
    repId,
    memberId: session.member.id,
    stripeObjectId: subscriptionId,
  })

  return NextResponse.json({ ok: true, enabled })
}
