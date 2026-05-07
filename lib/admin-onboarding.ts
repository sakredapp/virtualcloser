// Core logic for generating an onboarding token + Stripe checkout session.
// Called from both the API route and the admin server action.

import { getStripe } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { generateNonce } from '@/lib/random'

export async function createOnboardingToken(client: {
  id: string
  display_name: string
  email?: string | null
  build_fee?: number | string | null
}): Promise<{ ok: true; url: string; token: string } | { ok: false; error: string }> {
  const buildFeeCents = Math.round((Number(client.build_fee) || 0) * 100)
  const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
  const token = generateNonce(24) // 48-char hex, URL-safe

  // Cancel any previous unpaid token for this client so only one is active.
  await supabase
    .from('onboarding_tokens')
    .delete()
    .eq('rep_id', client.id)
    .is('paid_at', null)

  let checkoutUrl: string | null = null
  let stripeSessionId: string | null = null

  if (buildFeeCents > 0) {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: (client.email as string | null) ?? undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Virtual Closer — Setup & Build Fee',
              description: `One-time onboarding build for ${client.display_name}`,
            },
            unit_amount: buildFeeCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        vc_kind: 'onboarding_build_fee',
        rep_id: client.id,
        onboarding_token: token,
      },
      success_url: `https://${ROOT}/onboard/${token}?paid=1`,
      cancel_url: `https://${ROOT}/onboard/${token}`,
    })
    checkoutUrl = session.url
    stripeSessionId = session.id
  }

  const { error } = await supabase.from('onboarding_tokens').insert({
    rep_id: client.id,
    token,
    build_fee_cents: buildFeeCents,
    checkout_url: checkoutUrl,
    stripe_session_id: stripeSessionId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (error) {
    console.error('[createOnboardingToken] insert failed', error)
    return { ok: false, error: error.message }
  }

  return { ok: true, url: `https://${ROOT}/onboard/${token}`, token }
}
