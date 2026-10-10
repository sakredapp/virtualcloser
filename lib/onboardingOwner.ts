/**
 * After a client signs the /onboard agreement (free build) or pays the build
 * fee (Stripe webhook): make sure the tenant has an owner member, record the
 * signature against that owner, and email them the "Your login is ready"
 * set-password link. Never a plaintext password.
 *
 * - Owner already exists (e.g. created by the admin before the link went
 *   out): the signature is recorded against them and they get the login link.
 * - No owner yet: one is created with an unusable random password hash (they
 *   set their own from the link).
 * - Idempotent on onboarding_tokens.welcome_sent_at; the login-link sender
 *   also refuses a second send inside 2 minutes.
 */
import { supabase } from '@/lib/supabase'
import { getBrand, type BrandKey } from '@/lib/brand'
import { createMember } from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { generateNonce } from '@/lib/random'
import { recordSignature } from '@/lib/liabilityAgreement'
import { addClientEvent } from '@/lib/admin-db'
import { findOwnerMember, sendLoginLinkToMember, type SendLoginLinkResult } from '@/lib/loginLinkSend'

export type OnboardingOwnerResult =
  | { status: 'already_done' }
  | { status: 'no_email' }
  | {
      status: 'done'
      memberId: string
      ownerCreated: boolean
      signature: 'recorded' | 'failed' | 'skipped'
      email: SendLoginLinkResult
    }

export async function provisionOnboardingOwner(args: {
  token: string
  repId: string
  signatureName: string
  ip?: string | null
  ua?: string | null
  source: string
}): Promise<OnboardingOwnerResult> {
  const { data: tokenRow } = await supabase
    .from('onboarding_tokens')
    .select('welcome_sent_at')
    .eq('token', args.token)
    .maybeSingle()
  if ((tokenRow as { welcome_sent_at?: string | null } | null)?.welcome_sent_at) {
    return { status: 'already_done' }
  }

  const ensured = await ensureOwnerMember(args.repId)
  if (!ensured) return { status: 'no_email' }
  const { owner, ownerCreated, brand, workspaceLabel } = ensured

  let signature: 'recorded' | 'failed' | 'skipped' = 'skipped'
  if (args.signatureName.trim()) {
    const sig = await recordSignature({
      repId: args.repId,
      memberId: owner.id,
      signatureName: args.signatureName.trim(),
      signedIp: args.ip ?? null,
      signedUserAgent: args.ua ?? null,
      workspaceLabel,
      brand,
    }).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    signature = sig.ok ? 'recorded' : 'failed'
    if (!sig.ok) console.error('[onboarding] recordSignature failed', args.repId, sig.error)
  }

  const email = await sendLoginLinkToMember({
    repId: args.repId,
    memberId: owner.id,
    workspaceLabel,
    brand,
    source: args.source,
  })

  // A duplicate skip means a login link went out moments ago, so the welcome
  // is done either way. A failure leaves welcome_sent_at empty (visible on the
  // admin card; "Send login link" on Members retries).
  if (email.status !== 'failed') {
    await supabase
      .from('onboarding_tokens')
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq('token', args.token)
  }

  return { status: 'done', memberId: owner.id, ownerCreated, signature, email }
}

type EnsuredOwner = {
  owner: { id: string; email: string | null }
  ownerCreated: boolean
  brand: BrandKey
  workspaceLabel: string
}

/**
 * The tenant's owner member, created from reps.email if there is none yet
 * (unusable random password hash; they set their own from the login link).
 * Null when there is no owner and no email to create one from.
 */
export async function ensureOwnerMember(repId: string): Promise<EnsuredOwner | null> {
  const { data: repRow } = await supabase
    .from('reps')
    .select('id, email, display_name, company, brand')
    .eq('id', repId)
    .maybeSingle()
  const rep = repRow as {
    id: string
    email: string | null
    display_name: string | null
    company: string | null
    brand: BrandKey | null
  } | null
  const brand = getBrand(rep?.brand).key
  const workspaceLabel = rep?.company || rep?.display_name || 'your workspace'

  const existing = await findOwnerMember(repId)
  if (existing) return { owner: existing, ownerCreated: false, brand, workspaceLabel }

  if (!rep?.email) {
    console.error('[onboarding] no owner member and no rep email; cannot provision', repId)
    return null
  }
  const passwordHash = await hashPassword(generateNonce(32))
  const member = await createMember({
    repId,
    email: rep.email,
    displayName: rep.display_name || rep.email,
    role: 'owner',
    passwordHash,
  })
  return { owner: { id: member.id, email: member.email }, ownerCreated: true, brand, workspaceLabel }
}

/**
 * Admin one-click: email the tenant's owner their "Your login is ready" link
 * (creating the owner member first if needed). Guarded against double sends.
 */
export async function sendOwnerLoginLink(repId: string, source = 'admin one-click'): Promise<SendLoginLinkResult> {
  const ensured = await ensureOwnerMember(repId)
  if (!ensured) {
    try {
      await addClientEvent({ repId, kind: 'email', title: 'Login link FAILED: no owner member and no email on file' })
    } catch {
      /* timeline is best effort */
    }
    return { status: 'failed', error: 'no owner member and no email on file' }
  }
  return sendLoginLinkToMember({
    repId,
    memberId: ensured.owner.id,
    workspaceLabel: ensured.workspaceLabel,
    brand: ensured.brand,
    source,
  })
}
