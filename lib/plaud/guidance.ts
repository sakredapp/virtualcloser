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
import { logFixRequest, type FixRequestSeverity, type FixRequestSource } from '@/lib/feedback/fixRequests'

const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5'

// Cap how many rules we inject so a long history can't blow the prompt. Ordered
// by weight then recency, so the most-reinforced, freshest rules win.
const MAX_INJECT = 40
// How many existing rules to show the de-dupe step.
const MAX_DEDUPE = 60

export type GuidanceScope = 'note_agent' | 'planner' | 'both' | 'email'
export type GuidanceKind = 'avoid' | 'prefer' | 'correction' | 'fact'

export type GuidanceRule = {
  id: string
  rep_id: string
  scope: GuidanceScope
  kind: GuidanceKind
  rule: string
  /** Who the rule is about (e.g. "CFO", "the board"), or null for general. */
  subject: string | null
  source: 'action' | 'plan' | 'manual'
  source_kind: string | null
  source_ref: string | null
  weight: number
  active: boolean
  created_at: string
  updated_at: string
}

const VALID_SCOPE = new Set<GuidanceScope>(['note_agent', 'planner', 'both', 'email'])
const VALID_KIND = new Set<GuidanceKind>(['avoid', 'prefer', 'correction', 'fact'])

// ── Read path (prompt injection) ─────────────────────────────────────────

/**
 * Active rules for `scope` — includes 'both'. Ordered so the prompt leads with
 * the rules Spencer reinforced most.
 */
export async function loadGuidance(
  repId: string,
  scope: 'note_agent' | 'planner' | 'email',
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
    const body = r.rule.trim()
    if (!body) continue
    // Label per-relationship rules so the agent applies them to the right person.
    const text = r.subject ? `(about ${r.subject}) ${body}` : body
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
  /** For auto-routing a product/code fix to the daily digest. */
  memberId?: string | null
  createdBy?: string | null
  /**
   * Keep the caller-provided scope even if the synthesizer suggests another.
   * Needed for the 'email' scope: the synth prompt only knows the Plaud scopes,
   * so without this it would reassign email rules to note_agent/planner.
   */
  lockScope?: boolean
}

/**
 * Distill a feedback signal into a durable rule and persist it. Returns the
 * created or reinforced rule (for an optimistic "Learned: …" confirmation), or
 * null if nothing could be written.
 */
export async function learnFromFeedback(input: LearnInput): Promise<GuidanceRule | null> {
  const existing = await loadAllActive(input.repId)
  const synthesized = await synthesize(input, existing)

  // Auto-route any software fix to the developer's daily digest first, so it's
  // captured whether or not the behavior rule is new or a reinforcement.
  await maybeLogProductIssue(input, synthesized?.productIssue ?? null)

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
  const scope: GuidanceScope = input.lockScope ? input.scope : (synthesized?.scope ?? input.scope)

  const { data, error } = await supabase
    .from('plaud_agent_guidance')
    .insert({
      rep_id: input.repId,
      scope,
      kind,
      rule: rule.slice(0, 400),
      subject: synthesized?.subject ?? null,
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

async function maybeLogProductIssue(input: LearnInput, productIssue: string | null): Promise<void> {
  if (!productIssue || !productIssue.trim()) return
  await captureIssue({
    repId: input.repId,
    memberId: input.memberId ?? null,
    body: productIssue.trim(),
    area: input.sourceKind ?? null,
    createdBy: input.createdBy ?? null,
    source: input.source === 'plan' ? 'plan' : input.source === 'manual' ? 'manual' : 'dismiss',
  })
}

/**
 * Capture a code-fix issue. Per the operating principle, it ALWAYS goes two
 * places: (1) the developer's daily fix-digest (humans fix code), and (2) the
 * education brain as a 'fact' rule, so the bot self-adjusts around its own
 * limitation (acknowledges it's flagged instead of pretending it can). Both are
 * best-effort and independent.
 */
export async function captureIssue(input: {
  repId: string
  memberId?: string | null
  body: string
  area?: string | null
  severity?: FixRequestSeverity
  createdBy?: string | null
  source?: FixRequestSource
}): Promise<void> {
  const body = input.body.trim()
  if (!body) return
  // 1) Route to the developer.
  try {
    await logFixRequest({
      repId: input.repId,
      memberId: input.memberId ?? null,
      source: input.source ?? 'auto',
      body,
      area: input.area ?? null,
      severity: input.severity,
      createdBy: input.createdBy ?? null,
    })
  } catch (err) {
    console.warn('[guidance] captureIssue fix-request failed', String(err).slice(0, 160))
  }
  // 2) Always also teach the brain so the assistant handles the gap gracefully.
  try {
    await supabase.from('plaud_agent_guidance').insert({
      rep_id: input.repId,
      scope: 'both',
      kind: 'fact',
      rule: `Known limitation (flagged for the dev team): ${body}. If asked to do this, say it's been flagged and is coming — don't attempt it or pretend it works.`.slice(0, 400),
      source: 'manual',
      source_kind: 'gap',
    })
  } catch (err) {
    console.warn('[guidance] captureIssue brain write failed', String(err).slice(0, 160))
  }
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
  subject: string | null
  productIssue: string | null
}

async function synthesize(input: LearnInput, existing: GuidanceRule[]): Promise<Synthesized | null> {
  const existingList =
    existing.length > 0
      ? existing.map((r, i) => `  [${i}] (id=${r.id}) ${r.rule}`).join('\n')
      : '  (none yet)'

  const system = `You convert a single piece of feedback about an AI executive assistant into ONE durable, reusable rule the assistant should follow going forward.

Output STRICT JSON on one line, no markdown:
{"duplicate_of": <index of an existing rule this duplicates/reinforces, or null>, "kind": "avoid|prefer|correction|fact", "scope": "note_agent|planner|both", "rule": "<imperative, <=160 chars, generalizable>", "subject": <null, OR the specific person/group this rule is about — "CFO", "the board", "Maria" — set ONLY when the rule is about how to deal with them>, "product_issue": <null, OR a crisp summary of a SOFTWARE bug/change the developer must fix in code>}

Rules for your output:
- Generalize: "Don't email vendors without checking with me first" — not "Don't email lauren@x.com the vendor list on May 3".
- "avoid" = stop doing something; "prefer" = do more of something; "correction" = a fix to apply (wrong recipient/email/format); "fact" = a durable fact (e.g. a person's correct email).
- scope: "note_agent" for rules about which ACTIONS to propose from recordings; "planner" for rules about daily PRIORITIES; "both" for durable facts/corrections about people.
- If this clearly reinforces an existing rule, set duplicate_of to its index and still fill the other fields.
- Keep the rule crisp and self-contained — it will be shown to the assistant with no other context.
- product_issue: set this ONLY when the feedback is about the SOFTWARE itself being wrong or needing a change the assistant cannot make on its own — a bug, a broken/incorrect feature, a UI problem, or "I want it to work this way". A normal preference the assistant can just follow is NOT a product issue (leave null). When set, write a clear one-to-two sentence description of what to fix.`

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
    const productIssue =
      typeof obj.product_issue === 'string' && obj.product_issue.trim()
        ? obj.product_issue.trim()
        : null
    const subject = typeof obj.subject === 'string' && obj.subject.trim() ? obj.subject.trim().slice(0, 80) : null
    return {
      duplicateOf,
      subject,
      kind: VALID_KIND.has(kindRaw) ? kindRaw : defaultKind(input.signal),
      scope: VALID_SCOPE.has(scopeRaw) ? scopeRaw : input.scope,
      rule,
      productIssue,
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

// ── Learn from a Telegram chat message ───────────────────────────────────

/**
 * Conservatively distill a durable preference/correction (or a software issue)
 * from a single chat message and persist it — so the bot learns from how the
 * exec/assistant talks to it, not just from dashboard clicks. Best-effort; most
 * messages yield nothing. Call behind a cheap keyword gate to avoid spending a
 * model call on every message.
 */
export async function learnFromChat(input: {
  repId: string
  claudeKey?: string | null
  message: string
  memberId?: string | null
  createdBy?: string | null
}): Promise<void> {
  const message = input.message.trim()
  if (message.length < 4) return
  const existing = await loadAllActive(input.repId)
  const existingList = existing.length > 0 ? existing.map((r) => `  - ${r.rule}`).join('\n') : '  (none yet)'

  const system = `The user is chatting with their AI assistant. Decide if THIS message contains a DURABLE instruction/preference/correction the assistant should remember going forward, or reports a software problem to fix. Most chat is neither — be conservative and return nulls unless it's clearly durable.

Output STRICT JSON on one line:
{"rule": <null OR an imperative, <=160-char standing rule>, "kind": "avoid|prefer|correction|fact", "scope": "planner|both", "subject": <null OR the specific person/group this rule is about — "CFO", "the board", "Maria" — set ONLY when it's about how to deal with them>, "product_issue": <null OR a crisp description of a software bug/change the developer must make>}

- rule = a standing instruction to follow from now on ("always send my drafts before 9am", "never CC the whole team", "with the CFO lead with numbers"). A one-off request ("send this now") is NOT a rule → null.
- subject = who the rule is about, when it's relationship-specific (e.g. "with the board, keep it formal" → subject "the board"). General rules → null.
- fact = a durable fact about a person/preference; correction = a fix to apply; avoid/prefer = stop/do more of something.
- product_issue = the user says the software/bot itself is broken or wants it changed.
- Normal requests, questions, or chit-chat → rule null AND product_issue null.

Existing rules (don't duplicate):
${existingList}`

  try {
    const res = await runWithClaudeKey(input.claudeKey, () =>
      getAnthropic().messages.create({
        model: MODEL_FAST,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: message }],
      }),
    )
    const text = res.content.find((b) => b.type === 'text')
    const raw = text && text.type === 'text' ? text.text : ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return
    const obj = JSON.parse(m[0]) as Record<string, unknown>

    const rule = typeof obj.rule === 'string' && obj.rule.trim() ? obj.rule.trim() : null
    if (rule && !existing.some((r) => r.rule.toLowerCase() === rule.toLowerCase())) {
      const kindRaw = String(obj.kind ?? 'prefer') as GuidanceKind
      const scopeRaw = String(obj.scope ?? 'both') as GuidanceScope
      const subject = typeof obj.subject === 'string' && obj.subject.trim() ? obj.subject.trim().slice(0, 80) : null
      await supabase.from('plaud_agent_guidance').insert({
        rep_id: input.repId,
        scope: VALID_SCOPE.has(scopeRaw) ? scopeRaw : 'both',
        kind: VALID_KIND.has(kindRaw) ? kindRaw : 'prefer',
        rule: rule.slice(0, 400),
        subject,
        source: 'manual',
        source_kind: 'telegram',
      })
    }

    const productIssue = typeof obj.product_issue === 'string' && obj.product_issue.trim() ? obj.product_issue.trim() : null
    if (productIssue) {
      await logFixRequest({
        repId: input.repId,
        memberId: input.memberId ?? null,
        source: 'manual',
        body: productIssue,
        area: 'telegram (chat)',
        createdBy: input.createdBy ?? null,
      })
    }
  } catch (err) {
    console.warn('[guidance] learnFromChat failed', String(err).slice(0, 160))
  }
}

// ── CRUD for the "What your assistant has learned" panel ──────────────────

/** Active per-relationship rules (subject set), for proactive meeting context. */
export async function loadSubjectMemory(repId: string): Promise<Array<{ subject: string; rule: string }>> {
  const { data } = await supabase
    .from('plaud_agent_guidance')
    .select('subject, rule')
    .eq('rep_id', repId)
    .eq('active', true)
    .not('subject', 'is', null)
    .order('weight', { ascending: false })
    .limit(60)
  return ((data ?? []) as Array<{ subject: string | null; rule: string }>)
    .filter((r): r is { subject: string; rule: string } => Boolean(r.subject))
}

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
  subject: string | null = null,
): Promise<GuidanceRule | null> {
  const text = rule.trim().slice(0, 400)
  if (!text) return null
  const { data, error } = await supabase
    .from('plaud_agent_guidance')
    .insert({ rep_id: repId, rule: text, scope, kind, subject: subject?.trim()?.slice(0, 80) || null, source: 'manual' })
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
