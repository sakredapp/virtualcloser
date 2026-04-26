/**
 * Rooms — assistant-mediated channels.
 *
 * A "room" is a logical audience (managers / owners / a specific team).
 * Members never read each other's messages directly. When someone posts,
 * their assistant fans the post out 1:1 over Telegram to every other
 * audience member, and replies thread back through the same path. The
 * dashboard surfaces the audit log of the room (and shared todos), but the
 * live experience is always 1:1 with your assistant.
 *
 * audience values:
 *   - 'managers'   → manager + admin + owner roles
 *   - 'owners'     → admin + owner roles
 *   - 'team:<id>'  → members of a specific team + that team's manager(s)
 */

import { supabase } from '@/lib/supabase'
import { listMembers } from '@/lib/members'
import { sendTelegramMessage, sendTelegramVoice } from '@/lib/telegram'
import type { Member, MemberRole } from '@/types'

export type RoomAudience = string // 'managers' | 'owners' | `team:${string}`

export type RoomMessage = {
  id: string
  rep_id: string
  audience: RoomAudience
  sender_member_id: string | null
  parent_message_id: string | null
  body: string | null
  kind: 'text' | 'voice' | 'system'
  telegram_file_id: string | null
  transcript: string | null
  delivered_count: number
  created_at: string
}

export type RoomTodo = {
  id: string
  rep_id: string
  audience: RoomAudience
  created_by: string | null
  assigned_to: string | null
  body: string
  status: 'open' | 'done' | 'archived'
  due_at: string | null
  created_at: string
  updated_at: string
}

const ROLE_RANK: Record<MemberRole, number> = {
  observer: 0,
  rep: 0,
  manager: 1,
  admin: 2,
  owner: 2,
}

/**
 * Can this member see / post in this room? Reps and observers are blocked
 * from managers/owners rooms; managers are blocked from owners-only.
 */
export function canAccessRoom(role: MemberRole, audience: RoomAudience): boolean {
  if (audience === 'managers') return ROLE_RANK[role] >= 1
  if (audience === 'owners') return ROLE_RANK[role] >= 2
  if (audience.startsWith('team:')) return true // membership check happens via team_members
  return false
}

export function describeAudience(audience: RoomAudience): string {
  if (audience === 'managers') return 'Manager Room'
  if (audience === 'owners') return 'Owners Room'
  if (audience.startsWith('team:')) return 'Team Room'
  return audience
}

/**
 * Resolve audience → list of members who should receive a post.
 * Always excludes inactive members. Caller decides whether to also
 * exclude the sender.
 */
export async function listAudience(
  repId: string,
  audience: RoomAudience,
): Promise<Member[]> {
  const all = await listMembers(repId)
  const active = all.filter((m) => m.is_active !== false)
  if (audience === 'managers') {
    return active.filter((m) => ROLE_RANK[m.role] >= 1)
  }
  if (audience === 'owners') {
    return active.filter((m) => ROLE_RANK[m.role] >= 2)
  }
  if (audience.startsWith('team:')) {
    const teamId = audience.slice('team:'.length)
    const { data } = await supabase
      .from('team_members')
      .select('member_id')
      .eq('team_id', teamId)
    const ids = new Set(
      (data ?? [])
        .map((r) => (r as { member_id: string | null }).member_id)
        .filter((id): id is string => Boolean(id)),
    )
    return active.filter((m) => ids.has(m.id))
  }
  return []
}

/** Persist a new room message (no fan-out yet). */
export async function createRoomMessage(input: {
  repId: string
  audience: RoomAudience
  senderMemberId: string
  body?: string | null
  parentMessageId?: string | null
  kind?: 'text' | 'voice' | 'system'
  telegramFileId?: string | null
  transcript?: string | null
}): Promise<RoomMessage> {
  const { data, error } = await supabase
    .from('room_messages')
    .insert({
      rep_id: input.repId,
      audience: input.audience,
      sender_member_id: input.senderMemberId,
      parent_message_id: input.parentMessageId ?? null,
      body: input.body ?? null,
      kind: input.kind ?? 'text',
      telegram_file_id: input.telegramFileId ?? null,
      transcript: input.transcript ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as RoomMessage
}

/**
 * Fan-out: deliver a room message to every audience member except the
 * sender. Records one room_deliveries row per recipient with the bot's
 * outbound message_id so replies route back. Returns delivered count.
 */
export async function relayRoomMessage(
  message: RoomMessage,
  senderName: string,
): Promise<{ delivered: number; skipped: number }> {
  const audience = await listAudience(message.rep_id, message.audience)
  const recipients = audience.filter((m) => m.id !== message.sender_member_id && m.telegram_chat_id)
  let delivered = 0
  let skipped = audience.length - recipients.length
  const label = describeAudience(message.audience)
  const header = `📡 *${senderName}* → ${label}`
  for (const r of recipients) {
    if (!r.telegram_chat_id) {
      skipped++
      continue
    }
    try {
      const { id: deliveryId } = await ensureDeliveryRow(message.id, r.id)
      if (message.kind === 'voice' && message.telegram_file_id) {
        const caption = message.transcript
          ? `${header}\n_${truncate(message.transcript, 240)}_\n\n_Reply to this message and I'll thread it back to the room._`
          : `${header}\n\n_Reply to this message and I'll thread it back to the room._`
        const sent = await sendTelegramVoice(r.telegram_chat_id, message.telegram_file_id, caption)
        if (sent.ok && sent.message_id) {
          await markDelivered(deliveryId, r.telegram_chat_id, sent.message_id)
          delivered++
        }
      } else {
        const body = message.body ?? message.transcript ?? ''
        const sent = await sendTelegramMessage(
          r.telegram_chat_id,
          `${header}\n\n${body}\n\n_Reply to this message to thread back._`,
        )
        if (sent.ok && sent.message_id) {
          await markDelivered(deliveryId, r.telegram_chat_id, sent.message_id)
          delivered++
        }
      }
    } catch (err) {
      console.error('[rooms] relay failed for member', r.id, err)
      skipped++
    }
  }
  await supabase.from('room_messages').update({ delivered_count: delivered }).eq('id', message.id)
  return { delivered, skipped }
}

async function ensureDeliveryRow(messageId: string, recipientMemberId: string): Promise<{ id: string }> {
  const { data: existing } = await supabase
    .from('room_deliveries')
    .select('id')
    .eq('message_id', messageId)
    .eq('recipient_member_id', recipientMemberId)
    .maybeSingle()
  if (existing) return existing as { id: string }
  const { data, error } = await supabase
    .from('room_deliveries')
    .insert({ message_id: messageId, recipient_member_id: recipientMemberId })
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

async function markDelivered(deliveryId: string, chatId: string, messageId: number): Promise<void> {
  await supabase
    .from('room_deliveries')
    .update({ tg_chat_id: chatId, tg_message_id: messageId, delivered_at: new Date().toISOString() })
    .eq('id', deliveryId)
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/**
 * Look up a delivery row by the bot's outbound message id (used when a
 * recipient hits "Reply" in Telegram so we know which room thread to
 * append the reply to).
 */
export async function findDeliveryByRelay(
  chatId: string,
  messageId: number,
): Promise<{ message_id: string; recipient_member_id: string } | null> {
  const { data } = await supabase
    .from('room_deliveries')
    .select('message_id, recipient_member_id')
    .eq('tg_chat_id', chatId)
    .eq('tg_message_id', messageId)
    .maybeSingle()
  return (data as { message_id: string; recipient_member_id: string } | null) ?? null
}

export async function getRoomMessage(id: string): Promise<RoomMessage | null> {
  const { data } = await supabase.from('room_messages').select('*').eq('id', id).maybeSingle()
  return (data as RoomMessage | null) ?? null
}

/** List recent room messages for the dashboard view. */
export async function listRoomMessages(
  repId: string,
  audience: RoomAudience,
  limit = 100,
): Promise<RoomMessage[]> {
  const { data } = await supabase
    .from('room_messages')
    .select('*')
    .eq('rep_id', repId)
    .eq('audience', audience)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as RoomMessage[]
}

// ── Todos ─────────────────────────────────────────────────────────────────

export async function listRoomTodos(
  repId: string,
  audience: RoomAudience,
  includeDone = false,
): Promise<RoomTodo[]> {
  let q = supabase
    .from('room_todos')
    .select('*')
    .eq('rep_id', repId)
    .eq('audience', audience)
    .order('created_at', { ascending: false })
  if (!includeDone) q = q.eq('status', 'open')
  const { data } = await q
  return (data ?? []) as RoomTodo[]
}

export async function createRoomTodo(input: {
  repId: string
  audience: RoomAudience
  createdBy: string
  body: string
  assignedTo?: string | null
  dueAt?: string | null
}): Promise<RoomTodo> {
  const { data, error } = await supabase
    .from('room_todos')
    .insert({
      rep_id: input.repId,
      audience: input.audience,
      created_by: input.createdBy,
      assigned_to: input.assignedTo ?? null,
      body: input.body,
      due_at: input.dueAt ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as RoomTodo
}

export async function setRoomTodoStatus(
  id: string,
  repId: string,
  status: 'open' | 'done' | 'archived',
): Promise<void> {
  await supabase
    .from('room_todos')
    .update({ status })
    .eq('id', id)
    .eq('rep_id', repId)
}
