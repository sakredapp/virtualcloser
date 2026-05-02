// Weekly subscription create / update logic.
//
// Replaces the monthly logic in lib/billing/agentBilling.ts:subscribeAgentToPlan.
// Works for both billing scopes:
//
//   scope='member' → subscription on agent_billing.stripe_customer_id (rep
//                    pays own card, individual tier).
//   scope='org'    → subscription on reps.stripe_customer_id (owner pays
//                    for whole team, team or enterprise tier).
//
// Subscription items:
//   1. Base build (flat weekly).
//   2. SDR hours (per-unit weekly, qty = weekly_hours_quota).
//   3. Trainer hours (per-unit weekly, qty = trainer_weekly_hours).
//   4. Optional: SDR overage (metered weekly), only if overflow_enabled.
//   5. Optional: Trainer overage (metered weekly), only if overflow_enabled.
//   6. Optional addons (CRM integrations, dialer, roleplay).
//
// All items use the customer's volume_tier Price. When tier changes, call
// rotateVolumeTier() to swap items in place.

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { getStripe } from './stripe'
import {
  resolvePriceId,
  sdrHoursPriceKey,
  trainerHoursPriceKey,
  sdrOveragePriceKey,
  trainerOveragePriceKey,
  type Tier,
  tierForRepCount,
} from './catalog'
import { billingCycleAnchorEpoch, weekBoundsForDate } from './weekly'

export type Scope = 'member' | 'org'

export type AddonKey =
  | 'vc_crm_ghl' | 'vc_crm_hubspot' | 'vc_crm_pipedrive' | 'vc_crm_salesforce'
  | 'vc_dialer_lite' | 'vc_dialer_pro'
  | 'vc_roleplay_lite' | 'vc_roleplay_pro'

export type SubscriptionPlan = {
  scope: Scope
  customerId: string
  paymentMethodId?: string | null
  weeklyHours: number              // SDR hours/week
  trainerWeeklyHours: number       // Trainer hours/week (0 if not buying trainer)
  overflowEnabled: boolean
  volumeTier: Tier
  addons: AddonKey[]
  baseBuild?: boolean              // default true; pass false to skip
  metadata?: Record<string, string>
}

/** Build the line items for a fresh subscription based on the plan. */
function buildItems(plan: SubscriptionPlan): Stripe.SubscriptionCreateParams.Item[] {
  const items: Stripe.SubscriptionCreateParams.Item[] = []

  if (plan.baseBuild !== false) {
    items.push({ price: resolvePriceId('vc_base_build_weekly'), quantity: 1 })
  }
  if (plan.weeklyHours > 0) {
    items.push({
      price: resolvePriceId(sdrHoursPriceKey(plan.volumeTier)),
      quantity: plan.weeklyHours,
    })
  }
  if (plan.trainerWeeklyHours > 0) {
    items.push({
      price: resolvePriceId(trainerHoursPriceKey(plan.volumeTier)),
      quantity: plan.trainerWeeklyHours,
    })
  }
  if (plan.overflowEnabled) {
    if (plan.weeklyHours > 0) {
      items.push({ price: resolvePriceId(sdrOveragePriceKey(plan.volumeTier)) })
    }
    if (plan.trainerWeeklyHours > 0) {
      items.push({ price: resolvePriceId(trainerOveragePriceKey(plan.volumeTier)) })
    }
  }
  for (const addon of plan.addons) {
    items.push({ price: resolvePriceId(`${addon}_weekly`), quantity: 1 })
  }
  return items
}

/** Create a brand-new weekly subscription. Cancels any existing subscription
 *  on the customer first. Use updateSubscription() for in-place changes. */
export async function createWeeklySubscription(plan: SubscriptionPlan): Promise<Stripe.Subscription> {
  const stripe = getStripe()

  // Cancel any existing active subscription on this customer.
  const existing = await stripe.subscriptions.list({ customer: plan.customerId, status: 'all', limit: 5 })
  for (const sub of existing.data) {
    if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
      try {
        await stripe.subscriptions.cancel(sub.id, { prorate: false })
      } catch (err) {
        console.warn('[subscribe] cancel-existing failed (continuing)', err)
      }
    }
  }

  const items = buildItems(plan)
  const params: Stripe.SubscriptionCreateParams = {
    customer: plan.customerId,
    items,
    // Anchor to next Monday 00:00 UTC. Stripe pro-rates the partial first
    // week unless we tell it not to — but we want cash upfront for the FULL
    // first week, so we use trial_end == anchor to delay the first charge
    // to that Monday. Cleaner alternative: just `proration_behavior: 'none'`
    // and accept the partial first week. We pick the partial-prorated path
    // because it's standard and customers expect it.
    billing_cycle_anchor: billingCycleAnchorEpoch(),
    proration_behavior: 'create_prorations',
    collection_method: 'charge_automatically',
    payment_behavior: 'error_if_incomplete',
    metadata: { ...(plan.metadata ?? {}), vc_scope: plan.scope, vc_volume_tier: plan.volumeTier },
    expand: ['latest_invoice.payment_intent'],
  }
  if (plan.paymentMethodId) {
    params.default_payment_method = plan.paymentMethodId
  }
  return stripe.subscriptions.create(params)
}

/** Apply changes to an existing subscription IN PLACE. No proration — the
 *  change takes effect at the next Monday cycle. */
export async function updateSubscription(
  subscriptionId: string,
  plan: SubscriptionPlan,
): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })

  const desiredItems = buildItems(plan)
  const desiredByPrice = new Map(desiredItems.map((i) => [i.price as string, i.quantity ?? null]))
  const currentByPrice = new Map<string, string>() // price id -> item id
  for (const it of sub.items.data) {
    currentByPrice.set(it.price.id, it.id)
  }

  const itemsParam: Stripe.SubscriptionUpdateParams.Item[] = []
  // Update or add each desired item.
  for (const [priceId, qty] of desiredByPrice) {
    const itemId = currentByPrice.get(priceId)
    if (itemId) {
      itemsParam.push({ id: itemId, quantity: qty ?? undefined })
    } else {
      itemsParam.push({ price: priceId, quantity: qty ?? undefined })
    }
  }
  // Delete any current items not in the desired set.
  for (const [priceId, itemId] of currentByPrice) {
    if (!desiredByPrice.has(priceId)) {
      itemsParam.push({ id: itemId, deleted: true })
    }
  }

  return stripe.subscriptions.update(subscriptionId, {
    items: itemsParam,
    proration_behavior: 'none',
    metadata: {
      ...sub.metadata,
      vc_volume_tier: plan.volumeTier,
      vc_scope: plan.scope,
    },
  })
}

/** Schedule cancellation at the end of the current week. The customer keeps
 *  service through Sunday and pays no further weekly charges. */
export async function cancelAtWeekEnd(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
}

/** Undo a pending cancel-at-period-end. */
export async function uncancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false })
}

/** Swap every tier-specific item to the new tier's Price (e.g. when seat
 *  count crosses a threshold). Pricing changes take effect next cycle. */
export async function rotateVolumeTier(args: {
  subscriptionId: string
  newTier: Tier
}): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  const sub = await stripe.subscriptions.retrieve(args.subscriptionId, { expand: ['items.data.price'] })
  const updates: Stripe.SubscriptionUpdateParams.Item[] = []

  const swap = (currentPriceKey: string, newPriceKey: string) => {
    for (const it of sub.items.data) {
      if (it.price.metadata?.vc_price_key === currentPriceKey) {
        updates.push({ id: it.id, price: resolvePriceId(newPriceKey), quantity: it.quantity })
      }
    }
  }

  // We don't have the OLD tier here, so swap by metadata vc_kind matching.
  for (const it of sub.items.data) {
    const kind = it.price.metadata?.vc_kind
    const oldTier = it.price.metadata?.vc_tier
    if (!kind || !oldTier || oldTier === args.newTier) continue
    let newKey: string | null = null
    if (kind === 'sdr_hours') newKey = sdrHoursPriceKey(args.newTier)
    else if (kind === 'trainer_hours') newKey = trainerHoursPriceKey(args.newTier)
    else if (kind === 'sdr_overage') newKey = sdrOveragePriceKey(args.newTier)
    else if (kind === 'trainer_overage') newKey = trainerOveragePriceKey(args.newTier)
    if (newKey) {
      updates.push({ id: it.id, price: resolvePriceId(newKey), quantity: it.quantity })
    }
  }

  if (updates.length === 0) return sub
  return stripe.subscriptions.update(args.subscriptionId, {
    items: updates,
    proration_behavior: 'none',
    metadata: { ...sub.metadata, vc_volume_tier: args.newTier },
  })
}

// ── DB sync helpers ─────────────────────────────────────────────────────

/** After creating/updating a member subscription, persist the plan + status
 *  to agent_billing. Called from the subscribe route + webhook. */
export async function persistMemberPlan(args: {
  memberId: string
  weeklyHours: number
  trainerWeeklyHours: number
  overflowEnabled: boolean
  volumeTier: Tier
  subscriptionId: string
  status: string
}): Promise<void> {
  const status =
    args.status === 'active' || args.status === 'trialing' ? 'active' :
    args.status === 'past_due' || args.status === 'unpaid' ? 'past_due' :
    args.status === 'canceled' ? 'cancelled' :
    args.status === 'paused' ? 'paused' :
    'pending_setup'

  const { weekStart, weekEnd } = weekBoundsForDate()

  await supabase
    .from('agent_billing')
    .update({
      stripe_subscription_id: args.subscriptionId,
      weekly_hours_quota: args.weeklyHours,
      overflow_enabled: args.overflowEnabled,
      volume_tier: args.volumeTier,
      status,
      current_week_start: weekStart.toISOString(),
      current_week_end: weekEnd.toISOString(),
    })
    .eq('member_id', args.memberId)
}

/** Same idea for org-level subscriptions on `reps`. */
export async function persistOrgPlan(args: {
  repId: string
  weeklyHours: number
  overflowEnabled: boolean
  volumeTier: Tier
  subscriptionId: string
  status: string
}): Promise<void> {
  const billing_status =
    args.status === 'active' || args.status === 'trialing' ? 'active' :
    args.status === 'past_due' || args.status === 'unpaid' ? 'past_due' :
    args.status === 'canceled' ? 'canceled' :
    args.status === 'paused' ? 'paused' :
    args.status === 'incomplete' || args.status === 'incomplete_expired' ? 'incomplete' :
    'none'

  const { weekStart, weekEnd } = weekBoundsForDate()

  await supabase
    .from('reps')
    .update({
      stripe_subscription_id: args.subscriptionId,
      weekly_hours_quota: args.weeklyHours,
      overflow_enabled: args.overflowEnabled,
      volume_tier: args.volumeTier,
      billing_status,
      current_week_start: weekStart.toISOString(),
      current_week_end: weekEnd.toISOString(),
    })
    .eq('id', args.repId)
}

/** Convenience: pick the right tier given an org's seat count and persist. */
export function pickVolumeTier(repCount: number): Tier {
  return tierForRepCount(repCount).key
}
