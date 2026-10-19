// Core logic for generating an onboarding token + Whop build-fee checkout.
// Called from both the API route and the admin server action.

import { createOneTimeCheckout, CXO_WHOP_KINDS } from '@/lib/billing/whop'
import { supabase } from '@/lib/supabase'
import { generateNonce } from '@/lib/random'
import { getBrand } from '@/lib/brand'
import { onboardingUrl } from '@/lib/onboardingUrl'

export async function createOnboardingToken(client: {
  id: string
  display_name: string
  email?: string | null
  build_fee?: number | string | null
  brand?: string | null
}): Promise<{ ok: true; url: string; token: string } | { ok: false; error: string }> {
  const buildFeeCents = Math.round((Number(client.build_fee) || 0) * 100)
  // The link lives on the tenant's own brand domain (suitecxo.com for CXO);
  // the Vercel ROOT_DOMAIN env is not the brand.
  const brand = getBrand(client.brand)
  const token = generateNonce(24) // 48-char hex, URL-safe

  // Cancel any previous unpaid token for this client so only one is active.
  await supabase
    .from('onboarding_tokens')
    .delete()
    .eq('rep_id', client.id)
    .is('paid_at', null)

  let checkoutUrl: string | null = null
  let whopCheckoutId: string | null = null

  if (buildFeeCents > 0) {
    // Whop checkout (owner 2026-10-19: everything bills on Whop). The
    // payment.succeeded webhook carries this metadata back to provision.
    try {
      const checkout = await createOneTimeCheckout({
        repId: client.id,
        kind: CXO_WHOP_KINDS.buildFee,
        amountCents: buildFeeCents,
        title: `${brand.name} build fee`,
        redirectUrl: `${onboardingUrl(brand.key, token)}?paid=1`,
        metadata: { onboarding_token: token },
      })
      checkoutUrl = checkout.purchase_url
      whopCheckoutId = checkout.id
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[createOnboardingToken] Whop checkout failed', msg)
      return { ok: false, error: `Whop checkout failed: ${msg}` }
    }
  }

  const { error } = await supabase.from('onboarding_tokens').insert({
    rep_id: client.id,
    token,
    build_fee_cents: buildFeeCents,
    checkout_url: checkoutUrl,
    whop_checkout_id: whopCheckoutId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (error) {
    console.error('[createOnboardingToken] insert failed', error)
    return { ok: false, error: error.message }
  }

  return { ok: true, url: onboardingUrl(brand.key, token), token }
}
