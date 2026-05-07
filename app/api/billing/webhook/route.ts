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
import { provisionFromOnboardingCheckout } from '@/lib/billing/provisionOnboarding'
import { upsertInvoiceFromStripe } from '@/lib/billing/invoiceCache'
import { weekBoundsForDate } from '@/lib/billing/weekly'
import { sendEmail } from '@/lib/email'
import { getMemberById } from '@/lib/members'
import { audit } from '@/lib/billing/auditLog'
import { generateInvoicePdf, makeInvoiceNumber } from '@/lib/billing/invoicePdf'

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
  // Tokenized onboarding flow — sign → pay → provision member + send welcome.
  if (session.metadata?.vc_kind === 'onboarding_build_fee') {
    await provisionFromOnboardingCheckout(session)
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

  // Send PDF invoice email for subscription charges.
  // billing_reason 'subscription_cycle' = recurring, 'subscription_create' = first charge.
  const reason = (inv as { billing_reason?: string }).billing_reason
  if (reason === 'subscription_cycle' || reason === 'subscription_create') {
    await sendRecurringInvoiceEmail(inv, customer).catch((err) =>
      console.error('[stripe-webhook] recurring invoice email failed', err)
    )
  }
}

async function sendRecurringInvoiceEmail(inv: Stripe.Invoice, customerId: string): Promise<void> {
  // Resolve email + name from agent_billing or reps.
  let email: string | null = null
  let name = 'there'

  const { data: ab } = await supabase
    .from('agent_billing')
    .select('member_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (ab?.member_id) {
    const m = await getMemberById(ab.member_id as string)
    email = m?.email ?? null
    name = (m as { display_name?: string } | null)?.display_name ?? name
  } else {
    const { data: rep } = await supabase
      .from('reps')
      .select('email, display_name')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (rep) {
      email = (rep.email as string) ?? null
      name = (rep.display_name as string) ?? name
    }
  }
  if (!email) return

  // Build itemised line list from all Stripe invoice lines (skip $0 lines).
  const stripeLines = (inv.lines?.data ?? []).filter((l) => (l.amount ?? 0) !== 0)
  const lineItems = stripeLines.length > 0
    ? stripeLines.map((l) => ({
        description: l.description ?? 'Virtual Closer — Service',
        amountCents: l.amount ?? 0,
      }))
    : [{ description: 'Virtual Closer — Weekly Service', amountCents: inv.amount_paid ?? inv.amount_due ?? 0 }]

  const totalCents = inv.amount_paid ?? inv.amount_due ?? 0
  const invoiceNumber = makeInvoiceNumber(inv.id)
  const issuedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const paymentUrl = (inv as { hosted_invoice_url?: string }).hosted_invoice_url
    ?? `https://${process.env.ROOT_DOMAIN ?? 'virtualcloser.com'}/dashboard/billing`
  const dollars = formatCents(totalCents)

  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await generateInvoicePdf({
      invoiceNumber,
      issuedDate,
      dueDate: 'Paid',
      clientName: name === 'there' ? email : name,
      clientEmail: email,
      lineItems,
      paymentUrl,
    })
  } catch (err) {
    console.error('[stripe-webhook] recurring PDF generation failed', err)
  }

  const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
  const RED_HEX = '#ff2800'
  const INK_HEX = '#0f0f0f'
  const MUTED_HEX = '#6b6b6b'
  const CREAM_HEX = '#f7f4ef'
  const BORDER_HEX = 'rgba(15,15,15,0.12)'
  const firstName = name === 'there' ? name : name.split(' ')[0]

  const lineRows = lineItems.map((l) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid ${BORDER_HEX};color:${INK_HEX};font-size:13px;">${escapeHtml(l.description)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid ${BORDER_HEX};text-align:right;font-weight:700;color:${INK_HEX};font-size:13px;">${formatCents(l.amountCents)}</td>
    </tr>`).join('')

  await sendEmail({
    to: email,
    subject: `Receipt ${invoiceNumber} — Virtual Closer (${dollars} paid)`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${CREAM_HEX};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK_HEX};">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">Receipt ${invoiceNumber} — ${dollars} charged successfully.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM_HEX};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
      <tr><td style="background:${RED_HEX};height:4px;border-radius:6px 6px 0 0;"></td></tr>
      <tr><td style="background:#fff;border:1px solid ${BORDER_HEX};border-top:none;border-radius:0 0 14px 14px;padding:0;overflow:hidden;">
        <div style="padding:22px 28px 16px;border-bottom:1px solid ${BORDER_HEX};">
          <p style="margin:0 0 2px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${RED_HEX};font-weight:700;">Virtual Closer</p>
          <h1 style="margin:0;font-size:20px;line-height:1.2;color:${INK_HEX};font-weight:700;">Receipt ${escapeHtml(invoiceNumber)}</h1>
        </div>
        <div style="padding:22px 28px;">
          <p style="margin:0 0 14px;font-size:14px;line-height:1.5;">Hey ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 20px;font-size:13px;color:${MUTED_HEX};line-height:1.55;">
            Your weekly Virtual Closer charge was processed. Your itemised receipt is below and a PDF copy is attached.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1.5px solid ${RED_HEX};border-radius:8px;overflow:hidden;margin-bottom:22px;">
            <tr style="background:${CREAM_HEX};">
              <td style="padding:9px 14px;font-weight:700;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${RED_HEX};border-bottom:1px solid ${BORDER_HEX};width:55%;">Description</td>
              <td style="padding:9px 14px;font-weight:700;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${RED_HEX};border-bottom:1px solid ${BORDER_HEX};text-align:right;">Amount</td>
            </tr>
            ${lineRows}
            <tr style="background:${CREAM_HEX};">
              <td style="padding:10px 14px;font-weight:700;color:${INK_HEX};">Total paid</td>
              <td style="padding:10px 14px;text-align:right;font-weight:800;font-size:15px;color:${RED_HEX};">${dollars}</td>
            </tr>
          </table>
          <p style="margin:0;font-size:11px;color:${MUTED_HEX};line-height:1.5;">
            View your full invoice history: <a href="https://${ROOT}/dashboard/billing" style="color:${RED_HEX};text-decoration:none;font-weight:600;">billing dashboard →</a>
            &nbsp;·&nbsp; Questions? Reply to this email.
          </p>
        </div>
        <div style="padding:12px 28px;border-top:1px solid ${BORDER_HEX};font-size:11px;color:${MUTED_HEX};">
          Sent by Virtual Closer · <a href="https://${ROOT}" style="color:${RED_HEX};text-decoration:none;">${ROOT}</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
    text: [
      `Hi ${name},`,
      ``,
      `Your Virtual Closer weekly charge of ${dollars} was processed.`,
      ``,
      ...lineItems.map((l) => `  ${l.description}: ${formatCents(l.amountCents)}`),
      ``,
      `Total: ${dollars}`,
      `Invoice #: ${invoiceNumber}`,
      ``,
      `View billing: https://${ROOT}/dashboard/billing`,
      ``,
      `— Virtual Closer`,
    ].join('\n'),
    attachments: pdfBuffer
      ? [{ filename: `VC-Receipt-${invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
      : undefined,
  })
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
