/**
 * Rooms — assistant-mediated channels.
 *
 * A "room" is a logical audience (managers / owners / a specific team).
 * Posts and shared todos live on the room page in the dashboard, visible to
 * every member of the audience.
 *
 * audience values:
 *   - 'managers'   → manager + admin + owner roles
 *   - 'owners'     → admin + owner roles
 *   - 'team:<id>'  → members of a specific team + that team's manager(s)
 */

import { supabase } from '@/lib/supabase'
import { listMembers } from '@/lib/members'
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
  assistant: 0,
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

/** Persist a new room message. */
export async function createRoomMessage(input: {
  repId: string
  audience: RoomAudience
  senderMemberId: string
  body?: string | null
  parentMessageId?: string | null
  kind?: 'text' | 'voice' | 'system'
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
      transcript: input.transcript ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as RoomMessage
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
