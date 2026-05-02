// POST /api/checkout/session
//
// Loads the server-side cart, recomputes price from catalog, and creates a
// Stripe Checkout Session in subscription mode. Returns the hosted URL the
// browser redirects to.
//
// Body: { cartId: string, successPath?: string, cancelPath?: string }

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { getCart, markCartCheckoutSession, priceCart } from '@/lib/billing/cart'
import { billingCycleAnchorEpoch } from '@/lib/billing/weekly'

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

  const priced = priceCart(cart)
  if (priced.lineItems.length === 0) {
    return NextResponse.json({ ok: false, reason: 'empty_cart' }, { status: 400 })
  }

  const stripe = getStripe()
  // Build subscription line items. Metered prices in subscription mode in
  // Checkout cannot have a quantity, so we strip it.
  type CheckoutLineItem = NonNullable<Stripe.Checkout.SessionCreateParams['line_items']>[number]
  const lineItems: CheckoutLineItem[] = priced.lineItems.map((li) => {
    const item: CheckoutLineItem = { price: li.price }
    if (li.quantity != null) item.quantity = li.quantity
    return item
  })

  const baseUrl = `https://${ROOT}`
  const successUrl = `${baseUrl}${body.successPath ?? '/welcome'}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}${body.cancelPath ?? '/offer'}?cart=${cart.id}`

  // Enterprise tier never goes through self-serve Checkout.
  if (cart.tier === 'enterprise') {
    return NextResponse.json(
      { ok: false, reason: 'enterprise_use_send_invoice' },
      { status: 400 },
    )
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: lineItems,
    customer_email: cart.email ?? undefined,
    client_reference_id: cart.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    automatic_tax: { enabled: false },
    payment_method_types: ['card'],
    subscription_data: {
      billing_cycle_anchor: billingCycleAnchorEpoch(),
      proration_behavior: 'create_prorations',
      metadata: {
        cart_id: cart.id,
        vc_scope: cart.tier === 'team' ? 'org' : 'member',
        vc_volume_tier: priced.tier,
        vc_weekly_hours: String(cart.weeklyHours),
        vc_trainer_weekly_hours: String(cart.trainerWeeklyHours ?? 0),
        vc_overflow_enabled: cart.overflowEnabled ? '1' : '0',
        vc_email: cart.email ?? '',
        vc_company: cart.company ?? '',
        vc_display_name: cart.displayName ?? '',
        vc_rep_count: String(cart.repCount),
      },
    },
    metadata: {
      cart_id: cart.id,
      vc_kind: 'offer_checkout',
    },
  })

  await markCartCheckoutSession(cart.id, session.id)

  return NextResponse.json({ ok: true, url: session.url, sessionId: session.id })
}
