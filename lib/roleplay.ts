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
