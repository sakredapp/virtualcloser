// Team CRUD for the org chart dashboard.
//
// Data model:
//   teams           — one row per team; manager_member_id points to the managing member
//   team_members    — junction: team_id + member_id (unique per member across all teams)
//
// Enforcement: we allow a member to appear in only ONE team at a time.
// addMemberToTeam() removes the member from any prior team before inserting.
// setTeamManager() is separate from team membership — the manager may or may
// not also appear in team_members.

import { supabase } from './supabase'
import type { Member } from '@/types'

export type Team = {
  id: string
  rep_id: string
  name: string
  manager_member_id: string | null
  created_at: string
  updated_at: string
}

export type TeamWithMembers = Team & {
  manager: Member | null
  members: Member[]
}

// ── Read ─────────────────────────────────────────────────────────────────

export async function listTeams(repId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Team[]
}

/**
 * Returns teams with their manager Member + all rep Members expanded.
 * Single round-trip via three parallel queries, then joined in JS.
 */
export async function listTeamsWithMembers(repId: string): Promise<TeamWithMembers[]> {
  const [teamsRes, allMembersRes, teamMembersRes] = await Promise.all([
    supabase.from('teams').select('*').eq('rep_id', repId).order('created_at', { ascending: true }),
    supabase.from('members').select('*').eq('rep_id', repId).eq('is_active', true),
    supabase.from('team_members').select('team_id, member_id').eq('rep_id', repId).not('member_id', 'is', null),
  ])

  if (teamsRes.error) throw teamsRes.error
  const teams = (teamsRes.data ?? []) as Team[]
  const allMembers = (allMembersRes.data ?? []) as Member[]
  const junctions = (teamMembersRes.data ?? []) as { team_id: string; member_id: string }[]

  const memberById = new Map(allMembers.map((m) => [m.id, m]))

  return teams.map((t) => {
    const memberIds = junctions.filter((j) => j.team_id === t.id).map((j) => j.member_id)
    return {
      ...t,
      manager: t.manager_member_id ? (memberById.get(t.manager_member_id) ?? null) : null,
      members: memberIds.map((id) => memberById.get(id)).filter(Boolean) as Member[],
    }
  })
}

/** Member IDs that are already committed to a team (as rep or manager). */
export async function getAssignedMemberIds(repId: string): Promise<Set<string>> {
  const [teams, junctions] = await Promise.all([
    supabase.from('teams').select('manager_member_id').eq('rep_id', repId),
    supabase.from('team_members').select('member_id').eq('rep_id', repId).not('member_id', 'is', null),
  ])

  const ids = new Set<string>()
  for (const t of (teams.data ?? []) as { manager_member_id: string | null }[]) {
    if (t.manager_member_id) ids.add(t.manager_member_id)
  }
  for (const j of (junctions.data ?? []) as { member_id: string | null }[]) {
    if (j.member_id) ids.add(j.member_id)
  }
  return ids
}

// ── Write ─────────────────────────────────────────────────────────────────

export async function createTeam(repId: string, name: string): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .insert({ rep_id: repId, name: name.trim() })
    .select()
    .single()
  if (error) throw error
  return data as Team
}

export async function renameTeam(teamId: string, name: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ name: name.trim() }).eq('id', teamId)
  if (error) throw error
}

export async function deleteTeam(teamId: string): Promise<void> {
  // team_members rows cascade-delete automatically (ON DELETE CASCADE)
  const { error } = await supabase.from('teams').delete().eq('id', teamId)
  if (error) throw error
}

export async function setTeamManager(teamId: string, memberId: string | null): Promise<void> {
  const { error } = await supabase
    .from('teams')
    .update({ manager_member_id: memberId })
    .eq('id', teamId)
  if (error) throw error
}

/**
 * Assign a member to a team as a rep.
 * Removes them from any other team first so one-team invariant holds.
 */
export async function addMemberToTeam(repId: string, teamId: string, memberId: string, displayName: string): Promise<void> {
  // Remove from any existing team within this tenant
  const { data: tenantTeams } = await supabase.from('teams').select('id').eq('rep_id', repId)
  if (tenantTeams && tenantTeams.length > 0) {
    const teamIds = (tenantTeams as { id: string }[]).map((t) => t.id)
    await supabase.from('team_members').delete().in('team_id', teamIds).eq('member_id', memberId)
  }

  const { error } = await supabase.from('team_members').insert({
    team_id: teamId,
    rep_id: repId,
    member_id: memberId,
    role: 'rep',
    name: displayName,
    email: null,
  })
  if (error) throw error
}

export async function removeMemberFromTeam(teamId: string, memberId: string): Promise<void> {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('member_id', memberId)
  if (error) throw error
}
