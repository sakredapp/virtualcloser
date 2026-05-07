// Webhook handler for vc_kind === 'onboarding_build_fee'
//
// Called after a client pays via the /onboard/[token] flow.
// The token already has signature_name + signed_at (they signed before paying).
// This handler:
//  1. Marks the token paid_at
//  2. Creates the owner member
//  3. Calls recordSignature() with the stored name
//  4. Sends the welcome email
//  5. Marks welcome_sent_at

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { createMember } from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { generatePassword, sendEmail, welcomeEmail } from '@/lib/email'
import { recordSignature } from '@/lib/liabilityAgreement'
import { telegramBotUsername } from '@/lib/telegram'
import { TIER_INFO } from '@/lib/onboarding'

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

  const signatureName = (tokenRow.signature_name as string | null) ?? ''

  await supabase
    .from('onboarding_tokens')
    .update({ paid_at: new Date().toISOString() })
    .eq('token', onboardingToken)

  const { data: rep } = await supabase
    .from('reps')
    .select('id, email, display_name, slug, tier')
    .eq('id', repId)
    .maybeSingle()

  if (!rep?.email) {
    console.error('[provisionOnboarding] rep has no email', repId)
    return
  }

  // Idempotent: if owner already exists, just mark done
  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', repId)
    .eq('role', 'owner')
    .maybeSingle()

  if (existing) {
    await markWelcomeSent(onboardingToken)
    return
  }

  const password = generatePassword()
  const passwordHash = await hashPassword(password)

  const member = await createMember({
    repId,
    email: rep.email as string,
    displayName: rep.display_name as string,
    role: 'owner',
    passwordHash,
  })

  if (signatureName) {
    await recordSignature({
      repId,
      memberId: member.id,
      signatureName,
      workspaceLabel: rep.display_name as string,
    }).catch((err) => console.error('[provisionOnboarding] recordSignature failed', err))
  }

  const tierLabel = (
    TIER_INFO[(rep.tier as 'individual' | 'enterprise') ?? 'individual'] ?? TIER_INFO.individual
  ).label

  const tpl = welcomeEmail({
    toEmail: rep.email as string,
    displayName: rep.display_name as string,
    slug: rep.slug as string,
    password,
    telegramLinkCode: member.telegram_link_code,
    telegramBotUsername: telegramBotUsername(),
    tierLabel,
  })

  await sendEmail({
    to: rep.email as string,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  }).catch((err) => console.error('[provisionOnboarding] welcome email failed', err))

  await markWelcomeSent(onboardingToken)

  // Stamp the rep as pending activation (build fee paid, awaiting subscription)
  await supabase
    .from('reps')
    .update({ billing_status: 'pending_activation', build_fee_paid_at: new Date().toISOString() })
    .eq('id', repId)
}

async function markWelcomeSent(token: string) {
  await supabase
    .from('onboarding_tokens')
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq('token', token)
}
