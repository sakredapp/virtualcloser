/**
 * One-tap actions on Ciao's notices, the server side. Called from
 * /api/messages (op notice.act) and /api/employees/me/notices (op act), both
 * scoped to the signed-in member. A notice is only acted on when it belongs
 * to that member and its key says it carries that action
 * (lib/followups/noticeActionsShared).
 */
import { supabase } from '@/lib/supabase'
import { markNoticeRead, noticesMissing } from '@/lib/followups/notices'
import { DAY_WRAP_PREFIX, actionsFor, dayWord, splitIds, type NoticeActionName } from '@/lib/followups/noticeActionsShared'

export class NoticeActionRefused extends Error {}

type NoticeRow = { id: string; key: string; item_id: string | null; due_date: string | null; read_at: string | null; body: string | null }

export async function actOnNotice(repId: string, memberId: string, id: string, action: unknown): Promise<{ note: string }> {
  if (!id) throw new NoticeActionRefused('Nothing to do.')
  const { data, error } = await supabase
    .from('cxo_followup_notices')
    .select('id, key, item_id, due_date, read_at, body')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('id', id)
    .maybeSingle()
  if (error && !noticesMissing(error)) throw error
  const n = data as NoticeRow | null
  if (!n) throw new NoticeActionRefused('That notice is gone.')
  const allowed = actionsFor(n).map((a) => a.action)
  const want = String(action ?? '') as NoticeActionName
  if (!allowed.includes(want)) throw new NoticeActionRefused('That is not something this notice can do.')

  switch (want) {
    case 'move_tomorrow': {
      const ids = splitIds(n.item_id)
      const to = n.due_date as string
      // Only their own to-dos that are still open; anything done or deleted since stays put.
      const { data: moved, error: uErr } = await supabase
        .from('cxo_todos')
        .update({ due_date: to })
        .eq('rep_id', repId)
        .eq('member_id', memberId)
        .in('id', ids)
        .is('done_at', null)
        .is('deleted_at', null)
        .select('id')
      if (uErr) throw uErr
      await markNoticeRead(repId, memberId, n.id)
      const count = (moved ?? []).length
      const day = n.key.startsWith(DAY_WRAP_PREFIX) ? dayWord(n.key.slice(DAY_WRAP_PREFIX.length, DAY_WRAP_PREFIX.length + 10), to) : 'tomorrow'
      return { note: count ? `Moved ${count} to-do${count === 1 ? '' : 's'} to ${day}.` : 'Those are already done or gone.' }
    }
    case 'confirm_status': {
      const { confirmMyStatus } = await import('@/lib/status/weekly')
      const row = await confirmMyStatus(repId, memberId, n.item_id as string)
      await markNoticeRead(repId, memberId, n.id)
      return { note: row ? 'Sent to the Monday rollup.' : 'That status is gone.' }
    }
    case 'approve_held':
    case 'decline_held': {
      const { decideHeld } = await import('@/lib/ops/approvals')
      const note = await decideHeld({ repId, memberId, id: n.item_id as string, approve: want === 'approve_held' })
      await markNoticeRead(repId, memberId, n.id)
      return { note }
    }
    case 'add_to_one_on_one': {
      const { addTalkingPointToOneOnOne } = await import('@/lib/people/fallsBehind')
      const note = await addTalkingPointToOneOnOne(repId, memberId, n.item_id as string, n.body)
      await markNoticeRead(repId, memberId, n.id)
      return { note }
    }
  }
  throw new NoticeActionRefused('Nothing to do.')
}
