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

// ── Scenario CRUD (tenant-side) ───────────────────────────────────────────

export type ScenarioInput = {
  name: string
  product_brief?: string | null
  persona?: string | null
  difficulty?: RoleplayDifficulty
  objection_bank?: RoleplayObjection[]
}

export async function createScenario(
  repId: string,
  memberId: string,
  input: ScenarioInput,
): Promise<RoleplayScenario> {
  const { data, error } = await supabase
    .from('roleplay_scenarios')
    .insert({
      rep_id: repId,
      created_by_member_id: memberId,
      name: input.name,
      product_brief: input.product_brief ?? null,
      persona: input.persona ?? null,
      difficulty: input.difficulty ?? 'standard',
      objection_bank: input.objection_bank ?? [],
    })
    .select()
    .single()
  if (error) throw error
  return data as RoleplayScenario
}

export async function updateScenario(
  repId: string,
  scenarioId: string,
  patch: Partial<ScenarioInput> & { is_active?: boolean },
): Promise<RoleplayScenario> {
  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.product_brief !== undefined) updates.product_brief = patch.product_brief
  if (patch.persona !== undefined) updates.persona = patch.persona
  if (patch.difficulty !== undefined) updates.difficulty = patch.difficulty
  if (patch.objection_bank !== undefined) updates.objection_bank = patch.objection_bank
  if (patch.is_active !== undefined) updates.is_active = patch.is_active

  const { data, error } = await supabase
    .from('roleplay_scenarios')
    .update(updates)
    .eq('id', scenarioId)
    .eq('rep_id', repId)
    .select()
    .single()
  if (error) throw error
  return data as RoleplayScenario
}

export async function deleteScenario(repId: string, scenarioId: string): Promise<void> {
  // Soft-delete via is_active=false to preserve history of past sessions.
  const { error } = await supabase
    .from('roleplay_scenarios')
    .update({ is_active: false })
    .eq('id', scenarioId)
    .eq('rep_id', repId)
  if (error) throw error
}

// ── Preset scenarios (clickable starter library) ─────────────────────────
//
// Generic-objection scenarios any sales team can run. The user clicks one in
// the dashboard and we materialize it into roleplay_scenarios with their
// rep_id. They can then edit it like any other scenario.
export const PRESET_SCENARIOS: Array<
  Omit<ScenarioInput, 'objection_bank'> & {
    slug: string
    blurb: string
    objection_bank: RoleplayObjection[]
  }
> = [
  {
    slug: 'not-interested',
    name: 'The "Not interested" cold-shoulder',
    blurb: 'Prospect shuts you down in the first 10 seconds. Practice keeping the call alive.',
    persona: 'Busy decision-maker who picks up by accident, defaults to "no" on every cold call.',
    difficulty: 'standard',
    objection_bank: [
      { text: 'Not interested.', weight: 3 },
      { text: 'We already have something for that.', weight: 2 },
      { text: 'Take me off your list.', weight: 2 },
      { text: 'How did you get my number?', weight: 1 },
    ],
  },
  {
    slug: 'send-me-an-email',
    name: 'The "Send me an email" deflection',
    blurb: 'They\'ll say yes to email just to hang up. Hold the line and earn 60 seconds.',
    persona: 'Polite but evasive — happy to "look at something" but won\'t commit on the call.',
    difficulty: 'standard',
    objection_bank: [
      { text: 'Just send me an email and I\'ll look at it.', weight: 3 },
      { text: 'I\'m about to walk into a meeting.', weight: 2 },
      { text: 'Forward me the deck.', weight: 1 },
    ],
  },
  {
    slug: 'call-me-later',
    name: 'The "Call me later" runaround',
    blurb: 'Always too busy "right now". Pin them to a real callback time.',
    persona: 'Constantly on the move, agrees to everything verbally, ghosts on follow-up.',
    difficulty: 'standard',
    objection_bank: [
      { text: 'Call me back next week.', weight: 3 },
      { text: 'I\'m on the road, hit me tomorrow.', weight: 2 },
      { text: 'Try me Friday afternoon.', weight: 2 },
    ],
  },
  {
    slug: 'price-pushback',
    name: 'The price pushback',
    blurb: 'They love it. Then they hear the price.',
    persona: 'Bought-in on the product, ready to find any reason it\'s "too expensive".',
    difficulty: 'hard',
    objection_bank: [
      { text: 'That\'s way more than I expected.', weight: 3 },
      { text: 'Your competitor is half that.', weight: 3 },
      { text: 'Can you do it for less if I sign today?', weight: 2 },
    ],
  },
  {
    slug: 'wont-book-call',
    name: 'The "I don\'t do calls" wall',
    blurb: 'Wants to do everything async. Practice booking the meeting anyway.',
    persona: 'Skeptical of sales calls in general. Believes calls are a waste of time.',
    difficulty: 'standard',
    objection_bank: [
      { text: 'I don\'t take sales calls.', weight: 3 },
      { text: 'Can you just demo it over video?', weight: 1 },
      { text: 'I\'ll book if I\'m interested after reading something.', weight: 2 },
    ],
  },
  {
    slug: 'gatekeeper',
    name: 'The gatekeeper',
    blurb: 'You\'re not talking to the buyer. Get past the wall.',
    persona: 'Executive assistant or office manager protecting the actual decision-maker.',
    difficulty: 'hard',
    objection_bank: [
      { text: 'What\'s this regarding?', weight: 3 },
      { text: 'They\'re not available.', weight: 3 },
      { text: 'Send it to me, I\'ll pass it along.', weight: 2 },
      { text: 'They get hundreds of these — it won\'t go anywhere.', weight: 1 },
    ],
  },
  {
    slug: 'happy-with-current',
    name: 'The "happy with current vendor"',
    blurb: 'They\'ve already got someone. Find the crack.',
    persona: 'Defensive about their existing solution, won\'t admit it has issues.',
    difficulty: 'hard',
    objection_bank: [
      { text: 'We\'re already using [competitor] and it works fine.', weight: 3 },
      { text: 'We just signed a 12-month contract.', weight: 2 },
      { text: 'I don\'t want to switch right now.', weight: 2 },
    ],
  },
  {
    slug: 'random-mix',
    name: 'Random mix · all your scenarios',
    blurb: 'AI rolls a dice between every scenario you\'ve built. The closest thing to a real pipeline.',
    persona: '__random__', // sentinel — runtime picks a scenario per session
    difficulty: 'standard',
    objection_bank: [],
  },
]

// ── Training doc CRUD (tenant-side) ───────────────────────────────────────

export type TrainingDocInput = {
  doc_kind: TrainingDocKind
  scope: TrainingDocScope
  title: string
  body?: string | null
  storage_path?: string | null
  owner_member_id?: string | null
}

export async function createTrainingDoc(
  repId: string,
  uploadedByMemberId: string,
  input: TrainingDocInput,
): Promise<TrainingDoc> {
  const { data, error } = await supabase
    .from('roleplay_training_docs')
    .insert({
      rep_id: repId,
      uploaded_by_member_id: uploadedByMemberId,
      owner_member_id: input.scope === 'personal' ? input.owner_member_id ?? uploadedByMemberId : null,
      scope: input.scope,
      doc_kind: input.doc_kind,
      title: input.title,
      body: input.body ?? null,
      storage_path: input.storage_path ?? null,
      is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as TrainingDoc
}

export async function deleteTrainingDoc(
  repId: string,
  docId: string,
): Promise<void> {
  // Soft-delete: flip is_active so old session transcripts that referenced
  // it stay readable.
  const { error } = await supabase
    .from('roleplay_training_docs')
    .update({ is_active: false })
    .eq('id', docId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function setTrainingDocActive(
  repId: string,
  docId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('roleplay_training_docs')
    .update({ is_active: isActive })
    .eq('id', docId)
    .eq('rep_id', repId)
  if (error) throw error
}
