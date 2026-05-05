// POST /api/billing/webhook
//
// Unified Stripe webhook receiver.
//
// Verifies the signature, dedupes via stripe_events (insert with PK conflict
// = already processed), then dispatches.
//
// Events handled:
//   checkout.session.completed       → provision rep+member, attach sub, send magic link
//   customer.subscription.created    → cache plan + status (member or org)
//   customer.subscription.updated    → cache plan + status, handle cancel-at-period-end
//   customer.subscription.deleted    → mark cancelled
//   payment_method.attached          → cache card brand/last4
//   payment_method.detached          → clear cached card
//   customer.updated                 → cache default payment method
//   invoice.created / .finalized     → upsert invoices cache
//   invoice.paid                     → upsert + close billing week + clear past_due
//   invoice.payment_failed           → upsert + flip to past_due + email dunning

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, stripeWebhookSecret } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { provisionFromCheckout } from '@/lib/billing/provision'
import { provisionFromBuildFeeCheckout } from '@/lib/billing/provisionBuildFee'
import { upsertInvoiceFromStripe } from '@/lib/billing/invoiceCache'
import { weekBoundsForDate } from '@/lib/billing/weekly'
import { sendEmail } from '@/lib/email'
import { getMemberById } from '@/lib/members'
import { audit } from '@/lib/billing/auditLog'

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

  // Idempotency: insert into stripe_events; conflict on PK = already
  // processed. We accept the event in either case (Stripe gets a 200 either
  // way), and only run handlers on the first insertion.
  const insertResult = await supabase.from('stripe_events').insert({
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    api_version: event.api_version ?? null,
    payload: event as unknown as Record<string, unknown>,
  })
  const isDuplicate = insertResult.error?.code === '23505'      // unique_violation
  if (insertResult.error && !isDuplicate) {
    console.error('[stripe-webhook] failed to record event', insertResult.error)
    // Don't bail — still try to handle it. Idempotency suffers slightly but
    // we don't want a DB hiccup to block billing events.
  }
  if (isDuplicate) {
    return NextResponse.json({ ok: true, dedup: true })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await onSubscriptionChanged(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case 'payment_method.attached':
        await onPaymentMethodAttached(event.data.object as Stripe.PaymentMethod)
        break

      case 'payment_method.detached':
        await onPaymentMethodDetached(event.data.object as Stripe.PaymentMethod)
        break

      case 'customer.updated':
        await onCustomerUpdated(event.data.object as Stripe.Customer)
        break

      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.updated':
      case 'invoice.voided':
        await upsertInvoiceFromStripe(event.data.object as Stripe.Invoice)
        break

      case 'invoice.paid':
        await onInvoicePaid(event.data.object as Stripe.Invoice)
        break

      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        // Recorded in stripe_events for forensics; otherwise ignored.
        break
    }
    await supabase
      .from('stripe_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', event.id)
  } catch (err) {
    console.error('[stripe-webhook] handler failed', event.type, err)
    await supabase
      .from('stripe_events')
      .update({ error: (err as Error).message ?? String(err) })
      .eq('id', event.id)
    // 500 → Stripe retries. The dedup PK check above prevents reprocessing.
    return NextResponse.json({ ok: false, reason: 'handler_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// ── Handlers ────────────────────────────────────────────────────────────

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Admin-sent custom build-fee link — rep already exists, just record payment.
  if (session.metadata?.vc_kind === 'admin_build_fee') {
    await handleAdminBuildFeeCheckout(session)
    return
  }
  if (!session.metadata?.cart_id) return
  // Cart-based flows: branch on vc_kind.
  if (session.metadata?.vc_kind === 'build_fee_checkout') {
    await provisionFromBuildFeeCheckout(session)
    return
  }
  // Fallback: full subscription checkout (post-activation flow or legacy).
  await provisionFromCheckout(session)
}

async function handleAdminBuildFeeCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const repId = session.metadata?.rep_id
  if (!repId) return

  const stripe = getStripe()
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent as Stripe.PaymentIntent | null)?.id ?? null

  let paymentMethodId: string | null = null
  let paidCents = 0
  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
      paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : (pi.payment_method as Stripe.PaymentMethod | null)?.id ?? null
      paidCents = pi.amount_received ?? pi.amount ?? 0
      if (paymentMethodId && customerId) {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        })
      }
    } catch (err) {
      console.error('[webhook] admin_build_fee: failed to retrieve payment intent', err)
    }
  }

  await supabase
    .from('reps')
    .update({
      billing_status: 'pending_activation',
      build_fee_paid_at: new Date().toISOString(),
      build_fee_paid_cents: paidCents,
      build_fee_payment_intent_id: paymentIntentId,
      ...(paymentMethodId ? {
        pending_payment_method_id: paymentMethodId,
        default_payment_method_id: paymentMethodId,
      } : {}),
    })
    .eq('id', repId)

  await audit({
    actorKind: 'webhook',
    actorId: session.id,
    action: 'build_fee.paid',
    repId,
    stripeObjectId: paymentIntentId ?? session.id,
    amountCents: paidCents,
    notes: 'admin-sent custom build fee paid — pending activation',
  }).catch(() => {})
}

async function onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customer) return

  const status = mapSubStatus(sub.status)
  const cancelAtWeekEnd = sub.cancel_at_period_end ?? false
  const weeklyHoursMeta = Number(sub.metadata?.vc_weekly_hours ?? '0')
  const overflow = sub.metadata?.vc_overflow_enabled === '1'
  const volumeTier = sub.metadata?.vc_volume_tier ?? null
  const scope = sub.metadata?.vc_scope ?? null

  const update: Record<string, unknown> = { stripe_subscription_id: sub.id }
  if (weeklyHoursMeta > 0) update.weekly_hours_quota = weeklyHoursMeta
  if (volumeTier) update.volume_tier = volumeTier
  update.overflow_enabled = overflow
  update.cancel_at_week_end = cancelAtWeekEnd

  // Pick which table based on scope (or fall back to membership lookup).
  if (scope === 'org') {
    await supabase.from('reps').update({ ...update, billing_status: status }).eq('stripe_customer_id', customer)
  } else if (scope === 'member') {
    await supabase
      .from('agent_billing')
      .update({ ...update, status: mapMemberStatus(sub.status) })
      .eq('stripe_customer_id', customer)
  } else {
    // Unknown scope — try both, only one will match.
    await supabase.from('reps').update({ ...update, billing_status: status }).eq('stripe_customer_id', customer)
    await supabase
      .from('agent_billing')
      .update({ ...update, status: mapMemberStatus(sub.status) })
      .eq('stripe_customer_id', customer)
  }
}

async function onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customer) return
  await supabase
    .from('agent_billing')
    .update({ status: 'cancelled', stripe_subscription_id: null })
    .eq('stripe_customer_id', customer)
  await supabase
    .from('reps')
    .update({ billing_status: 'canceled', stripe_subscription_id: null })
    .eq('stripe_customer_id', customer)
}

async function onPaymentMethodAttached(pm: Stripe.PaymentMethod): Promise<void> {
  const customer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
  if (!customer) return
  const cardFields = {
    stripe_payment_method_id: pm.id,
    card_brand: pm.card?.brand ?? null,
    card_last4: pm.card?.last4 ?? null,
    card_exp_month: pm.card?.exp_month ?? null,
    card_exp_year: pm.card?.exp_year ?? null,
  }
  await supabase.from('agent_billing').update(cardFields).eq('stripe_customer_id', customer)
  await supabase
    .from('reps')
    .update({
      default_payment_method_id: pm.id,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
      card_exp_month: pm.card?.exp_month ?? null,
      card_exp_year: pm.card?.exp_year ?? null,
    })
    .eq('stripe_customer_id', customer)
}

async function onPaymentMethodDetached(pm: Stripe.PaymentMethod): Promise<void> {
  // Stripe sets pm.customer to null on detach — match by pm.id instead.
  await supabase
    .from('agent_billing')
    .update({ stripe_payment_method_id: null, card_brand: null, card_last4: null, card_exp_month: null, card_exp_year: null })
    .eq('stripe_payment_method_id', pm.id)
  await supabase
    .from('reps')
    .update({ default_payment_method_id: null, card_brand: null, card_last4: null, card_exp_month: null, card_exp_year: null })
    .eq('default_payment_method_id', pm.id)
}

async function onCustomerUpdated(cust: Stripe.Customer): Promise<void> {
  const defaultPm = typeof cust.invoice_settings?.default_payment_method === 'string'
    ? cust.invoice_settings.default_payment_method
    : cust.invoice_settings?.default_payment_method?.id ?? null
  if (!defaultPm) return
  await supabase
    .from('agent_billing')
    .update({ stripe_payment_method_id: defaultPm })
    .eq('stripe_customer_id', cust.id)
  await supabase
    .from('reps')
    .update({ default_payment_method_id: defaultPm })
    .eq('stripe_customer_id', cust.id)
}

async function onInvoicePaid(inv: Stripe.Invoice): Promise<void> {
  await upsertInvoiceFromStripe(inv)
  const customer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
  if (!customer) return
  // Clear past_due on whichever table matches.
  await supabase
    .from('agent_billing')
    .update({ status: 'active' })
    .eq('stripe_customer_id', customer)
    .eq('status', 'past_due')
  await supabase
    .from('reps')
    .update({ billing_status: 'active' })
    .eq('stripe_customer_id', customer)
    .eq('billing_status', 'past_due')

  // Stamp this week's billing-week row with the invoice id.
  const { weekStart, weekEnd, isoWeek } = weekBoundsForDate()
  await supabase
    .from('agent_billing_week')
    .update({ stripe_invoice_id: inv.id, invoice_paid_at: new Date().toISOString() })
    .eq('iso_week', isoWeek)
    .gte('week_start', weekStart.toISOString())
    .lte('week_end', weekEnd.toISOString())
  await supabase
    .from('org_billing_week')
    .update({ stripe_invoice_id: inv.id, invoice_paid_at: new Date().toISOString() })
    .eq('iso_week', isoWeek)
    .gte('week_start', weekStart.toISOString())
    .lte('week_end', weekEnd.toISOString())
}

async function onInvoicePaymentFailed(inv: Stripe.Invoice): Promise<void> {
  await upsertInvoiceFromStripe(inv)
  const customer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
  if (!customer) return

  await supabase.from('agent_billing').update({ status: 'past_due' }).eq('stripe_customer_id', customer)
  await supabase.from('reps').update({ billing_status: 'past_due' }).eq('stripe_customer_id', customer)

  // Send dunning email — only on the first failure attempt to avoid spam.
  if ((inv.attempt_count ?? 0) > 1) return

  // Find the email to notify.
  const { data: ab } = await supabase
    .from('agent_billing')
    .select('member_id')
    .eq('stripe_customer_id', customer)
    .maybeSingle()
  let email: string | null = null
  let name = 'there'
  if (ab?.member_id) {
    const m = await getMemberById(ab.member_id as string)
    email = m?.email ?? null
    name = (m as { display_name?: string } | null)?.display_name ?? name
  } else {
    const { data: rep } = await supabase
      .from('reps')
      .select('email, display_name')
      .eq('stripe_customer_id', customer)
      .maybeSingle()
    if (rep) { email = (rep.email as string) ?? null; name = (rep.display_name as string) ?? name }
  }
  if (!email) return

  const amount = (inv.amount_due ?? 0) / 100
  await sendEmail({
    to: email,
    subject: 'Heads up — your weekly Virtual Closer payment failed',
    html: `
      <p>Hey ${escapeHtml(name)},</p>
      <p>Your weekly Virtual Closer charge of <strong>$${amount.toFixed(2)}</strong> didn't go through (card declined or expired).</p>
      <p>The dialer is paused until your card is updated.
      <a href="https://${process.env.ROOT_DOMAIN ?? 'virtualcloser.com'}/dashboard/billing" style="color:#ff2800;font-weight:bold">Update your card →</a></p>
      <p>Stripe will retry automatically. The dialer stays paused until a charge succeeds.</p>
      <p>— Virtual Closer</p>
    `,
    text: `Your weekly Virtual Closer payment of $${amount.toFixed(2)} failed. Update your card: https://${process.env.ROOT_DOMAIN ?? 'virtualcloser.com'}/dashboard/billing`,
  }).catch((err) => console.error('[stripe-webhook] dunning email failed', err))
}

function mapSubStatus(s: Stripe.Subscription.Status): string {
  switch (s) {
    case 'active': case 'trialing': return 'active'
    case 'past_due': case 'unpaid': return 'past_due'
    case 'canceled': return 'canceled'
    case 'paused': return 'paused'
    case 'incomplete': case 'incomplete_expired': return 'incomplete'
    default: return 'none'
  }
}
function mapMemberStatus(s: Stripe.Subscription.Status): 'pending_setup'|'active'|'past_due'|'cancelled'|'paused' {
  switch (s) {
    case 'active': case 'trialing': return 'active'
    case 'past_due': case 'unpaid': return 'past_due'
    case 'canceled': return 'cancelled'
    case 'paused': return 'paused'
    default: return 'pending_setup'
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
