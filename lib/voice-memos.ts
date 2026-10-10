/**
 * Voice memos: pitch → manager → feedback nucleus.
 *
 * Pitches, coaching questions and manager feedback are stored as memo rows
 * (audio, when present, lives in the private Supabase Storage bucket
 * `voice-memos`). Managers review them on the dashboard Feedback page, and
 * feedback threads back to the original memo via parent_memo_id.
 */

import { supabase } from '@/lib/supabase'

const BUCKET = 'voice-memos'

export type VoiceMemoStatus = 'pending' | 'in_review' | 'ready' | 'needs_work' | 'archived'
export type VoiceMemoKind = 'pitch' | 'feedback' | 'note' | 'coaching'

export type VoiceMemo = {
  id: string
  rep_id: string
  sender_member_id: string
  recipient_member_id: string | null
  team_id: string | null
  lead_id: string | null
  parent_memo_id: string | null
  kind: VoiceMemoKind
  status: VoiceMemoStatus
  storage_path: string | null
  duration_seconds: number | null
  transcript: string | null
  reviewed_by_member_id: string | null
  reviewed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Get a short-lived signed URL for in-dashboard playback. */
export async function getMemoSignedUrl(storagePath: string, expiresIn = 60 * 60): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn)
  if (error) return null
  return data?.signedUrl ?? null
}

/** Insert a fresh memo row. */
export async function createMemo(input: {
  repId: string
  senderMemberId: string
  recipientMemberId?: string | null
  teamId?: string | null
  leadId?: string | null
  parentMemoId?: string | null
  kind: VoiceMemoKind
  durationSeconds?: number | null
  transcript?: string | null
}): Promise<VoiceMemo> {
  // SECURITY/INTEGRITY: voice_memos.sender_member_id is NOT NULL in schema.
  // Reject empty/missing senders here with a readable error rather than
  // letting the DB throw a generic constraint violation that's harder to
  // trace back to the caller.
  if (!input.repId) throw new Error('createMemo: repId is required')
  if (!input.senderMemberId) {
    throw new Error('createMemo: senderMemberId is required (voice_memos.sender_member_id is NOT NULL)')
  }
  const { data, error } = await supabase
    .from('voice_memos')
    .insert({
      rep_id: input.repId,
      sender_member_id: input.senderMemberId,
      recipient_member_id: input.recipientMemberId ?? null,
      team_id: input.teamId ?? null,
      lead_id: input.leadId ?? null,
      parent_memo_id: input.parentMemoId ?? null,
      kind: input.kind,
      duration_seconds: input.durationSeconds ?? null,
      transcript: input.transcript ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as VoiceMemo
}

export async function setMemoStatus(
  memoId: string,
  status: VoiceMemoStatus,
  reviewerMemberId: string | null,
  notes?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (reviewerMemberId) {
    patch.reviewed_by_member_id = reviewerMemberId
    patch.reviewed_at = new Date().toISOString()
  }
  if (notes !== undefined) patch.notes = notes
  const { error } = await supabase.from('voice_memos').update(patch).eq('id', memoId)
  if (error) throw error
}

export async function getMemo(memoId: string): Promise<VoiceMemo | null> {
  const { data } = await supabase.from('voice_memos').select('*').eq('id', memoId).maybeSingle()
  return (data as VoiceMemo | null) ?? null
}

/** List memos awaiting review for a manager. */
export async function listPendingForManager(
  repId: string,
  managerMemberId: string,
  managedTeamIds: string[] | null,
): Promise<VoiceMemo[]> {
  let q = supabase
    .from('voice_memos')
    .select('*')
    .eq('rep_id', repId)
    .in('kind', ['pitch', 'coaching'])
    .in('status', ['pending', 'in_review'])
    .order('created_at', { ascending: false })
  // Admin (managedTeamIds === null) sees all pending; managers see their teams + memos addressed to them.
  if (managedTeamIds !== null) {
    if (managedTeamIds.length > 0) {
      q = q.or(
        `recipient_member_id.eq.${managerMemberId},team_id.in.(${managedTeamIds.join(',')})`,
      )
    } else {
      q = q.eq('recipient_member_id', managerMemberId)
    }
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VoiceMemo[]
}

/** All memos a rep has sent + every feedback memo sent to them. */
export async function listForRep(
  repId: string,
  memberId: string,
  search?: string | null,
): Promise<VoiceMemo[]> {
  let q = supabase
    .from('voice_memos')
    .select('*')
    .eq('rep_id', repId)
    .or(`sender_member_id.eq.${memberId},recipient_member_id.eq.${memberId}`)
    .order('created_at', { ascending: false })
    .limit(200)
  if (search && search.trim()) {
    q = q.ilike('transcript', `%${search.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VoiceMemo[]
}

/** All memos visible to a manager (queue + archive across managed teams). */
export async function listForManager(
  repId: string,
  managerMemberId: string,
  managedTeamIds: string[] | null,
  search?: string | null,
): Promise<VoiceMemo[]> {
  let q = supabase
    .from('voice_memos')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (managedTeamIds !== null) {
    if (managedTeamIds.length > 0) {
      q = q.or(
        `recipient_member_id.eq.${managerMemberId},team_id.in.(${managedTeamIds.join(',')}),sender_member_id.eq.${managerMemberId}`,
      )
    } else {
      q = q.or(`recipient_member_id.eq.${managerMemberId},sender_member_id.eq.${managerMemberId}`)
    }
  }
  if (search && search.trim()) {
    q = q.ilike('transcript', `%${search.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VoiceMemo[]
}

/**
 * Fuzzy-resolve a manager/admin/owner the rep is allowed to pitch.
 * Resolution order: managers of the rep's teams → account admins/owners.
 * Match is case-insensitive substring on display_name (or email local-part).
 */
export async function resolvePitchRecipient(
  repId: string,
  senderMemberId: string,
  query: string,
): Promise<{ id: string; display_name: string } | null> {
  const candidates = await listPitchableManagers(repId, senderMemberId)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const q = norm(query)
  if (!q) return null
  // Exact display_name match first.
  const exact = candidates.find((c) => norm(c.display_name) === q)
  if (exact) return exact
  // Substring on display_name.
  const sub = candidates.find((c) => norm(c.display_name).includes(q))
  if (sub) return sub
  // First-name token match.
  const firstName = candidates.find((c) => norm(c.display_name).split(' ')[0] === q.split(' ')[0])
  return firstName ?? null
}

export async function listPitchableManagers(
  repId: string,
  senderMemberId: string,
): Promise<Array<{ id: string; display_name: string; role: string }>> {
  const ids = new Set<string>()
  // Managers of every team the sender is on.
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('member_id', senderMemberId)
  const teamIds = (tmRows ?? []).map((r) => (r as { team_id: string }).team_id)
  if (teamIds.length > 0) {
    const { data: teams } = await supabase
      .from('teams')
      .select('manager_member_id')
      .in('id', teamIds)
    for (const t of (teams ?? []) as Array<{ manager_member_id: string | null }>) {
      if (t.manager_member_id) ids.add(t.manager_member_id)
    }
  }
  // Account-level admins/owners as a backstop (every account has at least one).
  const { data: admins } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', repId)
    .in('role', ['owner', 'admin'])
    .eq('is_active', true)
  for (const a of (admins ?? []) as Array<{ id: string }>) ids.add(a.id)
  ids.delete(senderMemberId)
  if (ids.size === 0) return []
  const { data: rows } = await supabase
    .from('members')
    .select('id, display_name, role')
    .in('id', Array.from(ids))
    .eq('is_active', true)
  return ((rows ?? []) as Array<{ id: string; display_name: string; role: string }>)
}
