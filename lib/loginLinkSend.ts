/**
 * Send a member their "Your login is ready" email: one set-your-password link
 * to https://<brand root>/reset-password?token=…, never a plaintext password,
 * never another channel. Used by every place that invites or welcomes a member:
 * admin "Send login link", admin one-click onboarding, the /onboard sign
 * route and the paid onboarding webhook.
 *
 * - A link with 1+ day left is re-sent as is (an earlier email keeps working);
 *   otherwise a fresh 64-hex token valid for 7 days is minted.
 * - Double-send guard: the send is claimed atomically on
 *   members.login_link_sent_at. A second send to the same member within
 *   2 minutes is refused and logged as "skipped duplicate". A failed send
 *   releases the claim so an immediate retry works.
 * - Outcome is logged on the client timeline (client_events).
 */
import { supabase } from '@/lib/supabase'
import { getBrand, type BrandKey } from '@/lib/brand'
import { loginLinkInviteEmail, sendEmail } from '@/lib/email'
import { generateNonce } from '@/lib/random'
import { addClientEvent } from '@/lib/admin-db'
import { loginLinkExpiresLabel, loginLinkUrl, pickLoginLinkToken } from '@/lib/loginLink'
import type { MemberRole } from '@/types'

export const LOGIN_LINK_DUPLICATE_WINDOW_MS = 2 * 60 * 1000

/** True when a send stamped at `lastSentAt` is still inside the 2-minute guard. */
export function isDuplicateLoginLinkSend(lastSentAt: string | null | undefined, now: number): boolean {
  if (!lastSentAt) return false
  const t = Date.parse(lastSentAt)
  if (!Number.isFinite(t)) return false
  return now - t < LOGIN_LINK_DUPLICATE_WINDOW_MS
}

export type SendLoginLinkResult =
  | { status: 'sent'; email: string; id?: string; reused: boolean; expiresAt: string }
  | { status: 'skipped_duplicate'; email: string }
  | { status: 'failed'; error: string; email?: string }

type MemberRow = {
  id: string
  rep_id: string
  email: string | null
  display_name: string | null
  role: MemberRole
  is_active: boolean
  password_reset_token: string | null
  password_reset_expires_at: string | null
  login_link_sent_at: string | null
}

async function logEvent(repId: string, title: string): Promise<void> {
  try {
    await addClientEvent({ repId, kind: 'email', title })
  } catch (err) {
    console.error('[loginLinkSend] client event failed', err)
  }
}

export async function sendLoginLinkToMember(input: {
  repId: string
  memberId: string
  workspaceLabel: string
  brand: BrandKey | null | undefined
  /** Where the send came from, for the timeline ("onboarding", "admin"). */
  source?: string
  now?: number
}): Promise<SendLoginLinkResult> {
  const now = input.now ?? Date.now()
  const brandKey: BrandKey = getBrand(input.brand).key
  const via = input.source ? ` via ${input.source}` : ''

  const { data: row } = await supabase
    .from('members')
    .select(
      'id, rep_id, email, display_name, role, is_active, password_reset_token, password_reset_expires_at, login_link_sent_at',
    )
    .eq('id', input.memberId)
    .maybeSingle()
  const m = row as MemberRow | null
  if (!m || m.rep_id !== input.repId || !m.is_active || !m.email) {
    return { status: 'failed', error: 'member not found or inactive' }
  }

  // Atomic claim: only one request inside the window gets past this, even
  // when two clicks land at the same moment.
  const nowIso = new Date(now).toISOString()
  const cutoffIso = new Date(now - LOGIN_LINK_DUPLICATE_WINDOW_MS).toISOString()
  let claimedOk = false
  if (!isDuplicateLoginLinkSend(m.login_link_sent_at, now)) {
    const { data: claimed, error: claimErr } = await supabase
      .from('members')
      .update({ login_link_sent_at: nowIso })
      .eq('id', m.id)
      .or(`login_link_sent_at.is.null,login_link_sent_at.lt."${cutoffIso}"`)
      .select('id')
    if (claimErr) return { status: 'failed', error: claimErr.message, email: m.email }
    claimedOk = Array.isArray(claimed) && claimed.length > 0
  }
  if (!claimedOk) {
    await logEvent(
      input.repId,
      `Login link to ${m.email} skipped duplicate${via} (one was sent under 2 minutes ago)`,
    )
    return { status: 'skipped_duplicate', email: m.email }
  }

  const release = async () => {
    await supabase
      .from('members')
      .update({ login_link_sent_at: m.login_link_sent_at })
      .eq('id', m.id)
      .eq('login_link_sent_at', nowIso)
  }

  const link = pickLoginLinkToken(
    { token: m.password_reset_token, expiresAt: m.password_reset_expires_at },
    now,
    () => generateNonce(32), // 64-char hex
  )
  if (!link.reused) {
    const { error } = await supabase
      .from('members')
      .update({ password_reset_token: link.token, password_reset_expires_at: link.expiresAt })
      .eq('id', m.id)
    if (error) {
      await release()
      await logEvent(input.repId, `Login link email FAILED for ${m.email}${via}: ${error.message}`)
      return { status: 'failed', error: error.message, email: m.email }
    }
  }

  const brand = getBrand(brandKey)
  const tpl = loginLinkInviteEmail({
    toEmail: m.email,
    displayName: m.display_name || m.email,
    workspaceLabel: input.workspaceLabel,
    role: m.role,
    setUrl: loginLinkUrl(brand.rootDomain, link.token),
    expiresLabel: loginLinkExpiresLabel(link.expiresAt),
    brand: brandKey,
  })
  const result = await sendEmail({
    to: m.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    brand: brandKey,
  }).catch((err: unknown) => ({ ok: false as const, id: undefined, error: err instanceof Error ? err.message : String(err) }))

  if (!result.ok) {
    await release()
    await logEvent(input.repId, `Login link email FAILED for ${m.email}${via}: ${result.error ?? 'unknown'}`)
    return { status: 'failed', error: result.error ?? 'unknown', email: m.email }
  }
  await logEvent(
    input.repId,
    `Login link sent to ${m.email}${via} (${link.reused ? 'existing' : 'new'} link, Resend id ${result.id ?? '?'})`,
  )
  return { status: 'sent', email: m.email, id: result.id, reused: link.reused, expiresAt: link.expiresAt }
}

/** The tenant's owner member (oldest first if there are several), or null. */
export async function findOwnerMember(repId: string): Promise<{ id: string; email: string | null } | null> {
  const { data } = await supabase
    .from('members')
    .select('id, email')
    .eq('rep_id', repId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string; email: string | null } | null) ?? null
}
