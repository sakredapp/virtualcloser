/**
 * In-app notices from Mira (cxo_followup_notices), the read side. The engine
 * and the approvals queue write them; the Today Messages card (execs) and
 * /dashboard/me (employees) show them until "Got it". Always scoped by
 * rep_id AND member_id: nobody reads anyone else's notices.
 */
import { supabase } from '@/lib/supabase'

export type NoticeView = {
  id: string
  kind: 'nudge' | 'escalate' | 'close' | 'report' | 'approval' | 'approval_result'
  item_kind: string | null
  item_id: string | null
  title: string
  body: string | null
  href: string
  due_date: string | null
  created_at: string
}

const COLS = 'id, kind, item_kind, item_id, title, body, href, due_date, created_at'

export function noticesMissing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** Unread notices for one member, newest first. Empty when the table is not there yet. */
export async function listNotices(repId: string, memberId: string, limit = 40): Promise<NoticeView[]> {
  const { data, error } = await supabase
    .from('cxo_followup_notices')
    .select(COLS)
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200))
  if (error) {
    if (noticesMissing(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Omit<NoticeView, 'href'> & { href: string | null }>).map((r) => ({ ...r, href: r.href || '/dashboard' }))
}

export async function unreadNoticeCount(repId: string, memberId: string): Promise<number> {
  const { count, error } = await supabase
    .from('cxo_followup_notices')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

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
