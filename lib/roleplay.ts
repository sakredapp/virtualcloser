import { supabase } from './supabase'

/**
 * Roleplay suite — coming-soon data layer.
 *
 * The feature surfaces three tables to app code:
 *   - roleplay_scenarios  (manager-built: product brief + persona + objections)
 *   - roleplay_sessions   (one rep practicing one scenario, start to finish)
 *   - roleplay_turns      (turn-by-turn transcript + audio for replay)
 *   - roleplay_reviews    (manager rating + verdict on a finished session)
 *
 * Voice provider is intentionally abstracted (`voice_provider` + `voice_id`
 * on the scenario row) so we can pick ElevenLabs / Cartesia / OpenAI realtime
 * without a schema migration.
 *
 * Active routes are gated behind ROLEPLAY_ENABLED. See /dashboard/roleplay.
 */

export const ROLEPLAY_ENABLED =
  (process.env.ROLEPLAY_ENABLED ?? '').toLowerCase() === 'true'

export type RoleplayDifficulty = 'easy' | 'standard' | 'hard' | 'brutal'
export type RoleplaySessionStatus = 'active' | 'completed' | 'abandoned'
export type RoleplaySpeaker = 'ai' | 'rep'
export type RoleplayVerdict = 'ready' | 'needs_work' | 'escalate'

export type RoleplayObjection = {
  text: string
  source_voice_memo_id?: string | null
  weight?: number | null
}

export type RoleplayScenario = {
  id: string
  rep_id: string
  created_by_member_id: string | null
  name: string
  product_brief: string | null
  persona: string | null
  difficulty: RoleplayDifficulty
  objection_bank: RoleplayObjection[]
  source_voice_memo_ids: string[] | null
  voice_provider: string | null
  voice_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type RoleplaySession = {
  id: string
  rep_id: string
  scenario_id: string
  member_id: string
  status: RoleplaySessionStatus
  started_at: string
  completed_at: string | null
  duration_seconds: number | null
  ai_score: number | null
  ai_summary: string | null
  ai_strengths: string | null
  ai_weaknesses: string | null
  transcript_full: string | null
}

export type RoleplayTurn = {
  id: string
  session_id: string
  turn_index: number
  speaker: RoleplaySpeaker
  transcript: string | null
  audio_storage_path: string | null
  duration_ms: number | null
  created_at: string
}

export type RoleplayReview = {
  id: string
  session_id: string
  reviewer_member_id: string
  rating: number | null
  verdict: RoleplayVerdict | null
  notes: string | null
  created_at: string
  updated_at: string
}

export async function listScenarios(repId: string): Promise<RoleplayScenario[]> {
  const { data, error } = await supabase
    .from('roleplay_scenarios')
    .select('*')
    .eq('rep_id', repId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as RoleplayScenario[]
}

export async function listSessionsForRep(
  repId: string,
  memberId: string,
  limit = 50,
): Promise<RoleplaySession[]> {
  const { data, error } = await supabase
    .from('roleplay_sessions')
    .select('*')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RoleplaySession[]
}

export async function listAllSessionsForLeadership(
  repId: string,
  limit = 100,
): Promise<RoleplaySession[]> {
  const { data, error } = await supabase
    .from('roleplay_sessions')
    .select('*')
    .eq('rep_id', repId)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RoleplaySession[]
}

// ── Add-on entitlement (paid roleplay seats) ──────────────────────────────
//
// Roleplay is a per-seat add-on on Salesperson AND on Enterprise. NOT
// included in any base tier. We treat the account-level row + the
// per-member row as a 2-key lock: the account must have it on, AND the
// specific member must have a seat.
//
// Solo salesperson = single owner member, so once the rep_addons row is
// active their owner member is auto-granted (handled at billing time, not
// here). Enterprise managers explicitly grant seats via member_addons.

export type AddonKey = 'roleplay'

export async function isRoleplayActiveForMember(
  repId: string,
  memberId: string,
): Promise<boolean> {
  const { data: account } = await supabase
    .from('rep_addons')
    .select('is_active, seats')
    .eq('rep_id', repId)
    .eq('addon_key', 'roleplay')
    .maybeSingle()
  if (!account?.is_active) return false
  const { data: member } = await supabase
    .from('member_addons')
    .select('is_active')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('addon_key', 'roleplay')
    .maybeSingle()
  return Boolean(member?.is_active)
}

// ── Training docs (scope-isolated) ────────────────────────────────────────
//
// HARD RULE: a personal salesperson's docs never feed an enterprise's bot,
// and an enterprise's docs never leak to another account. We always filter
// by rep_id AND scope, and on personal also by owner_member_id.

export type TrainingDocScope = 'personal' | 'account'
export type TrainingDocKind =
  | 'product_brief'
  | 'script'
  | 'objection_list'
  | 'case_study'
  | 'training'
  | 'reference'

export type TrainingDoc = {
  id: string
  rep_id: string
  scope: TrainingDocScope
  owner_member_id: string | null
  uploaded_by_member_id: string | null
  doc_kind: TrainingDocKind
  title: string
  body: string | null
  storage_path: string | null
  source_voice_memo_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * List training docs that are valid for a given member's roleplay session.
 * Returns the union of:
 *   - account-scope docs for this rep_id (enterprise-wide)
 *   - personal-scope docs owned by this member
 * Never returns another account's docs. Never returns another member's
 * personal docs.
 */
export async function listTrainingDocsForMember(
  repId: string,
  memberId: string,
): Promise<TrainingDoc[]> {
  const { data, error } = await supabase
    .from('roleplay_training_docs')
    .select('*')
    .eq('rep_id', repId)
    .eq('is_active', true)
    .or(`scope.eq.account,and(scope.eq.personal,owner_member_id.eq.${memberId})`)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TrainingDoc[]
}

export async function listAccountTrainingDocs(repId: string): Promise<TrainingDoc[]> {
  const { data, error } = await supabase
    .from('roleplay_training_docs')
    .select('*')
    .eq('rep_id', repId)
    .eq('scope', 'account')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TrainingDoc[]
}

export async function listPersonalTrainingDocs(
  repId: string,
  memberId: string,
): Promise<TrainingDoc[]> {
  const { data, error } = await supabase
    .from('roleplay_training_docs')
    .select('*')
    .eq('rep_id', repId)
    .eq('scope', 'personal')
    .eq('owner_member_id', memberId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TrainingDoc[]
}

// ── Assignments (manager → rep) ───────────────────────────────────────────

export type AssignmentStatus = 'open' | 'completed' | 'expired' | 'canceled'

export type RoleplayAssignment = {
  id: string
  rep_id: string
  scenario_id: string
  assigned_by_member_id: string | null
  assignee_member_id: string | null
  team_id: string | null
  required_count: number
  due_at: string | null
  status: AssignmentStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export async function listOpenAssignmentsForMember(
  repId: string,
  memberId: string,
): Promise<RoleplayAssignment[]> {
  const { data, error } = await supabase
    .from('roleplay_assignments')
    .select('*')
    .eq('rep_id', repId)
    .eq('assignee_member_id', memberId)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as RoleplayAssignment[]
}

export async function listAllAssignmentsForLeadership(
  repId: string,
  limit = 100,
): Promise<RoleplayAssignment[]> {
  const { data, error } = await supabase
    .from('roleplay_assignments')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RoleplayAssignment[]
}

// ── Leaderboard (denormalized rollup) ─────────────────────────────────────

export type LeaderboardRow = {
  member_id: string
  sessions_count: number
  minutes_practiced: number
  avg_score: number | null
  best_score: number | null
}

export async function getLeaderboard(
  repId: string,
  sinceDays = 7,
): Promise<LeaderboardRow[]> {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('roleplay_daily_activity')
    .select('member_id, sessions_count, minutes_practiced, avg_score, best_score')
    .eq('rep_id', repId)
    .gte('day', since)
  if (error) throw error
  // Aggregate rows per member.
  const byMember = new Map<string, LeaderboardRow>()
  for (const row of data ?? []) {
    const r = row as {
      member_id: string
      sessions_count: number
      minutes_practiced: number
      avg_score: number | null
      best_score: number | null
    }
    const existing = byMember.get(r.member_id)
    if (!existing) {
      byMember.set(r.member_id, { ...r })
    } else {
      existing.sessions_count += r.sessions_count
      existing.minutes_practiced += r.minutes_practiced
      // Weighted avg by session count.
      const totalSessions = existing.sessions_count
      if (totalSessions > 0 && r.avg_score != null && existing.avg_score != null) {
        existing.avg_score =
          (existing.avg_score * (existing.sessions_count - r.sessions_count) +
            r.avg_score * r.sessions_count) /
          totalSessions
      } else if (r.avg_score != null && existing.avg_score == null) {
        existing.avg_score = r.avg_score
      }
      if (r.best_score != null && (existing.best_score == null || r.best_score > existing.best_score)) {
        existing.best_score = r.best_score
      }
    }
  }
  return Array.from(byMember.values()).sort(
    (a, b) => b.sessions_count - a.sessions_count,
  )
}
