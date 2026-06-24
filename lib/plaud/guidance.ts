// Plaud Agent Guidance — the unified self-learning store.
//
// One place every Plaud LLM call reads from. When Spencer reacts to the
// assistant's work (dismisses a proposed action with a reason, corrects a
// recipient, 👎s a plan item), `learnFromFeedback` distills that into a durable
// one-line RULE and persists it to plaud_agent_guidance — instantly, so the
// next agent/planner run picks it up. `loadGuidance` + `renderGuidance` inject
// the active rules back into the system prompts.
//
// Synthesis uses a fast Haiku call to turn raw feedback into a clean rule and
// de-dupe it against existing rules (bumping weight instead of piling up
// near-duplicates). It is best-effort: if the model is unavailable, we store a
// verbatim fallback so the signal is never lost.

import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'

const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5'

// Cap how many rules we inject so a long history can't blow the prompt. Ordered
// by weight then recency, so the most-reinforced, freshest rules win.
const MAX_INJECT = 40
// How many existing rules to show the de-dupe step.
const MAX_DEDUPE = 60

export type GuidanceScope = 'note_agent' | 'planner' | 'both'
export type GuidanceKind = 'avoid' | 'prefer' | 'correction' | 'fact'

export type GuidanceRule = {
  id: string
  rep_id: string
  scope: GuidanceScope
  kind: GuidanceKind
  rule: string
  source: 'action' | 'plan' | 'manual'
  source_kind: string | null
  source_ref: string | null
  weight: number
  active: boolean
  created_at: string
  updated_at: string
}

const VALID_SCOPE = new Set<GuidanceScope>(['note_agent', 'planner', 'both'])
const VALID_KIND = new Set<GuidanceKind>(['avoid', 'prefer', 'correction', 'fact'])

// ── Read path (prompt injection) ─────────────────────────────────────────

/**
 * Active rules for `scope` — includes 'both'. Ordered so the prompt leads with
 * the rules Spencer reinforced most.
 */
export async function loadGuidance(
  repId: string,
  scope: 'note_agent' | 'planner',
): Promise<GuidanceRule[]> {
  const { data, error } = await supabase
    .from('plaud_agent_guidance')
    .select('*')
    .eq('rep_id', repId)
    .eq('active', true)
    .in('scope', [scope, 'both'])
    .order('weight', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(MAX_INJECT)
  if (error) {
    console.warn('[guidance] load failed', error.message)
    return []
  }
  return (data ?? []) as GuidanceRule[]
}

/**
 * Render rules as a system-prompt block of standing do/don't guidance. Returns
 * '' when there are none so callers can concatenate unconditionally.
 */
export function renderGuidance(rules: GuidanceRule[]): string {
  if (rules.length === 0) return ''
  const avoid: string[] = []
  const prefer: string[] = []
  const corrections: string[] = []
  for (const r of rules) {
    const text = r.rule.trim()
    if (!text) continue
    if (r.kind === 'avoid') avoid.push(text)
    else if (r.kind === 'prefer') prefer.push(text)
    else corrections.push(text) // correction + fact
  }
  if (avoid.length === 0 && prefer.length === 0 && corrections.length === 0) return ''
  const lines: string[] = [
    `\nLEARNED GUIDANCE — durable rules from how they reacted to your past work. Treat these as standing instructions and follow them:`,
  ]
  if (avoid.length > 0) {
    lines.push('Avoid / stop doing:')
    for (const a of avoid) lines.push(`  - ${a}`)
  }
  if (corrections.length > 0) {
    lines.push('Always apply these corrections / facts:')
    for (const c of corrections) lines.push(`  - ${c}`)
  }
  if (prefer.length > 0) {
    lines.push('Do more of:')
    for (const p of prefer) lines.push(`  - ${p}`)
  }
  return lines.join('\n') + '\n'
}

// ── Write path (learning) ────────────────────────────────────────────────

export type LearnInput = {
  repId: string
  claudeKey?: string | null
  source: 'action' | 'plan' | 'manual'
  /** Default scope if the synthesizer can't decide. */
  scope: GuidanceScope
  /** The nature of the signal. */
  signal: 'avoid' | 'prefer' | 'correction'
  /** What the assistant did (e.g. "send_email to lauren@x.com — 'Vendor list'"). */
  context: string
  /** Spencer's words — why he dismissed / what he changed. May be empty. */
  reason: string
  sourceKind?: string | null
  sourceRef?: string | null
}

/**
 * Distill a feedback signal into a durable rule and persist it. Returns the
 * created or reinforced rule (for an optimistic "Learned: …" confirmation), or
 * null if nothing could be written.
 */
export async function learnFromFeedback(input: LearnInput): Promise<GuidanceRule | null> {
  const existing = await loadAllActive(input.repId)
  const synthesized = await synthesize(input, existing)

  // Reinforcement: the model matched an existing rule → bump its weight.
  if (synthesized?.duplicateOf) {
    const match = existing.find((r) => r.id === synthesized.duplicateOf)
    if (match) {
      const { data } = await supabase
        .from('plaud_agent_guidance')
        .update({ weight: match.weight + 1, active: true, updated_at: new Date().toISOString() })
        .eq('id', match.id)
        .eq('rep_id', input.repId)
        .select('*')
        .maybeSingle()
      return (data as GuidanceRule | null) ?? { ...match, weight: match.weight + 1 }
    }
  }

  const rule = synthesized?.rule?.trim() || fallbackRule(input)
  const kind: GuidanceKind = synthesized?.kind ?? defaultKind(input.signal)
  const scope: GuidanceScope = synthesized?.scope ?? input.scope

  const { data, error } = await supabase
    .from('plaud_agent_guidance')
    .insert({
      rep_id: input.repId,
      scope,
      kind,
      rule: rule.slice(0, 400),
      source: input.source,
      source_kind: input.sourceKind ?? null,
      source_ref: input.sourceRef ?? null,
    })
    .select('*')
    .maybeSingle()
  if (error) {
    console.warn('[guidance] insert failed', error.message)
    return null
  }
  return data as GuidanceRule
}

async function loadAllActive(repId: string): Promise<GuidanceRule[]> {
  const { data } = await supabase
    .from('plaud_agent_guidance')
    .select('*')
    .eq('rep_id', repId)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(MAX_DEDUPE)
  return (data ?? []) as GuidanceRule[]
}

type Synthesized = {
  duplicateOf: string | null
  kind: GuidanceKind
  scope: GuidanceScope
  rule: string
}

async function synthesize(input: LearnInput, existing: GuidanceRule[]): Promise<Synthesized | null> {
  const existingList =
    existing.length > 0
      ? existing.map((r, i) => `  [${i}] (id=${r.id}) ${r.rule}`).join('\n')
      : '  (none yet)'

  const system = `You convert a single piece of feedback about an AI executive assistant into ONE durable, reusable rule the assistant should follow going forward.

Output STRICT JSON on one line, no markdown:
{"duplicate_of": <index of an existing rule this duplicates/reinforces, or null>, "kind": "avoid|prefer|correction|fact", "scope": "note_agent|planner|both", "rule": "<imperative, <=160 chars, generalizable>"}

Rules for your output:
- Generalize: "Don't email vendors without checking with me first" — not "Don't email lauren@x.com the vendor list on May 3".
- "avoid" = stop doing something; "prefer" = do more of something; "correction" = a fix to apply (wrong recipient/email/format); "fact" = a durable fact (e.g. a person's correct email).
- scope: "note_agent" for rules about which ACTIONS to propose from recordings; "planner" for rules about daily PRIORITIES; "both" for durable facts/corrections about people.
- If this clearly reinforces an existing rule, set duplicate_of to its index and still fill the other fields.
- Keep the rule crisp and self-contained — it will be shown to the assistant with no other context.`

  const user = `SIGNAL TYPE: ${input.signal}
WHAT THE ASSISTANT DID: ${input.context || '(unspecified)'}
USER'S FEEDBACK: ${input.reason || '(no words given — infer from the signal type and what the assistant did)'}
DEFAULT SCOPE IF UNSURE: ${input.scope}

EXISTING RULES:
${existingList}`

  try {
    const res = await runWithClaudeKey(input.claudeKey, () =>
      getAnthropic().messages.create({
        model: MODEL_FAST,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    )
    const text = res.content.find((b) => b.type === 'text')
    const raw = text && text.type === 'text' ? text.text : ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const obj = JSON.parse(match[0]) as Record<string, unknown>
    const rule = typeof obj.rule === 'string' ? obj.rule.trim() : ''
    if (!rule) return null
    const kindRaw = String(obj.kind ?? '') as GuidanceKind
    const scopeRaw = String(obj.scope ?? '') as GuidanceScope
    // duplicate_of is an index into `existing`; map it back to the rule id.
    let duplicateOf: string | null = null
    if (typeof obj.duplicate_of === 'number' && existing[obj.duplicate_of]) {
      duplicateOf = existing[obj.duplicate_of].id
    }
    return {
      duplicateOf,
      kind: VALID_KIND.has(kindRaw) ? kindRaw : defaultKind(input.signal),
      scope: VALID_SCOPE.has(scopeRaw) ? scopeRaw : input.scope,
      rule,
    }
  } catch (err) {
    console.warn('[guidance] synthesize failed — using verbatim fallback', String(err).slice(0, 160))
    return null
  }
}

function defaultKind(signal: LearnInput['signal']): GuidanceKind {
  if (signal === 'prefer') return 'prefer'
  if (signal === 'correction') return 'correction'
  return 'avoid'
}

function fallbackRule(input: LearnInput): string {
  const verb = input.signal === 'prefer' ? 'Do more like' : input.signal === 'correction' ? 'Correction' : 'Avoid'
  const body = input.reason.trim() || input.context.trim() || 'this'
  return `${verb}: ${body}`.slice(0, 400)
}

// ── CRUD for the "What your assistant has learned" panel ──────────────────

export async function listGuidance(repId: string): Promise<GuidanceRule[]> {
  const { data } = await supabase
    .from('plaud_agent_guidance')
    .select('*')
    .eq('rep_id', repId)
    .order('active', { ascending: false })
    .order('weight', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(200)
  return (data ?? []) as GuidanceRule[]
}

export async function addManualGuidance(
  repId: string,
  rule: string,
  scope: GuidanceScope = 'both',
  kind: GuidanceKind = 'avoid',
): Promise<GuidanceRule | null> {
  const text = rule.trim().slice(0, 400)
  if (!text) return null
  const { data, error } = await supabase
    .from('plaud_agent_guidance')
    .insert({ rep_id: repId, rule: text, scope, kind, source: 'manual' })
    .select('*')
    .maybeSingle()
  if (error) {
    console.warn('[guidance] manual insert failed', error.message)
    return null
  }
  return data as GuidanceRule
}

export async function updateGuidanceRule(
  id: string,
  repId: string,
  patch: { rule?: string; scope?: GuidanceScope; kind?: GuidanceKind; active?: boolean },
): Promise<boolean> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof patch.rule === 'string') {
    const text = patch.rule.trim().slice(0, 400)
    if (!text) return false
    update.rule = text
  }
  if (patch.scope && VALID_SCOPE.has(patch.scope)) update.scope = patch.scope
  if (patch.kind && VALID_KIND.has(patch.kind)) update.kind = patch.kind
  if (typeof patch.active === 'boolean') update.active = patch.active
  const { error } = await supabase
    .from('plaud_agent_guidance')
    .update(update)
    .eq('id', id)
    .eq('rep_id', repId)
  if (error) {
    console.warn('[guidance] update failed', error.message)
    return false
  }
  return true
}

export async function deleteGuidance(id: string, repId: string): Promise<boolean> {
  const { error } = await supabase
    .from('plaud_agent_guidance')
    .delete()
    .eq('id', id)
    .eq('rep_id', repId)
  if (error) {
    console.warn('[guidance] delete failed', error.message)
    return false
  }
  return true
}
