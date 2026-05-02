// POST /api/checkout/build-fee
//
// Creates a Stripe Checkout Session in `mode='payment'` (one-time charge)
// for the build fee + saves the customer's payment method for later
// off-session use. The recurring subscription is NOT created here — it's
// created later by an admin via /api/admin/billing/[repId]/activate-subscription
// once the actual build is ready to go live.
//
// Body: { cartId: string, successPath?: string, cancelPath?: string }

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { getCart, markCartCheckoutSession, priceCart } from '@/lib/billing/cart'
import { buildFeeCents } from '@/lib/billing/buildFee'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  }
  let body: { cartId?: string; successPath?: string; cancelPath?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }
  if (!body.cartId) {
    return NextResponse.json({ ok: false, reason: 'no_cart_id' }, { status: 400 })
  }

  const cart = await getCart(body.cartId)
  if (!cart) return NextResponse.json({ ok: false, reason: 'cart_not_found' }, { status: 404 })
  if (cart.convertedAt) {
    return NextResponse.json({ ok: false, reason: 'cart_already_converted' }, { status: 409 })
  }
  if (new Date(cart.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ ok: false, reason: 'cart_expired' }, { status: 410 })
  }

  if (cart.tier === 'enterprise') {
    // Enterprise still goes through Begin Build, but capped at sales-led
    // quoting. We still let them pay the build fee upfront — checkout
    // proceeds, but enterprise sub activation always involves the call.
  }

  const scope = cart.tier === 'team' ? 'enterprise' : (cart.tier === 'enterprise' ? 'enterprise' : 'individual')
  const feeCents = buildFeeCents(scope, cart.repCount)
  if (feeCents <= 0) {
    return NextResponse.json({ ok: false, reason: 'no_build_fee' }, { status: 400 })
  }

  // Recompute the planned subscription price for metadata so the admin
  // can see what was configured at checkout time.
  const priced = priceCart(cart)
  const plannedMonthlyCents = priced.subtotalCents

  const stripe = getStripe()
  const baseUrl = `https://${ROOT}`
  const successUrl = `${baseUrl}${body.successPath ?? '/welcome'}?session_id={CHECKOUT_SESSION_ID}&flow=build_fee`
  const cancelUrl = `${baseUrl}${body.cancelPath ?? '/offer'}?cart=${cart.id}`

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: feeCents,
          product_data: {
            name: 'Virtual Closer — One-Time Build Fee',
            description: scope === 'individual'
              ? 'Onboarding, build, and integration setup. Weekly subscription starts when build goes live.'
              : `Custom enterprise build for ${cart.repCount} reps. Weekly subscription starts when build goes live.`,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: cart.email ?? undefined,
    client_reference_id: cart.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    payment_method_types: ['card'],
    // CRITICAL: keeps the payment method attached to the customer for
    // off-session subscription creation later (admin activation flow).
    payment_intent_data: {
      setup_future_usage: 'off_session',
      metadata: {
        cart_id: cart.id,
        kind: 'build_fee',
        scope,
      },
    },
    // Tell Stripe to create + persist a Customer (not just charge).
    customer_creation: 'always',
    metadata: {
      cart_id: cart.id,
      vc_kind: 'build_fee_checkout',
      vc_scope: scope,
      vc_planned_monthly_cents: String(plannedMonthlyCents),
      vc_weekly_hours: String(cart.weeklyHours),
      vc_trainer_weekly_hours: String(cart.trainerWeeklyHours ?? 0),
      vc_overflow_enabled: cart.overflowEnabled ? '1' : '0',
      vc_volume_tier: priced.tier,
      vc_rep_count: String(cart.repCount),
      vc_email: cart.email ?? '',
      vc_company: cart.company ?? '',
      vc_phone: cart.phone ?? '',
      vc_display_name: cart.displayName ?? '',
      vc_addons: (cart.addons ?? []).join(','),
    },
  })

  await markCartCheckoutSession(cart.id, session.id)

  return NextResponse.json({ ok: true, url: session.url, sessionId: session.id })
}
