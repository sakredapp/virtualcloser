// Webhook handler for vc_kind === 'onboarding_build_fee'
//
// Called after a client pays via the /onboard/[token] flow.
// The token already has signature_name + signed_at (+ signer IP / user agent)
// because they signed before paying. This handler:
//  1. Marks the token paid_at
//  2. Uses the existing owner member, or creates one (unusable random
//     password; they set their own from the link)
//  3. Records the signature against that owner
//  4. Emails the brand's "Your login is ready" set-password link
//     (never a plaintext password)
//  5. Marks welcome_sent_at

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { provisionOnboardingOwner } from '@/lib/onboardingOwner'

export async function provisionFromOnboardingCheckout(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const onboardingToken = session.metadata?.onboarding_token
  const repId = session.metadata?.rep_id
  if (!onboardingToken || !repId) {
    console.error('[provisionOnboarding] missing onboarding_token or rep_id in metadata', session.id)
    return
  }

  const { data: tokenRow } = await supabase
    .from('onboarding_tokens')
    .select('*')
    .eq('token', onboardingToken)
    .maybeSingle()

  if (!tokenRow) {
    console.error('[provisionOnboarding] token not found', onboardingToken)
    return
  }

  // Idempotent — already provisioned
  if (tokenRow.welcome_sent_at) return

  if (!tokenRow.paid_at) {
    await supabase
      .from('onboarding_tokens')
      .update({ paid_at: new Date().toISOString() })
      .eq('token', onboardingToken)
  }

  const result = await provisionOnboardingOwner({
    token: onboardingToken,
    repId,
    signatureName: (tokenRow.signature_name as string | null) ?? '',
    ip: (tokenRow.signed_ip as string | null) ?? null,
    ua: (tokenRow.signed_user_agent as string | null) ?? null,
    source: 'onboarding payment',
  })
  if (result.status === 'no_email') return

  // Build fee paid. A tenant that is already active stays active; anyone
  // else is pending activation (awaiting subscription).
  const { data: rep } = await supabase.from('reps').select('billing_status').eq('id', repId).maybeSingle()
  const patch: Record<string, unknown> = { build_fee_paid_at: new Date().toISOString() }
  if ((rep as { billing_status?: string | null } | null)?.billing_status !== 'active') {
    patch.billing_status = 'pending_activation'
  }
  await supabase.from('reps').update(patch).eq('id', repId)
}
