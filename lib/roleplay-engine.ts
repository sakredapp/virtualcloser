import { supabase } from './supabase'
import { getAnthropic } from './anthropic'
import { getSessionPayload } from './client-auth'
import { getTenantBySlug, type Tenant } from './tenant'
import { getMemberById, getOwnerMember } from './members'
import { isRoleplayActiveForMember } from './roleplay'
import { gradeApplicationTranscript, type CarrierKey } from './roleplay-application'
import { assertWalletCanStart, chargeRoleplaySession } from './roleplay-billing'
import type { Member } from '@/types'

/**
 * Roleplay engine — the live half of the roleplay suite.
 *
 * lib/roleplay.ts is the data layer (tables, entitlements, presets). This
 * module is the session lifecycle for a BROWSER practice call:
 *
 *   start    → row in roleplay_sessions + which RevRing agent to dial
 *   dialed   → server-stamps the moment the SDK connected (binds the window)
 *   finalize → find the provider call, pull the transcript, grade it
 *
 * The hard part is binding: @revring/webrtc-sdk's startCall({to}) returns a
 * Twilio Call whose ids live in a different namespace from RevRing's, so the
 * provider call id must be inferred from "web calls to this agent inside the
 * server-clocked window". The rule is EXACTLY ONE CANDIDATE OR NOTHING — a
 * refused bind costs a rep their scorecard; a wrong bind files one member's
 * practice transcript under another's name. The unique constraint on
 * roleplay_sessions.provider_call_id is the DB-level backstop.
 */

const MODEL_SMART =
  process.env.ANTHROPIC_MODEL_SMART || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

// ── Built-in personas (the four live RevRing trainer agents) ────────────────
// Same agents the marketing demo dials (app/api/demo/voice-session/route.ts);
// env vars override the ids, the *_NUMBER env vars carry the dialable number.

export type TrainerPersonaKey = 'sam_carter' | 'jamie_torres' | 'robert_hutchins' | 'travis_holt'

export type TrainerPersona = {
  key: TrainerPersonaKey
  name: string
  headline: string
  blurb: string
  difficulty: 'standard' | 'hard' | 'brutal'
  idEnv: string
  numberEnv: string
  defaultId: string
}

export const TRAINER_PERSONAS: TrainerPersona[] = [
  {
    key: 'sam_carter',
    name: 'Sam Carter',
    headline: 'Skeptical Homeowner · Age 56',
    blurb: 'Burned by a pushy agent before. Questions everything, hates being sold, respects straight answers.',
    difficulty: 'hard',
    idEnv: 'REVRING_TRAINER_AGENT_ID',
    numberEnv: 'REVRING_TRAINER_AGENT_NUMBER',
    defaultId: 'cmonbi0aw004tka0i89jh5gij',
  },
  {
    key: 'jamie_torres',
    name: 'Jamie Torres',
    headline: 'New Parent, First Home · Age 34',
    blurb: 'Wants to protect the family but every dollar is spoken for. Price-sensitive, easily overwhelmed.',
    difficulty: 'standard',
    idEnv: 'REVRING_TRAINER_2_AGENT_ID',
    numberEnv: 'REVRING_TRAINER_2_AGENT_NUMBER',
    defaultId: 'cmougrn25005slc0hq2icvht0',
  },
  {
    key: 'robert_hutchins',
    name: 'Robert Hutchins',
    headline: 'Retired, Near Payoff · Age 71',
    blurb: '"The house is almost paid off — what do I need this for?" Polite, stubborn, fixed income.',
    difficulty: 'hard',
    idEnv: 'REVRING_TRAINER_3_AGENT_ID',
    numberEnv: 'REVRING_TRAINER_3_AGENT_NUMBER',
    defaultId: 'cmoujlgz2005ylc0h3yliq9qk',
  },
  {
    key: 'travis_holt',
    name: 'Travis Holt',
    headline: 'Sole Breadwinner, Dangerous Job · Age 41',
    blurb: 'Knows he needs coverage, still stalls. Deflects with humor, tests whether you can hold the frame.',
    difficulty: 'brutal',
    idEnv: 'REVRING_TRAINER_4_AGENT_ID',
    numberEnv: 'REVRING_TRAINER_4_AGENT_NUMBER',
    defaultId: 'cmoujmsze0062lc0hmvm0obt7',
  },
]

export function getPersona(key: string): TrainerPersona | null {
  return TRAINER_PERSONAS.find((p) => p.key === key) ?? null
}

export function personaAgent(p: { idEnv: string; numberEnv: string; defaultId?: string }): {
  agentId: string | null
  agentNumber: string | null
} {
  return {
    agentId: process.env[p.idEnv] ?? p.defaultId ?? null,
    agentNumber: process.env[p.numberEnv] ?? null,
  }
}

// ── Application-mode scenarios (sale is made; now write the business) ───────
// Same floor, different phase: the persona is an APPLICANT with a hidden
// answer sheet (lib/roleplay-application.ts) and the grade is field-capture +
// probing against a real carrier's application flow. The RevRing agents for
// these are provisioned by scripts/provision-roleplay-applicant-agents.ts;
// a scenario goes live on the floor when its *_NUMBER env var is set.

export type ApplicationScenarioDef = {
  key: string
  name: string
  headline: string
  blurb: string
  difficulty: 'standard' | 'hard' | 'brutal'
  carrier: CarrierKey
  profileKey: string
  idEnv: string
  numberEnv: string
}

export const APPLICATION_SCENARIOS: ApplicationScenarioDef[] = [
  {
    key: 'app_ta_sam',
    name: 'Sam Carter · Transamerica app',
    headline: 'Application mode · Part 1 + Part 2',
    blurb:
      'Sam said yes. Now take the full Transamerica application — and when he says "I had something done with my heart," get the procedure, date, outcome, and doctor.',
    difficulty: 'brutal',
    carrier: 'transamerica',
    profileKey: 'sam_carter_app',
    idEnv: 'REVRING_APP_TA_AGENT_ID',
    numberEnv: 'REVRING_APP_TA_AGENT_NUMBER',
  },
  {
    key: 'app_foresters_jamie',
    name: 'Jamie Torres · Foresters e-App',
    headline: 'Application mode · iGO flow + TIA',
    blurb:
      'Walk Jamie through the Foresters e-App: lifestyle history, the health sweep, a minor contingent beneficiary that needs a trustee, and the six temporary-insurance questions before you touch premium.',
    difficulty: 'hard',
    carrier: 'foresters',
    profileKey: 'jamie_torres_app',
    idEnv: 'REVRING_APP_FORESTERS_AGENT_ID',
    numberEnv: 'REVRING_APP_FORESTERS_AGENT_NUMBER',
  },
]

export function getApplicationScenario(key: string): ApplicationScenarioDef | null {
  return APPLICATION_SCENARIOS.find((s) => s.key === key) ?? null
}

// ── Auth (host-independent) ─────────────────────────────────────────────────
// The roleplay product host (roleplay.virtualcloser.com) is not a tenant
// subdomain, so requireMember()'s host→slug resolution doesn't apply there.
// The session cookie is scoped to .virtualcloser.com and carries the slug, so
// we resolve the tenant from the SESSION, not the host.

export async function resolveRoleplayMember(): Promise<
  { tenant: Tenant; member: Member } | null
> {
  const payload = await getSessionPayload()
  if (!payload?.slug) return null
  const tenant = await getTenantBySlug(payload.slug)
  if (!tenant) return null
  let member: Member | null = null
  if (payload.memberId) {
    const m = await getMemberById(payload.memberId)
    if (m && m.is_active && m.rep_id === tenant.id) member = m
  }
  if (!member) member = await getOwnerMember(tenant.id)
  if (!member) return null
  return { tenant, member }
}

/**
 * Whether this member may run practice sessions.
 * ROLEPLAY_OPEN_ACCESS=true opens the floor to every authenticated member
 * (launch mode, before add-on billing rows are provisioned). Otherwise the
 * 2-key addon lock in lib/roleplay.ts decides.
 */
export async function canPractice(tenant: Tenant, member: Member): Promise<boolean> {
  if ((process.env.ROLEPLAY_OPEN_ACCESS ?? '').toLowerCase() === 'true') return true
  try {
    return await isRoleplayActiveForMember(tenant.id, member.id)
  } catch {
    return false
  }
}

// ── RevRing REST (platform key) ─────────────────────────────────────────────

const RR_BASE = 'https://api.revring.ai/v1'

type RevRingCall = {
  id: string
  agentId: string | null
  status: 'QUEUED' | 'INITIATED' | 'ONGOING' | 'TRANSFERRED' | 'COMPLETED' | 'FAILED' | 'CANCELED'
  toNumber: string
  transcript: Array<Record<string, unknown>> | null
  durationSeconds: number | null
  startedAt: string | null
  endedAt: string | null
  createdAt?: string | null
  /** "web_widget" for calls the browser SDK started; null for phone calls. */
  source?: 'web_widget' | null
}

function rrKey(): string {
  const key = process.env.REVRING_API_KEY
  if (!key) throw new Error('roleplay_revring_key_missing')
  return key
}

async function rrGet<T>(path: string): Promise<T> {
  const res = await fetch(`${RR_BASE}${path}`, {
    headers: { 'x-api-key': rrKey() },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`revring_${res.status}:${text.slice(0, 200)}`)
  }
  const json = (await res.json().catch(() => null)) as { data?: T } | T | null
  if (json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)) {
    return (json as { data: T }).data
  }
  return json as T
}

async function listAgentCalls(agentId: string, fromIso: string, toIso: string): Promise<RevRingCall[]> {
  const q = new URLSearchParams({
    sortBy: 'createdAt',
    sortDir: 'desc',
    agentId,
    createdFrom: fromIso,
    createdTo: toIso,
    pageSize: '50',
  })
  const out = await rrGet<RevRingCall[] | { data: RevRingCall[] }>(`/calls?${q.toString()}`)
  return Array.isArray(out) ? out : ((out as { data: RevRingCall[] })?.data ?? [])
}

/** A web call to this agent, vs a PSTN call that happens to land on it.
 *  `source` is the documented discriminator; the toNumber===agentId fallback
 *  covers a provider that hasn't populated source (an agent id is never a
 *  valid E.164, so the fallback can't false-positive). */
function isWebCall(call: RevRingCall, agentId: string): boolean {
  if (call.source === 'web_widget') return true
  return String(call.toNumber ?? '') === agentId
}

const WINDOW_SKEW_MS = 45_000

// ── Session lifecycle ───────────────────────────────────────────────────────

export type RoleplaySessionRow = {
  id: string
  rep_id: string
  member_id: string
  scenario_key: string | null
  status: 'active' | 'completed' | 'abandoned'
  agent_id: string | null
  agent_number: string | null
  provider_call_id: string | null
  bind_note: string | null
  requested_at: string
  dialed_at: string | null
  started_at: string
  completed_at: string | null
  duration_seconds: number | null
  ai_score: number | null
  ai_summary: string | null
  ai_strengths: string | null
  ai_weaknesses: string | null
  transcript_full: string | null
}

export async function startBrowserSession(
  tenant: Tenant,
  member: Member,
  personaKey: string,
): Promise<{ session: RoleplaySessionRow; agentNumber: string; personaName: string }> {
  const persona = getPersona(personaKey) ?? getApplicationScenario(personaKey)
  if (!persona) throw new Error('roleplay_unknown_persona')
  const { agentId, agentNumber } = personaAgent(persona as { idEnv: string; numberEnv: string; defaultId?: string })
  if (!agentId || !agentNumber) throw new Error('roleplay_agent_number_not_configured')

  // Micro-purchase gate: at least one minute of wallet balance before the
  // call starts (no-op unless ROLEPLAY_BILLING_ENABLED).
  await assertWalletCanStart(tenant.id)

  const { data, error } = await supabase
    .from('roleplay_sessions')
    .insert({
      rep_id: tenant.id,
      member_id: member.id,
      scenario_key: persona.key,
      status: 'active',
      transport: 'browser',
      agent_id: agentId,
      agent_number: agentNumber,
    })
    .select()
    .single()
  if (error) throw error
  return { session: data as RoleplaySessionRow, agentNumber, personaName: persona.name }
}

export async function markDialed(tenant: Tenant, member: Member, sessionId: string): Promise<void> {
  // Server-stamped: the browser says THAT it dialed, never WHEN. Only stamp
  // once so a retried request can't widen the bind window.
  const { error } = await supabase
    .from('roleplay_sessions')
    .update({ dialed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('rep_id', tenant.id)
    .eq('member_id', member.id)
    .is('dialed_at', null)
  if (error) throw error
}

export type FinalizeOutcome =
  | { state: 'graded'; session: RoleplaySessionRow }
  | { state: 'pending'; note: string }
  | { state: 'failed'; note: string; session?: RoleplaySessionRow }

export async function finalizeSession(
  tenant: Tenant,
  member: Member,
  sessionId: string,
): Promise<FinalizeOutcome> {
  const { data, error } = await supabase
    .from('roleplay_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('rep_id', tenant.id)
    .eq('member_id', member.id)
    .maybeSingle()
  if (error) throw error
  const session = data as RoleplaySessionRow | null
  if (!session) return { state: 'failed', note: 'Session not found.' }
  if (session.status === 'completed') return { state: 'graded', session }

  // ── Bind: which provider call was this browser session? ──────────────────
  let callId = session.provider_call_id
  if (!callId) {
    if (!session.agent_id) return { state: 'failed', note: 'Session has no agent.' }
    const from = new Date(new Date(session.requested_at).getTime() - WINDOW_SKEW_MS)
    const upper = session.dialed_at ? new Date(session.dialed_at) : new Date()
    const to = new Date(upper.getTime() + WINDOW_SKEW_MS)
    const calls = await listAgentCalls(session.agent_id, from.toISOString(), to.toISOString())
    const candidates = calls.filter((c) => isWebCall(c, session.agent_id!))

    if (candidates.length === 0) {
      return { state: 'pending', note: 'Call not visible at the provider yet — retrying.' }
    }
    if (candidates.length > 1) {
      // Two browser sessions hit the same persona in the same window. Refuse:
      // a missing scorecard beats a transcript filed under the wrong member.
      const note = `Could not bind: ${candidates.length} web calls on this persona in the window.`
      await supabase
        .from('roleplay_sessions')
        .update({ status: 'abandoned', bind_note: note, completed_at: new Date().toISOString() })
        .eq('id', session.id)
      return { state: 'failed', note }
    }
    callId = candidates[0].id
    // Claim the call. The unique constraint on provider_call_id makes a race
    // between two sessions a visible DB error, not a silent double-bind.
    const { error: claimErr } = await supabase
      .from('roleplay_sessions')
      .update({ provider_call_id: callId })
      .eq('id', session.id)
      .is('provider_call_id', null)
    if (claimErr) {
      return { state: 'failed', note: 'That call was already claimed by another session.' }
    }
  }

  // ── Pull the finished call ────────────────────────────────────────────────
  const call = await rrGet<RevRingCall>(`/calls/${encodeURIComponent(callId)}`)
  if (call.status === 'QUEUED' || call.status === 'INITIATED' || call.status === 'ONGOING') {
    return { state: 'pending', note: 'Call is still wrapping up at the provider.' }
  }

  const turns = flattenTranscript(call.transcript)
  const transcriptText = turns.map((t) => `${t.speaker === 'rep' ? 'REP' : 'PROSPECT'}: ${t.text}`).join('\n')
  const durationSeconds = call.durationSeconds ?? null

  // Too short to judge — store the transcript, skip the grade.
  if (turns.length < 6) {
    const { data: updated, error: upErr } = await supabase
      .from('roleplay_sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        transcript_full: transcriptText || null,
        ai_summary: 'Session too short to grade — under 6 turns. Run the call longer and work the objections.',
      })
      .eq('id', session.id)
      .select()
      .single()
    if (upErr) throw upErr
    await bumpDailyActivity(tenant.id, member.id, durationSeconds, null)
    await settlePractice(tenant.id, member.id, session.id, durationSeconds)
    return { state: 'graded', session: updated as RoleplaySessionRow }
  }

  // Application-mode sessions grade against the carrier flow + the hidden
  // answer sheet; sales sessions grade on the coaching rubric.
  const appScenario = session.scenario_key ? getApplicationScenario(session.scenario_key) : null
  const grade = appScenario
    ? await gradeApplicationTranscript(transcriptText, appScenario.carrier as CarrierKey, appScenario.profileKey)
    : await gradeTranscript(transcriptText, session.scenario_key ? getPersona(session.scenario_key) : null)

  const { data: updated, error: upErr } = await supabase
    .from('roleplay_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      transcript_full: transcriptText,
      ai_score: grade.score,
      ai_summary: grade.summary,
      ai_strengths: grade.strengths,
      ai_weaknesses: grade.weaknesses,
    })
    .eq('id', session.id)
    .select()
    .single()
  if (upErr) throw upErr
  await bumpDailyActivity(tenant.id, member.id, durationSeconds, grade.score)
  await settlePractice(tenant.id, member.id, session.id, durationSeconds)
  return { state: 'graded', session: updated as RoleplaySessionRow }
}

export async function listMySessions(tenant: Tenant, member: Member, limit = 20): Promise<RoleplaySessionRow[]> {
  const { data, error } = await supabase
    .from('roleplay_sessions')
    .select('*')
    .eq('rep_id', tenant.id)
    .eq('member_id', member.id)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RoleplaySessionRow[]
}

// ── Transcript + grading ────────────────────────────────────────────────────

/** Defensive across the provider's loosely-typed turn shapes; falls back to
 *  raw JSON rather than dropping a turn — a silently missing line corrupts the
 *  scorecard in the direction that flatters the rep. */
function flattenTranscript(
  transcript: Array<Record<string, unknown>> | null,
): { speaker: 'rep' | 'persona' | 'unknown'; text: string }[] {
  if (!Array.isArray(transcript)) return []
  return transcript.map((turn) => {
    const rawRole = String(turn.role ?? turn.speaker ?? turn.from ?? '').toLowerCase()
    const text = String(turn.content ?? turn.text ?? turn.message ?? JSON.stringify(turn))
    const speaker: 'rep' | 'persona' | 'unknown' = /assistant|agent|ai|bot/.test(rawRole)
      ? 'persona'
      : /user|human|customer|caller/.test(rawRole)
        ? 'rep'
        : 'unknown'
    return { speaker, text }
  })
}

type Grade = { score: number; summary: string; strengths: string; weaknesses: string }

async function gradeTranscript(transcript: string, persona: TrainerPersona | null): Promise<Grade> {
  const personaLine = persona
    ? `The AI prospect was "${persona.name}" (${persona.headline}): ${persona.blurb}`
    : 'The AI prospect ran a standard sales-objection scenario.'

  const response = await getAnthropic().messages.create({
    model: MODEL_SMART,
    max_tokens: 900,
    system: [
      'You are a veteran sales trainer grading a practice call between a sales rep (REP) and an AI prospect (PROSPECT).',
      personaLine,
      'Grade the REP only. Rubric, weighted evenly: (1) opener and tone-setting, (2) discovery questions, (3) objection handling — did they acknowledge, isolate, and answer, (4) control of the call — who was steering, (5) close attempt — did they ask for the next step.',
      'Be direct and specific like a coach who was on the call. Quote short fragments of what the rep actually said when it matters.',
      'Reply with ONLY a JSON object: {"score": <integer 0-100>, "summary": "<2-3 sentence verdict>", "strengths": "<what they did well, concrete>", "weaknesses": "<what to fix next session, concrete>"}',
    ].join('\n'),
    messages: [{ role: 'user', content: transcript.slice(0, 60_000) }],
  })

  const raw = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('roleplay_grade_unparseable')
  const parsed = JSON.parse(jsonMatch[0]) as Partial<Grade>
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))))
  return {
    score,
    summary: String(parsed.summary ?? '').slice(0, 2000),
    strengths: String(parsed.strengths ?? '').slice(0, 2000),
    weaknesses: String(parsed.weaknesses ?? '').slice(0, 2000),
  }
}

// Wallet charge for a finished session. Idempotent at the DB (one ledger row
// per session), and deliberately log-and-continue: a lost grade is invisible
// to the rep, a missing ledger row is visible in the wallet — the recoverable
// failure is the one we keep.
async function settlePractice(
  repId: string,
  memberId: string,
  sessionId: string,
  durationSeconds: number | null,
): Promise<void> {
  try {
    const receipt = await chargeRoleplaySession({ repId, memberId, sessionId, durationSeconds })
    if (receipt) {
      console.log(
        `[roleplay/billing] session ${sessionId}: charged ${receipt.charged_cents}¢, balance ${receipt.balance_cents}¢`,
      )
    }
  } catch (err) {
    console.error('[roleplay/billing] charge failed', sessionId, err instanceof Error ? err.message : err)
  }
}

async function bumpDailyActivity(
  repId: string,
  memberId: string,
  durationSeconds: number | null,
  score: number | null,
): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10)
    const minutes = Math.max(1, Math.round((durationSeconds ?? 60) / 60))
    const { data } = await supabase
      .from('roleplay_daily_activity')
      .select('*')
      .eq('rep_id', repId)
      .eq('member_id', memberId)
      .eq('day', day)
      .maybeSingle()
    if (!data) {
      await supabase.from('roleplay_daily_activity').insert({
        rep_id: repId,
        member_id: memberId,
        day,
        sessions_count: 1,
        minutes_practiced: minutes,
        avg_score: score,
        best_score: score,
      })
      return
    }
    const prevCount = Number(data.sessions_count ?? 0)
    const prevAvg = data.avg_score == null ? null : Number(data.avg_score)
    const nextAvg =
      score == null
        ? prevAvg
        : prevAvg == null
          ? score
          : (prevAvg * prevCount + score) / (prevCount + 1)
    const prevBest = data.best_score == null ? null : Number(data.best_score)
    await supabase
      .from('roleplay_daily_activity')
      .update({
        sessions_count: prevCount + 1,
        minutes_practiced: Number(data.minutes_practiced ?? 0) + minutes,
        avg_score: nextAvg,
        best_score: score == null ? prevBest : prevBest == null ? score : Math.max(prevBest, score),
      })
      .eq('rep_id', repId)
      .eq('member_id', memberId)
      .eq('day', day)
  } catch {
    // Leaderboard rollup is best-effort; never fail a grade over it.
  }
}
