// Provision a new tenant from a successful Stripe Checkout Session.
//
// Called from the webhook on checkout.session.completed when the session
// has a `cart_id` metadata key. Creates (or reuses) a `reps` row, creates
// a `members` row for the buyer, attaches the Stripe subscription, and
// emails them a magic link to set their password.

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { getStripe } from './stripe'
import { getCart, markCartConverted } from './cart'
import { weekBoundsForDate } from './weekly'
import { buildFeeCents, buildFeeLineItem } from './buildFee'
import { audit } from './auditLog'
import { sendEmail } from '@/lib/email'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

type ProvisionResult = {
  repId: string
  memberId: string
  isNewRep: boolean
  isNewMember: boolean
}

export async function provisionFromCheckout(session: Stripe.Checkout.Session): Promise<ProvisionResult | null> {
  const cartId = session.metadata?.cart_id
  if (!cartId) return null

  const cart = await getCart(cartId)
  if (!cart) {
    console.warn('[provision] cart not found for checkout session', { cartId, sessionId: session.id })
    return null
  }
  if (cart.convertedAt) {
    // Already provisioned — webhook retry, no-op.
    const { data } = await supabase
      .from('carts')
      .select('converted_rep_id, converted_member_id')
      .eq('id', cartId)
      .maybeSingle()
    if (data?.converted_rep_id && data?.converted_member_id) {
      return {
        repId: data.converted_rep_id as string,
        memberId: data.converted_member_id as string,
        isNewRep: false,
        isNewMember: false,
      }
    }
    return null
  }

  const stripe = getStripe()
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (!customerId || !subscriptionId) {
    throw new Error('[provision] checkout session missing customer or subscription')
  }

  const email = (cart.email ?? session.customer_details?.email ?? '').toLowerCase().trim()
  if (!email) throw new Error('[provision] no email on cart or session')

  const displayName = cart.displayName ?? session.customer_details?.name ?? email.split('@')[0]
  const company = cart.company ?? null
  const phone = cart.phone ?? session.customer_details?.phone ?? null

  // Try to find an existing rep with this customer id (org tier) or email.
  let repId: string | null = null
  let isNewRep = false
  const { data: existingByCustomer } = await supabase
    .from('reps')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (existingByCustomer?.id) {
    repId = existingByCustomer.id as string
  } else if (cart.tier === 'team') {
    // Team tier: org Customer is on `reps`. Email match too.
    const { data: byEmail } = await supabase
      .from('reps')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (byEmail?.id) repId = byEmail.id as string
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
      tier: cart.tier === 'team' ? 'team' : 'individual',
      is_active: true,
      stripe_customer_id: cart.tier === 'team' ? customerId : null,
      stripe_subscription_id: cart.tier === 'team' ? subscriptionId : null,
      weekly_hours_quota: cart.weeklyHours,
      overflow_enabled: cart.overflowEnabled,
      volume_tier: session.metadata?.vc_volume_tier ?? 't1',
      billing_status: cart.tier === 'team' ? 'active' : 'none',
    })
    if (error) throw error
    repId = id
  } else if (cart.tier === 'team') {
    const { weekStart, weekEnd } = weekBoundsForDate()
    await supabase
      .from('reps')
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        weekly_hours_quota: cart.weeklyHours,
        overflow_enabled: cart.overflowEnabled,
        volume_tier: session.metadata?.vc_volume_tier ?? 't1',
        billing_status: 'active',
        current_week_start: weekStart.toISOString(),
        current_week_end: weekEnd.toISOString(),
      })
      .eq('id', repId)
  }

  // Find or create the member.
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
    // Generate a one-time password the email can set; store a placeholder
    // hash so the welcome flow forces a real password.
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
    const { data: created, error } = await supabase
      .from('members')
      .insert({
        rep_id: repId,
        email,
        display_name: displayName,
        role: 'owner',                 // first member = owner
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

  // Create / update agent_billing for individual scope.
  if (cart.tier === 'individual') {
    const { weekStart, weekEnd } = weekBoundsForDate()
    await supabase
      .from('agent_billing')
      .upsert({
        member_id: memberId,
        rep_id: repId,
        payer_model: 'self',
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        weekly_hours_quota: cart.weeklyHours,
        overflow_enabled: cart.overflowEnabled,
        volume_tier: session.metadata?.vc_volume_tier ?? 't1',
        status: 'active',
        current_week_start: weekStart.toISOString(),
        current_week_end: weekEnd.toISOString(),
      }, { onConflict: 'member_id' })
  } else {
    // Team tier: org pays — but still create agent_billing so we can track
    // per-member usage and quota assignments.
    await supabase
      .from('agent_billing')
      .upsert({
        member_id: memberId,
        rep_id: repId,
        payer_model: 'org',
        stripe_customer_id: customerId,
        weekly_hours_quota: cart.weeklyHours, // owner gets full quota by default; manager re-allocates
        overflow_enabled: cart.overflowEnabled,
        volume_tier: session.metadata?.vc_volume_tier ?? 't1',
        status: 'active',
      }, { onConflict: 'member_id' })
  }

  await markCartConverted({ cartId: cart.id, repId, memberId })

  // One-time build fee. Attached to the customer with no `invoice` field —
  // Stripe rolls it into the next upcoming invoice for that customer
  // automatically. Idempotency: search existing invoiceItems by metadata
  // before creating, so webhook retries don't double-bill.
  const buildFeeScope: 'individual' | 'enterprise' = cart.tier === 'team' ? 'enterprise' : 'individual'
  const feeCents = buildFeeCents(buildFeeScope, cart.repCount)
  if (feeCents > 0) {
    try {
      const existingItems = await stripe.invoiceItems.list({ customer: customerId, limit: 50 })
      const already = existingItems.data.find((it) =>
        it.metadata?.cart_id === cart.id && it.metadata?.kind === 'build_fee'
      )
      if (!already) {
        const item = await stripe.invoiceItems.create({
          customer: customerId,
          amount: feeCents,
          currency: 'usd',
          description: buildFeeLineItem(buildFeeScope, cart.repCount)?.label ?? 'One-time build fee',
          metadata: {
            cart_id: cart.id,
            rep_id: repId,
            kind: 'build_fee',
            scope: buildFeeScope,
            rep_count: String(cart.repCount),
          },
        })
        await audit({
          actorKind: 'system',
          action: 'invoice_item.build_fee',
          repId,
          memberId,
          stripeObjectId: item.id,
          amountCents: feeCents,
          notes: `${buildFeeScope} · ${cart.repCount} reps`,
        }).catch(() => {})
      }
    } catch (err) {
      console.error('[provision] build fee invoice item failed', err)
      // Don't fail the whole provision — sales can add it manually if needed.
    }
  }

  // Magic-link welcome email. Token = HMAC of memberId + ts; verifier route
  // sets a fresh password and signs them in.
  const token = signWelcomeToken(memberId)
  const { data: rep } = await supabase.from('reps').select('slug').eq('id', repId).single()
  const subdomain = (rep as { slug?: string } | null)?.slug
  const url = `https://${subdomain ?? 'app'}.${ROOT}/welcome?token=${token}`
  await sendEmail({
    to: email,
    subject: 'Your Virtual Closer dashboard is ready',
    html: welcomeEmailHtml({ displayName, url, weeklyHours: cart.weeklyHours }),
    text: `Welcome to Virtual Closer. Set your password and get started: ${url}`,
  }).catch((err) => console.error('[provision] welcome email failed', err))

  return { repId, memberId, isNewRep, isNewMember }
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

function welcomeEmailHtml(args: { displayName: string; url: string; weeklyHours: number }): string {
  return `
    <p>Hey ${escapeHtml(args.displayName)},</p>
    <p>Your Virtual Closer account is live. You're set up for <strong>${args.weeklyHours} hours/week</strong> of AI dialer time, billed weekly each Monday.</p>
    <p><a href="${args.url}" style="display:inline-block;background:#ff2800;color:#fff;padding:12px 18px;border-radius:8px;font-weight:bold;text-decoration:none">Set your password and log in →</a></p>
    <p>This link is good for 24 hours. If you didn't sign up, ignore this email.</p>
    <p>— Virtual Closer</p>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
