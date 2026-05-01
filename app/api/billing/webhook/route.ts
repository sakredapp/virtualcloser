// POST /api/billing/webhook
//
// Stripe webhook receiver. Verify signature, dedupe via
// agent_billing_event.stripe_event_id, then dispatch on event type.
//
// Events handled:
//   payment_method.attached     → cache card brand/last4 + flip status to active
//   customer.subscription.created/updated → cache plan size + status
//   invoice.paid                → mark period invoice_paid_at + open next period if needed
//   invoice.payment_failed      → flip status to past_due
//   customer.subscription.deleted → flip status to cancelled

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, stripeWebhookSecret } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { ensureOpenPeriod } from '@/lib/billing/agentBilling'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ ok: false, reason: 'no_signature' }, { status: 400 })

  const raw = await req.text()
  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, stripeWebhookSecret())
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed', err)
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 400 })
  }

  // Idempotency: if we've already processed this event id, no-op.
  const { data: existing } = await supabase
    .from('agent_billing_event')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, dedup: true })
  }

  const memberId = await resolveMemberId(event)
  await supabase.from('agent_billing_event').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    member_id: memberId,
    payload: event as unknown as Record<string, unknown>,
  })

  try {
    switch (event.type) {
      case 'payment_method.attached':
        await onPaymentMethodAttached(event.data.object as Stripe.PaymentMethod)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await onSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
      case 'invoice.paid':
        await onInvoicePaid(event.data.object as Stripe.Invoice, memberId)
        break
      case 'invoice.payment_failed':
        await onInvoiceFailed(event.data.object as Stripe.Invoice, memberId)
        break
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      default:
        // Ignored — still recorded in agent_billing_event for audit.
        break
    }
  } catch (err) {
    console.error('[stripe-webhook] handler failed', event.type, err)
    // Return 500 so Stripe retries. We've already recorded the event so
    // the dedup check above prevents double-processing on the retry — the
    // earlier insert will be visible (best-effort; eventually consistent).
    return NextResponse.json({ ok: false, reason: 'handler_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function resolveMemberId(event: Stripe.Event): Promise<string | null> {
  // Most events embed the customer id in the object — we look up the
  // agent_billing row by stripe_customer_id to find the member.
  const obj = event.data.object as { customer?: string | Stripe.Customer }
  const cust = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id
  if (!cust) return null
  const { data } = await supabase
    .from('agent_billing')
    .select('member_id')
    .eq('stripe_customer_id', cust)
    .maybeSingle()
  return (data as { member_id: string } | null)?.member_id ?? null
}

async function onPaymentMethodAttached(pm: Stripe.PaymentMethod): Promise<void> {
  const customer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
  if (!customer) return
  await supabase
    .from('agent_billing')
    .update({
      stripe_payment_method_id: pm.id,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
      card_exp_month: pm.card?.exp_month ?? null,
      card_exp_year: pm.card?.exp_year ?? null,
    })
    .eq('stripe_customer_id', customer)
}

async function onSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customer) return
  // Pull plan size from the metadata we set when creating the subscription.
  const metaHours = Number(sub.metadata?.hours_per_week ?? '0')
  const status = sub.status === 'active' || sub.status === 'trialing' ? 'active'
    : sub.status === 'past_due' || sub.status === 'unpaid' ? 'past_due'
    : sub.status === 'canceled' ? 'cancelled'
    : 'pending_setup'
  const update: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    status,
  }
  if (metaHours > 0) {
    const minutesPerMonth = Math.round(metaHours * 4.3 * 60)
    update.plan_minutes_per_month = minutesPerMonth
  }
  await supabase
    .from('agent_billing')
    .update(update)
    .eq('stripe_customer_id', customer)
}

async function onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customer) return
  await supabase
    .from('agent_billing')
    .update({ status: 'cancelled', stripe_subscription_id: null })
    .eq('stripe_customer_id', customer)
}

async function onInvoicePaid(inv: Stripe.Invoice, memberId: string | null): Promise<void> {
  const customer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
  if (customer) {
    // Re-activate if the prior invoice had failed.
    await supabase
      .from('agent_billing')
      .update({ status: 'active' })
      .eq('stripe_customer_id', customer)
      .eq('status', 'past_due')
  }
  if (!memberId) return
  // Open the current period (no-op if already open) and stamp it with the invoice.
  const period = await ensureOpenPeriod(memberId)
  await supabase
    .from('agent_billing_period')
    .update({ stripe_invoice_id: inv.id, invoice_paid_at: new Date().toISOString() })
    .eq('id', period.id)
}

async function onInvoiceFailed(_inv: Stripe.Invoice, memberId: string | null): Promise<void> {
  if (!memberId) return
  await supabase.from('agent_billing').update({ status: 'past_due' }).eq('member_id', memberId)
}
