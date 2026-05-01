// Stripe SDK init — single shared instance across server-side billing code.
//
// We use the latest pinned API version so behavior is reproducible across
// SDK upgrades. Bumping API version is intentional — never auto-track.
//
// Env vars (all server-side):
//   STRIPE_SECRET_KEY       — sk_live_… or sk_test_…
//   STRIPE_WEBHOOK_SECRET   — whsec_… (for /api/billing/webhook signature)
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — pk_… (client-side Elements)

import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it to your env (Vercel project settings) before using billing endpoints.',
    )
  }
  _stripe = new Stripe(key, {
    // Pin to a stable version so server changes don't surprise us.
    // @ts-expect-error — Stripe ships TS types for the current default; the
    // pinned version may lag the type definitions until we upgrade.
    apiVersion: '2024-12-18.acacia',
    appInfo: { name: 'VirtualCloser', version: '1.0.0' },
  })
  return _stripe
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function stripeWebhookSecret(): string {
  const v = process.env.STRIPE_WEBHOOK_SECRET
  if (!v) throw new Error('STRIPE_WEBHOOK_SECRET is not set.')
  return v
}
