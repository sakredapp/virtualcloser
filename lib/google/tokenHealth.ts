/**
 * Google connection health (owner 2026-10-17): a connection must never die
 * silently.
 *
 * An Internal OAuth client (Pinnacle's) has no 7-day test-token expiry, but a
 * refresh token still dies when the person changes their Google password
 * (Gmail scopes), an admin or the person removes access, or it goes unused for
 * six months. Google then answers `invalid_grant`. When that happens:
 *
 *   - the row is flagged: google_tokens.needs_reconnect = true, with the reason
 *     and when (supabase/cxo_google_token_health.sql);
 *   - that person gets ONE in-app notice (cxo_followup_notices, which the
 *     Messages badge also raises as a browser notification). The flag only
 *     flips false → true once, so a dead token that keeps failing never sends
 *     a second one;
 *   - the dashboard shows the Reconnect Google bar and the Integrations page
 *     says "Needs reconnect" for that account;
 *   - a connect, reconnect or Google sign-in (lib/google saveTokens) clears the
 *     flag and marks the notice read.
 *
 * A 403 insufficient-scope on a calendar write (GoogleScopeError) flags the
 * row too (reason 'scope'), but the token keeps being used: only a dead grant
 * stops the refresh attempts.
 *
 * Never throws: health bookkeeping must not break the call that found it.
 * Before the migration runs the columns are missing; every write here then
 * does nothing.
 */
import { supabase } from '@/lib/supabase'
import { GOOGLE_RECONNECT_PREFIX } from '@/lib/followups/noticeActionsShared'

export type ReconnectReason = 'invalid_grant' | 'scope'

export type HealthRow = {
  id?: string | null
  rep_id: string
  member_id: string | null
  email?: string | null
  needs_reconnect?: boolean | null
  reconnect_reason?: string | null
  /** An outside calendar (calendar only): the notice speaks of the calendar alone. */
  calendar_only?: boolean | null
}

/** Google's token endpoint answered: this grant is gone (revoked, expired, password changed). */
export function isInvalidGrant(err: unknown): boolean {
  if (!err) return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === 'invalid_grant') return true
  return typeof e.message === 'string' && /\b400\b/.test(e.message) && /"error"\s*:\s*"invalid_grant"/.test(e.message)
}

/** A dead grant: stop calling Google with it until the person reconnects. */
export function isDeadGrant(row: Pick<HealthRow, 'needs_reconnect' | 'reconnect_reason'> | null | undefined): boolean {
  return Boolean(row?.needs_reconnect) && row?.reconnect_reason === 'invalid_grant'
}

export function reconnectNoticeKey(rowId: string, brokenAt: string): string {
  return `${GOOGLE_RECONNECT_PREFIX}${rowId}-${brokenAt.replace(/[^0-9]/g, '').slice(0, 14)}`
}

/** The notice text: what happened, why it happens, the one thing to do. */
export function reconnectNoticeText(
  email: string | null | undefined,
  reason: ReconnectReason,
  opts: { calendarOnly?: boolean } = {},
): { title: string; body: string } {
  const who = email ? ` (${email})` : ''
  if (opts.calendarOnly) {
    // An outside calendar (personal Gmail, another company): calendar only.
    return {
      title: 'Reconnect your calendar',
      body:
        reason === 'scope'
          ? `Your outside calendar${who} is missing a permission Suite CXO needs. Click Reconnect next to it on the Integrations page and approve every box.`
          : `Google stopped letting Suite CXO see your outside calendar${who}. This happens after a Google password change or when access is removed. Click Reconnect next to it on the Integrations page to turn it back on.`,
    }
  }
  if (reason === 'scope') {
    return {
      title: 'Reconnect Google',
      body: `Your Google account${who} is missing a permission Suite CXO needs. Click Reconnect Google on the Integrations page and approve every box.`,
    }
  }
  return {
    title: 'Reconnect Google',
    body: `Google stopped letting Suite CXO reach your account${who}. This happens after a Google password change or when access is removed. Click Reconnect Google on the Integrations page to turn your calendar and email back on.`,
  }
}

function columnMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  return e.code === '42703' || e.code === 'PGRST204' || /needs_reconnect|reconnect_reason|broken_at/.test(String(e.message ?? ''))
}

async function noticeRecipient(row: HealthRow): Promise<string | null> {
  if (row.member_id) return row.member_id
  // The tenant-level row is the owner's own connection (see the OAuth callback).
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', row.rep_id)
    .eq('role', 'owner')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

/**
 * Flag a row as needing reconnect. Only the false → true flip writes the one
 * notice. Returns true when this call flipped it.
 */
export async function markGoogleTokenBroken(row: HealthRow, reason: ReconnectReason, now = new Date()): Promise<boolean> {
  try {
    if (!row.id) return false
    const brokenAt = now.toISOString()
    const { data, error } = await supabase
      .from('google_tokens')
      .update({ needs_reconnect: true, reconnect_reason: reason, broken_at: brokenAt })
      .eq('id', row.id)
      .eq('needs_reconnect', false)
      .select('id')
    if (error) {
      if (!columnMissing(error)) console.error('[google health] flag failed', error.message ?? error)
      return false
    }
    if (!data || (data as unknown[]).length === 0) return false // already flagged: no second notice

    const memberId = await noticeRecipient(row)
    if (!memberId) return true
    const text = reconnectNoticeText(row.email ?? null, reason, { calendarOnly: Boolean(row.calendar_only) })
    const { error: nErr } = await supabase.from('cxo_followup_notices').insert({
      rep_id: row.rep_id,
      member_id: memberId,
      key: reconnectNoticeKey(row.id, brokenAt),
      kind: 'report',
      item_kind: null,
      item_id: row.id,
      title: text.title,
      body: text.body,
      href: '/dashboard/integrations#google',
    })
    if (nErr && (nErr as { code?: string }).code !== '23505') console.error('[google health] notice failed', nErr.message ?? nErr)
    return true
  } catch (err) {
    console.error('[google health] flag threw', err instanceof Error ? err.message : err)
    return false
  }
}

/** Clear the flag (a fresh consent) and mark that row's reconnect notices read. */
export async function clearGoogleTokenBroken(row: { id?: string | null; rep_id: string }, now = new Date()): Promise<void> {
  try {
    if (!row.id) return
    const { error } = await supabase
      .from('google_tokens')
      .update({ needs_reconnect: false, reconnect_reason: null, broken_at: null })
      .eq('id', row.id)
    if (error && !columnMissing(error)) console.error('[google health] clear failed', error.message ?? error)
    await supabase
      .from('cxo_followup_notices')
      .update({ read_at: now.toISOString() })
      .eq('rep_id', row.rep_id)
      .eq('item_id', row.id)
      .like('key', `${GOOGLE_RECONNECT_PREFIX}%`)
      .is('read_at', null)
  } catch (err) {
    console.error('[google health] clear threw', err instanceof Error ? err.message : err)
  }
}

/**
 * The broken connection this person should reconnect, or null. A member's own
 * rows; the owner also owns the tenant-level row.
 */
export async function brokenGoogleFor(
  repId: string,
  member: { id: string; role?: string | null },
): Promise<{ accountId: string; email: string | null; calendarOnly: boolean } | null> {
  try {
    const read = (cols: string) => {
      let q = supabase.from('google_tokens').select(cols).eq('rep_id', repId).eq('needs_reconnect', true)
      q = member.role === 'owner' ? q.or(`member_id.eq.${member.id},member_id.is.null`) : q.eq('member_id', member.id)
      return q.limit(1)
    }
    let { data, error } = await read('id, email, member_id, calendar_only')
    // Before supabase/cxo_google_token_issuer.sql runs calendar_only is missing.
    if (error) ({ data, error } = await read('id, email, member_id'))
    if (error) return null
    const r = ((data ?? []) as unknown as Array<{ id: string; email: string | null; calendar_only?: boolean | null }>)[0]
    return r ? { accountId: r.id, email: r.email, calendarOnly: Boolean(r.calendar_only) } : null
  } catch {
    return null
  }
}
