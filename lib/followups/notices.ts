/**
 * In-app notices from Mira (cxo_followup_notices), the read side. The engine
 * and the approvals queue write them; the Today Messages card (execs) and
 * /dashboard/me (employees) show them until "Got it". Always scoped by
 * rep_id AND member_id: nobody reads anyone else's notices.
 */
import { supabase } from '@/lib/supabase'
import { SLIP_KEY_PREFIX } from '@/lib/pinnacle/slipping'
import { ALWAYS_SHOWN_PREFIXES } from '@/lib/followups/noticeActionsShared'
import { DECISION_KEY_PREFIX } from '@/lib/decisions/shared'

/**
 * A kinds filter for the query. Ciao's "a number slipped" alert (lib/pinnacle/
 * slippingTick) and "a decision was reversed" (lib/decisions/log), both only
 * for owners and admins, show whether or not the employee-ops switch is on.
 * So do Ciao's own daily jobs (ALWAYS_SHOWN_PREFIXES, e.g. the end-of-day wrap).
 */
export const ALWAYS_SHOWN_KEY_PREFIXES = [SLIP_KEY_PREFIX, DECISION_KEY_PREFIX, ...ALWAYS_SHOWN_PREFIXES]

/** A kinds filter for the query, plus the always-shown keys. */
export function noticeKindsOr(kinds: NoticeView['kind'][]): string {
  return [`kind.in.(${kinds.join(',')})`, ...ALWAYS_SHOWN_KEY_PREFIXES.map((p) => `key.like.${p}*`)].join(',')
}

export type NoticeView = {
  id: string
  /** Says which one-tap actions it carries (lib/followups/noticeActionsShared). */
  key?: string | null
  kind: 'nudge' | 'escalate' | 'close' | 'report' | 'approval' | 'approval_result' | 'praise'
  item_kind: string | null
  item_id: string | null
  title: string
  body: string | null
  href: string
  due_date: string | null
  created_at: string
}

const COLS = 'id, key, kind, item_kind, item_id, title, body, href, due_date, created_at'

export function noticesMissing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** Unread notices for one member, newest first. Empty when the table is not there yet. */
export async function listNotices(repId: string, memberId: string, limit = 40, kinds?: NoticeView['kind'][]): Promise<NoticeView[]> {
  let q = supabase
    .from('cxo_followup_notices')
    .select(COLS)
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .is('read_at', null)
  if (kinds) q = q.or(noticeKindsOr(kinds))
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200))
  if (error) {
    if (noticesMissing(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Omit<NoticeView, 'href'> & { href: string | null }>).map((r) => ({ ...r, href: r.href || '/dashboard' }))
}

/**
 * Notices for the 7am brief email (lib/exec/execEmailRun): unread AND never
 * emailed, from the last `sinceDays`, newest first. Pass the same `kinds` the
 * Today Messages card uses (noticeKindsFor) so the email never shows what the
 * app would hide. A missing table returns empty; any other read error throws,
 * so the caller can send the brief without the section.
 */
export async function listUndeliveredNotices(
  repId: string,
  memberId: string,
  opts: { sinceDays?: number; limit?: number; kinds?: NoticeView['kind'][] } = {},
): Promise<NoticeView[]> {
  const sinceDays = opts.sinceDays ?? 7
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50)
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  let q = supabase
    .from('cxo_followup_notices')
    .select(COLS)
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .is('read_at', null)
    .is('emailed_at', null)
    .gte('created_at', since)
  if (opts.kinds) q = q.or(noticeKindsOr(opts.kinds))
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (noticesMissing(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Omit<NoticeView, 'href'> & { href: string | null }>).map((r) => ({ ...r, href: r.href || '/dashboard' }))
}

export async function unreadNoticeCount(repId: string, memberId: string, kinds?: NoticeView['kind'][]): Promise<number> {
  let q = supabase
    .from('cxo_followup_notices')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .is('read_at', null)
  if (kinds) q = q.or(noticeKindsOr(kinds))
  const { count, error } = await q
  if (error) return 0
  return count ?? 0
}

/**
 * Which notices a member sees. Mira's follow-up notices need the employee-ops
 * switch; "you were praised" (owner 10-11) shows either way.
 */
export const noticeKindsFor = (opsOn: boolean): NoticeView['kind'][] | undefined => (opsOn ? undefined : ['praise'])

/** "Got it": only the member's own row. */
export async function markNoticeRead(repId: string, memberId: string, id: string): Promise<void> {
  if (!id) return
  const { error } = await supabase
    .from('cxo_followup_notices')
    .update({ read_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('id', id)
    .is('read_at', null)
  if (error && !noticesMissing(error)) throw error
}
