import { supabase } from './supabase'

/**
 * Deferred items — the manager's "remind me later" inbox.
 *
 * Distinct from brain_items so a manager's personal goals/tasks never get
 * polluted with team-relayed asks. Every row tracks WHERE it came from
 * (walkie / voice memo / room / lead / roleplay / self) plus WHO it's from
 * and WHEN to resurface it.
 *
 * Used by:
 *   - the Telegram nucleus when someone says "remind me about X tomorrow"
 *     or when a manager parks an incoming walkie/memo/coaching ask
 *   - /dashboard/inbox to render an organized board grouped by source
 *   - the daily morning brief to bubble up due reminders
 */

export type DeferredSource =
  | 'walkie'
  | 'voice_memo'
  | 'room'
  | 'lead'
  | 'roleplay'
  | 'self'

export type DeferredStatus = 'open' | 'snoozed' | 'done' | 'dismissed'

export type DeferredItem = {
  id: string
  rep_id: string
  owner_member_id: string
  source: DeferredSource
  source_member_id: string | null
  source_memo_id: string | null
  source_room_message_id: string | null
  source_lead_id: string | null
  source_session_id: string | null
  title: string
  body: string | null
  remind_at: string | null
  status: DeferredStatus
  completed_at: string | null
  created_at: string
  updated_at: string
}

export async function createDeferredItem(input: {
  repId: string
  ownerMemberId: string
  source: DeferredSource
  sourceMemberId?: string | null
  sourceMemoId?: string | null
  sourceRoomMessageId?: string | null
  sourceLeadId?: string | null
  sourceSessionId?: string | null
  title: string
  body?: string | null
  remindAt?: string | null
}): Promise<DeferredItem> {
  const { data, error } = await supabase
    .from('deferred_items')
    .insert({
      rep_id: input.repId,
      owner_member_id: input.ownerMemberId,
      source: input.source,
      source_member_id: input.sourceMemberId ?? null,
      source_memo_id: input.sourceMemoId ?? null,
      source_room_message_id: input.sourceRoomMessageId ?? null,
      source_lead_id: input.sourceLeadId ?? null,
      source_session_id: input.sourceSessionId ?? null,
      title: input.title,
      body: input.body ?? null,
      remind_at: input.remindAt ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DeferredItem
}

export async function listInbox(
  repId: string,
  ownerMemberId: string,
  opts: { status?: DeferredStatus; limit?: number } = {},
): Promise<DeferredItem[]> {
  const status = opts.status ?? 'open'
  const limit = opts.limit ?? 100
  const { data, error } = await supabase
    .from('deferred_items')
    .select('*')
    .eq('rep_id', repId)
    .eq('owner_member_id', ownerMemberId)
    .eq('status', status)
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as DeferredItem[]
}

export async function listDueRemindersForMember(
  repId: string,
  ownerMemberId: string,
  byIso: string,
): Promise<DeferredItem[]> {
  const { data, error } = await supabase
    .from('deferred_items')
    .select('*')
    .eq('rep_id', repId)
    .eq('owner_member_id', ownerMemberId)
    .in('status', ['open', 'snoozed'])
    .not('remind_at', 'is', null)
    .lte('remind_at', byIso)
    .order('remind_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DeferredItem[]
}

// Done / dismissed deferred items are DELETED (not kept). See the matching
// note on setBrainItemStatus — once a reminder is handled, we drop the row.
export async function markDeferredDone(id: string): Promise<void> {
  const { error } = await supabase.from('deferred_items').delete().eq('id', id)
  if (error) throw error
}

export async function snoozeDeferred(id: string, untilIso: string): Promise<void> {
  const { error } = await supabase
    .from('deferred_items')
    .update({ status: 'snoozed', remind_at: untilIso })
    .eq('id', id)
  if (error) throw error
}

export async function dismissDeferred(id: string): Promise<void> {
  const { error } = await supabase.from('deferred_items').delete().eq('id', id)
  if (error) throw error
}
