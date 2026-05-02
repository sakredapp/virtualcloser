// POST /api/admin/billing/:repId/activate-subscription
//
// The "go live" trigger. Reads reps.pending_plan, creates the weekly
// Stripe subscription off-session using the saved card from the build-fee
// Checkout, persists the plan, flips billing_status to 'active', and
// emails the customer that weekly billing starts Monday.
//
// Idempotent: if billing_status is already 'active' or a subscription is
// already attached, returns the existing subscription.

import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'
import { sendEmail } from '@/lib/email'
import { weekBoundsForDate, billingCycleAnchorEpoch } from '@/lib/billing/weekly'
import {
  resolvePriceId,
  sdrHoursPriceKey,
  trainerHoursPriceKey,
  sdrOveragePriceKey,
  trainerOveragePriceKey,
} from '@/lib/billing/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

type PendingPlan = {
  scope: 'individual' | 'team' | 'enterprise'
  rep_count: number
  weekly_hours: number
  trainer_weekly_hours: number
  overflow_enabled: boolean
  volume_tier: 't1' | 't2' | 't3' | 't4' | 't5'
  addons: string[]
}

export async function POST(_req: Request, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  const { repId } = await ctx.params

  const { data: rep } = await supabase
    .from('reps')
    .select('*')
    .eq('id', repId)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false, reason: 'rep_not_found' }, { status: 404 })

  // Already active — short-circuit.
  if (rep.stripe_subscription_id && rep.billing_status === 'active') {
    return NextResponse.json({ ok: true, alreadyActive: true, subscriptionId: rep.stripe_subscription_id })
  }

  if (!rep.stripe_customer_id) {
    return NextResponse.json({ ok: false, reason: 'no_stripe_customer' }, { status: 400 })
  }
  const paymentMethodId = (rep.pending_payment_method_id as string | null) ?? (rep.default_payment_method_id as string | null)
  if (!paymentMethodId) {
    return NextResponse.json({ ok: false, reason: 'no_payment_method' }, { status: 400 })
  }
  const plan = (rep.pending_plan as PendingPlan | null)
  if (!plan) {
    return NextResponse.json({ ok: false, reason: 'no_pending_plan' }, { status: 400 })
  }

  const stripe = getStripe()

  // Build subscription items from the snapshot.
  const items: Stripe.SubscriptionCreateParams.Item[] = []
  items.push({ price: resolvePriceId('vc_base_build_weekly'), quantity: 1 })
  if (plan.weekly_hours > 0) {
    items.push({ price: resolvePriceId(sdrHoursPriceKey(plan.volume_tier)), quantity: plan.weekly_hours })
  }
  if (plan.trainer_weekly_hours > 0) {
    items.push({ price: resolvePriceId(trainerHoursPriceKey(plan.volume_tier)), quantity: plan.trainer_weekly_hours })
  }
  if (plan.overflow_enabled) {
    if (plan.weekly_hours > 0) items.push({ price: resolvePriceId(sdrOveragePriceKey(plan.volume_tier)) })
    if (plan.trainer_weekly_hours > 0) items.push({ price: resolvePriceId(trainerOveragePriceKey(plan.volume_tier)) })
  }
  for (const addon of plan.addons ?? []) {
    try {
      items.push({ price: resolvePriceId(`${addon}_weekly`), quantity: 1 })
    } catch (err) {
      console.warn('[activate-subscription] unknown addon, skipping', addon, err)
    }
  }

  const sub = await stripe.subscriptions.create({
    customer: rep.stripe_customer_id as string,
    items,
    default_payment_method: paymentMethodId,
    billing_cycle_anchor: billingCycleAnchorEpoch(),
    proration_behavior: 'create_prorations',
    collection_method: plan.scope === 'enterprise' ? 'send_invoice' : 'charge_automatically',
    days_until_due: plan.scope === 'enterprise' ? 30 : undefined,
    payment_behavior: 'default_incomplete',
    metadata: {
      rep_id: repId,
      vc_scope: plan.scope === 'team' || plan.scope === 'enterprise' ? 'org' : 'member',
      vc_volume_tier: plan.volume_tier,
      vc_weekly_hours: String(plan.weekly_hours),
      vc_trainer_weekly_hours: String(plan.trainer_weekly_hours),
      vc_overflow_enabled: plan.overflow_enabled ? '1' : '0',
      activated_by_admin: '1',
    },
    expand: ['latest_invoice.payment_intent'],
  })

  const { weekStart, weekEnd } = weekBoundsForDate()
  await supabase
    .from('reps')
    .update({
      stripe_subscription_id: sub.id,
      billing_status: 'active',
      current_week_start: weekStart.toISOString(),
      current_week_end: weekEnd.toISOString(),
      subscription_activated_at: new Date().toISOString(),
      pending_payment_method_id: null,           // cleared once activated
    })
    .eq('id', repId)

  await audit({
    actorKind: 'admin',
    action: 'subscription.activate',
    repId,
    stripeObjectId: sub.id,
    notes: `${plan.scope} · ${plan.rep_count} reps · ${plan.weekly_hours}h SDR + ${plan.trainer_weekly_hours}h Trainer`,
    after: { subscriptionId: sub.id, status: sub.status },
  }).catch(() => {})

  // Notify the customer.
  if (rep.email) {
    sendEmail({
      to: rep.email as string,
      subject: 'Your Virtual Closer build is live',
      html: activationEmailHtml({
        displayName: (rep.display_name as string) ?? 'there',
        slug: rep.slug as string,
        weeklyHours: plan.weekly_hours,
      }),
      text: `Your Virtual Closer build is live. Weekly billing starts on the next Monday. Log in: https://${rep.slug}.${ROOT}/dashboard`,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, subscriptionId: sub.id, status: sub.status })
}

function activationEmailHtml(args: { displayName: string; slug: string; weeklyHours: number }): string {
  return `
    <p>Hey ${escapeHtml(args.displayName)},</p>
    <p><strong>Your Virtual Closer build just went live.</strong></p>
    <p>Weekly billing starts on the next Monday cycle. You're set up for ${args.weeklyHours} hours/week of AI dialer time.</p>
    <p><a href="https://${args.slug}.${ROOT}/dashboard" style="display:inline-block;background:#ff2800;color:#fff;padding:12px 18px;border-radius:8px;font-weight:bold;text-decoration:none">Open your dashboard →</a></p>
    <p>— Virtual Closer</p>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
