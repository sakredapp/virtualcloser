// Provision a tenant from a successful build-fee Checkout (mode='payment').
//
// Different from provisionFromCheckout (which expects a subscription was
// also created at the same time):
//   • No subscription yet — billing_status='pending_activation'.
//   • Saved payment method stashed on reps for off-session sub creation
//     later (admin-driven via /api/admin/billing/[repId]/activate-subscription).
//   • Cart shape snapshot stored in reps.pending_plan so admin knows what
//     plan to spin up.
//   • Prospect linkage: matched by email/phone, or a synthetic row is
//     created so /admin/clients always reconciles one-to-one.

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { getStripe } from './stripe'
import { getCart, markCartConverted } from './cart'
import { matchAndConvertProspect } from './prospects'
import { audit } from './auditLog'
import { autoAdvanceStage } from '@/lib/pipeline'
import { sendEmail } from '@/lib/email'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export type BuildFeeProvisionResult = {
  repId: string
  memberId: string
  prospectId: string | null
  isNewRep: boolean
  isNewMember: boolean
}

export async function provisionFromBuildFeeCheckout(
  session: Stripe.Checkout.Session,
): Promise<BuildFeeProvisionResult | null> {
  const cartId = session.metadata?.cart_id
  if (!cartId) return null
  if (session.metadata?.vc_kind !== 'build_fee_checkout') return null

  const cart = await getCart(cartId)
  if (!cart) {
    console.warn('[provisionBuildFee] cart not found', { cartId, sessionId: session.id })
    return null
  }
  if (cart.convertedAt) {
    // Idempotency: webhook retry. Look up the existing rep + member.
    const { data } = await supabase
      .from('carts')
      .select('converted_rep_id, converted_member_id')
      .eq('id', cartId)
      .maybeSingle()
    if (data?.converted_rep_id && data?.converted_member_id) {
      return {
        repId: data.converted_rep_id as string,
        memberId: data.converted_member_id as string,
        prospectId: null,
        isNewRep: false,
        isNewMember: false,
      }
    }
    return null
  }

  const stripe = getStripe()
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null
  if (!customerId) throw new Error('[provisionBuildFee] no customer on session')

  const email = (cart.email ?? session.customer_details?.email ?? '').toLowerCase().trim()
  if (!email) throw new Error('[provisionBuildFee] no email on cart or session')

  const displayName = cart.displayName ?? session.customer_details?.name ?? email.split('@')[0]
  const company = cart.company ?? null
  const phone = cart.phone ?? session.customer_details?.phone ?? null
  const scope: 'individual' | 'team' | 'enterprise' = cart.tier
  const volumeTier = session.metadata?.vc_volume_tier ?? 't1'

  // Pull the saved payment method off the PaymentIntent so we can store it
  // on the customer for off-session sub creation.
  let paymentMethodId: string | null = null
  let buildFeePaidCents = 0
  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
      paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null
      buildFeePaidCents = pi.amount_received ?? pi.amount ?? 0
      if (paymentMethodId) {
        // Make it the default for this customer so future invoices auto-charge it.
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        })
      }
    } catch (err) {
      console.warn('[provisionBuildFee] failed to retrieve payment intent', err)
    }
  }

  // Find / create rep.
  let repId: string | null = null
  let isNewRep = false
  const { data: existingByCustomer } = await supabase
    .from('reps')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (existingByCustomer?.id) {
    repId = existingByCustomer.id as string
  } else {
    const { data: existingByEmail } = await supabase
      .from('reps')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    if (existingByEmail?.id) repId = existingByEmail.id as string
  }

  const pendingPlan = {
    scope,
    rep_count: cart.repCount,
    weekly_hours: cart.weeklyHours,
    trainer_weekly_hours: cart.trainerWeeklyHours ?? 0,
    overflow_enabled: !!cart.overflowEnabled,
    volume_tier: volumeTier,
    addons: cart.addons ?? [],
    build_fee_paid_cents: buildFeePaidCents,
    build_fee_paid_at: new Date().toISOString(),
  }

  if (!repId) {
    isNewRep = true
    const slug = await uniqueSlug(displayName, email)
    const id = `rep_${crypto.randomBytes(8).toString('hex')}`
    const { error } = await supabase.from('reps').insert({
      id,
      slug,
      display_name: displayName,
      company,
      email,
      tier: scope === 'team' ? 'team' : scope === 'enterprise' ? 'enterprise' : 'individual',
      is_active: true,
      stripe_customer_id: customerId,
      pending_payment_method_id: paymentMethodId,
      default_payment_method_id: paymentMethodId,
      pending_plan: pendingPlan,
      billing_status: 'pending_activation',
      build_fee_paid_at: new Date().toISOString(),
      build_fee_paid_cents: buildFeePaidCents,
      build_fee_payment_intent_id: paymentIntentId,
      volume_tier: volumeTier,
      weekly_hours_quota: cart.weeklyHours,
      overflow_enabled: !!cart.overflowEnabled,
    })
    if (error) throw error
    repId = id
  } else {
    await supabase
      .from('reps')
      .update({
        stripe_customer_id: customerId,
        pending_payment_method_id: paymentMethodId,
        default_payment_method_id: paymentMethodId,
        pending_plan: pendingPlan,
        billing_status: 'pending_activation',
        build_fee_paid_at: new Date().toISOString(),
        build_fee_paid_cents: buildFeePaidCents,
        build_fee_payment_intent_id: paymentIntentId,
        volume_tier: volumeTier,
        weekly_hours_quota: cart.weeklyHours,
        overflow_enabled: !!cart.overflowEnabled,
      })
      .eq('id', repId)
  }

  // Find / create member (owner).
  let memberId: string | null = null
  let isNewMember = false
  const { data: existingMember } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', repId)
    .ilike('email', email)
    .maybeSingle()
  if (existingMember?.id) {
    memberId = existingMember.id as string
  } else {
    isNewMember = true
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
    const { data: created, error } = await supabase
      .from('members')
      .insert({
        rep_id: repId,
        email,
        display_name: displayName,
        role: 'owner',
        password_hash: placeholderHash,
        is_active: true,
        telegram_link_code: crypto.randomBytes(4).toString('hex').toUpperCase(),
        timezone: 'UTC',
        invited_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error
    memberId = created.id as string
  }

  // Match (or synthesize) a prospect row.
  let prospectId: string | null = null
  try {
    const match = await matchAndConvertProspect({
      email,
      phone,
      displayName,
      company,
      repId,
      scope,
    })
    if (match) {
      prospectId = match.prospectId
      await supabase.from('reps').update({ prospect_id: prospectId }).eq('id', repId)
      // Push the deal forward in the Kanban — payment landed.
      await autoAdvanceStage({ prospectId, targetStage: 'payment_made' }).catch(() => {})
    }
  } catch (err) {
    console.warn('[provisionBuildFee] prospect match failed', err)
  }

  await markCartConverted({ cartId: cart.id, repId, memberId })

  await audit({
    actorKind: 'webhook',
    actorId: session.id,
    action: 'build_fee.paid',
    repId,
    memberId,
    stripeObjectId: paymentIntentId ?? session.id,
    amountCents: buildFeePaidCents,
    notes: `${scope} · ${cart.repCount} reps · sub awaiting admin activation`,
    after: pendingPlan,
  }).catch(() => {})

  // Send the customer their welcome / "what happens next" email.
  const token = signWelcomeToken(memberId)
  const { data: rep } = await supabase.from('reps').select('slug').eq('id', repId).single()
  const subdomain = (rep as { slug?: string } | null)?.slug
  const url = `https://${subdomain ?? 'app'}.${ROOT}/welcome?token=${token}`
  sendEmail({
    to: email,
    subject: 'Build fee received — your Virtual Closer build is queued',
    html: buildFeeReceiptHtml({ displayName, url, paidCents: buildFeePaidCents, pendingPlan }),
    text: `Build fee received. We're putting your build together — you'll get an email the moment it's live and weekly billing kicks in. Set your password: ${url}`,
  }).catch((err) => console.error('[provisionBuildFee] welcome email failed', err))

  // Notify admin so they know to start the build.
  if (process.env.ADMIN_NOTIFY_EMAIL) {
    sendEmail({
      to: process.env.ADMIN_NOTIFY_EMAIL,
      subject: `[Virtual Closer] New paid build · ${displayName}${company ? ' · ' + company : ''}`,
      html: `
        <p><strong>${escapeHtml(displayName)}</strong> just paid the build fee.</p>
        <p>Scope: ${scope} · ${cart.repCount} reps · build fee $${(buildFeePaidCents / 100).toFixed(2)}</p>
        <p>Configured plan: ${cart.weeklyHours}h/wk SDR${(cart.trainerWeeklyHours ?? 0) > 0 ? ` · ${cart.trainerWeeklyHours}h/wk Trainer` : ''}${cart.overflowEnabled ? ' · overflow on' : ''}</p>
        <p>Add-ons: ${(cart.addons ?? []).join(', ') || 'none'}</p>
        <p><a href="https://${ROOT}/admin/billing/customers/${repId}">Open in admin →</a></p>
      `,
      text: `${displayName} paid build fee. Scope: ${scope}, ${cart.repCount} reps. https://${ROOT}/admin/billing/customers/${repId}`,
    }).catch(() => {})
  }

  return { repId, memberId, prospectId, isNewRep, isNewMember }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function uniqueSlug(displayName: string, email: string): Promise<string> {
  const base = (displayName || email.split('@')[0])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || `c${Date.now().toString(36)}`
  let candidate = base
  let n = 1
  while (true) {
    const { data } = await supabase.from('reps').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
    n += 1
    candidate = `${base}-${n}`
    if (n > 50) {
      candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`
      return candidate
    }
  }
}

function signWelcomeToken(memberId: string): string {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret'
  const ts = Date.now()
  const payload = `${memberId}.${ts}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32)
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

function buildFeeReceiptHtml(args: {
  displayName: string
  url: string
  paidCents: number
  pendingPlan: { weekly_hours: number; trainer_weekly_hours: number; rep_count: number; scope: string }
}): string {
  return `
    <p>Hey ${escapeHtml(args.displayName)},</p>
    <p>Your build fee of <strong>$${(args.paidCents / 100).toFixed(2)}</strong> is in. We're putting your Virtual Closer build together now.</p>
    <p><strong>What happens next:</strong></p>
    <ul>
      <li>Our team builds your dashboard, integrations, and AI configuration.</li>
      <li>You'll get an email the moment it's live.</li>
      <li>Weekly billing starts <strong>only when the build is live</strong> — not before.</li>
    </ul>
    <p>While we build, set up your password and poke around the dashboard:</p>
    <p><a href="${args.url}" style="display:inline-block;background:#ff2800;color:#fff;padding:12px 18px;border-radius:8px;font-weight:bold;text-decoration:none">Set your password →</a></p>
    <p>Questions? Just hit reply.</p>
    <p>— Virtual Closer</p>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
