/**
 * Member-attributed KPI rollups for the team / account leaderboard.
 *
 * Every data table (`leads`, `call_logs`, `brain_items`, `agent_actions`, …)
 * carries an `owner_member_id` column populated when a row is written. Rows
 * that pre-date the enterprise migration have NULL owner_member_id; we treat
 * those as belonging to the owner member of the rep.
 */

import { supabase } from '@/lib/supabase'
import type { CallOutcome } from '@/types'
import { getOwnerMember } from '@/lib/members'

export type MemberKpiRow = {
  memberId: string | null
  callsTotal: number
  conversations: number
  meetingsBooked: number
  closedWon: number
  closedLost: number
  leadsAdded: number
  brainItemsDone: number
}

type GroupAccumulator = MemberKpiRow

function emptyRow(memberId: string | null): GroupAccumulator {
  return {
    memberId,
    callsTotal: 0,
    conversations: 0,
    meetingsBooked: 0,
    closedWon: 0,
    closedLost: 0,
    leadsAdded: 0,
    brainItemsDone: 0,
  }
}

/**
 * Fetch per-member KPI counts since `sinceIso`. Rows with NULL owner_member_id
 * are folded into the rep's owner member so legacy data still attributes.
 *
 * If `memberIds` is provided, the result is filtered to those ids (after the
 * owner-fold). Useful for managers who can only see members on their teams.
 */
export async function getMemberKpis(
  repId: string,
  sinceIso: string,
  memberIds?: string[] | null,
): Promise<MemberKpiRow[]> {
  const owner = await getOwnerMember(repId)
  const ownerId = owner?.id ?? null
  const groups = new Map<string | null, GroupAccumulator>()

  function bumpOwner(key: string | null): GroupAccumulator {
    const folded = key ?? ownerId
    let row = groups.get(folded)
    if (!row) {
      row = emptyRow(folded)
      groups.set(folded, row)
    }
    return row
  }

  // Calls
  const { data: calls, error: callsErr } = await supabase
    .from('call_logs')
    .select('outcome, owner_member_id')
    .eq('rep_id', repId)
    .gte('occurred_at', sinceIso)
  if (callsErr) throw callsErr
  for (const row of (calls ?? []) as Array<{ outcome: CallOutcome | null; owner_member_id: string | null }>) {
    const acc = bumpOwner(row.owner_member_id)
    acc.callsTotal++
    if (row.outcome && row.outcome !== 'no_answer' && row.outcome !== 'voicemail') acc.conversations++
    if (row.outcome === 'booked') acc.meetingsBooked++
    if (row.outcome === 'closed_won') acc.closedWon++
    if (row.outcome === 'closed_lost') acc.closedLost++
  }

  // Leads added
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('owner_member_id')
    .eq('rep_id', repId)
    .gte('created_at', sinceIso)
  if (leadsErr) throw leadsErr
  for (const row of (leads ?? []) as Array<{ owner_member_id: string | null }>) {
    bumpOwner(row.owner_member_id).leadsAdded++
  }

  // Brain items completed
  const { data: items, error: itemsErr } = await supabase
    .from('brain_items')
    .select('owner_member_id')
    .eq('rep_id', repId)
    .eq('status', 'done')
    .gte('updated_at', sinceIso)
  if (itemsErr) throw itemsErr
  for (const row of (items ?? []) as Array<{ owner_member_id: string | null }>) {
    bumpOwner(row.owner_member_id).brainItemsDone++
  }

  let result = Array.from(groups.values())
  if (memberIds && memberIds.length > 0) {
    const allow = new Set(memberIds)
    result = result.filter((r) => r.memberId && allow.has(r.memberId))
  }
  // Sort: closedWon desc, then meetingsBooked desc, then conversations desc.
  result.sort(
    (a, b) =>
      b.closedWon - a.closedWon ||
      b.meetingsBooked - a.meetingsBooked ||
      b.conversations - a.conversations,
  )
  return result
}

/** Convenience: KPI window helpers. */
export function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

// ── Team / account goal rollups ───────────────────────────────────────────

export type TeamGoalProgress = {
  targetId: string
  scope: 'team' | 'account'
  visibility: 'all' | 'managers' | 'owners'
  teamId: string | null
  teamName: string | null
  metric: string
  periodType: string
  periodStart: string
  targetValue: number
  /** Rolled-up actual across every member in scope, computed from raw data. */
  total: number
  /** This viewer's individual contribution to that total. */
  yours: number
}

/**
 * For a given member, find every active team/account-scope target that
 * applies to them and compute (a) the team total and (b) their slice.
 * - account-scope targets apply to everyone in the rep account.
 * - team-scope targets apply if the member belongs to the target's team.
 */
export async function getTeamGoalsForMember(
  repId: string,
  memberId: string,
): Promise<TeamGoalProgress[]> {
  // Member's team ids + role (for visibility gating).
  const [{ data: tmRows }, { data: meRow }] = await Promise.all([
    supabase.from('team_members').select('team_id').eq('member_id', memberId),
    supabase.from('members').select('role').eq('id', memberId).maybeSingle(),
  ])
  const memberTeamIds = (tmRows ?? []).map((r) => (r as { team_id: string }).team_id)
  const viewerRole = ((meRow as { role: string } | null)?.role ?? 'rep') as
    | 'observer' | 'rep' | 'manager' | 'admin' | 'owner'
  const VIS_RANK: Record<'all' | 'managers' | 'owners', number> = { all: 0, managers: 1, owners: 2 }
  const ROLE_RANK: Record<typeof viewerRole, number> = {
    observer: 0, rep: 0, manager: 1, admin: 2, owner: 2,
  }

  // Active targets in scope.
  const { data: targets } = await supabase
    .from('targets')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'active')
    .in('scope', ['team', 'account'])
    .order('period_start', { ascending: false })

  const out: TeamGoalProgress[] = []
  for (const t of (targets ?? []) as Array<{
    id: string
    scope: 'team' | 'account'
    visibility?: 'all' | 'managers' | 'owners' | null
    team_id: string | null
    metric: string
    target_value: number
    period_type: string
    period_start: string
  }>) {
    if (t.scope === 'team' && (!t.team_id || !memberTeamIds.includes(t.team_id))) continue
    // Visibility gate: managers-only / owners-only goals stay hidden from
    // members below that rank.
    const vis = (t.visibility ?? 'all') as 'all' | 'managers' | 'owners'
    if (ROLE_RANK[viewerRole] < VIS_RANK[vis]) continue
    const sinceIso = `${t.period_start}T00:00:00Z`

    // Resolve the set of member ids that count toward this target's total.
    let scopeMemberIds: string[] | null = null
    let teamName: string | null = null
    if (t.scope === 'team' && t.team_id) {
      const [{ data: roster }, { data: teamRow }] = await Promise.all([
        supabase.from('team_members').select('member_id').eq('team_id', t.team_id),
        supabase.from('teams').select('name').eq('id', t.team_id).maybeSingle(),
      ])
      scopeMemberIds = (roster ?? [])
        .map((r) => (r as { member_id: string | null }).member_id)
        .filter((id): id is string => Boolean(id))
      teamName = (teamRow as { name: string } | null)?.name ?? null
    }

    // Pull the raw rows once, then split into team-total and viewer-only.
    let total = 0
    let yours = 0
    if (t.metric === 'calls' || t.metric === 'conversations' || t.metric === 'meetings_booked' || t.metric === 'deals_closed') {
      const { data: calls } = await supabase
        .from('call_logs')
        .select('outcome, owner_member_id')
        .eq('rep_id', repId)
        .gte('occurred_at', sinceIso)
      for (const r of (calls ?? []) as Array<{ outcome: string | null; owner_member_id: string | null }>) {
        const inScope = scopeMemberIds === null || (r.owner_member_id !== null && scopeMemberIds.includes(r.owner_member_id))
        if (!inScope) continue
        const counts =
          t.metric === 'calls'
            ? true
            : t.metric === 'conversations'
              ? r.outcome !== null && r.outcome !== 'no_answer' && r.outcome !== 'voicemail'
              : t.metric === 'meetings_booked'
                ? r.outcome === 'booked'
                : r.outcome === 'closed_won'
        if (!counts) continue
        total++
        if (r.owner_member_id === memberId) yours++
      }
    }
    out.push({
      targetId: t.id,
      scope: t.scope,
      visibility: (t.visibility ?? 'all'),
      teamId: t.team_id,
      teamName,
      metric: t.metric,
      periodType: t.period_type,
      periodStart: t.period_start,
      targetValue: Number(t.target_value),
      total,
      yours,
    })
  }
  return out
}
