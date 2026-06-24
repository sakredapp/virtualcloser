// Plaud Daily Plan tick — the "overseer" layer over the per-note agent.
//
// Once each morning (rep-local), rolls up everything new since the last plan —
// triaged recordings, open brain tasks, and pending agent actions awaiting
// approval — into ONE prioritized plan with a reason per item. Spencer reviews
// it on the Command Center (👍/👎 + why); that feedback is read back here on the
// next run so the plan sharpens over time. This is preference memory, not
// retraining: every 👎+reason becomes a standing rule in the planner prompt.
//
// Runs inside the Hetzner worker (see hetzner-worker/index.ts), gated by the
// same PLAUD_AGENT_REP_IDS env as the per-note agent.

import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { plaudAgentEnabledReps } from '@/lib/plaud/agentTick'
import { loadGuidance, renderGuidance } from '@/lib/plaud/guidance'

const MODEL_PLANNER = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'
// Don't generate before this rep-local hour — the plan should reflect a full
// night of recordings and land as a morning briefing, not at 1am.
const PLAN_HOUR = parseInt(process.env.DAILY_PLAN_HOUR ?? '6', 10)
// How far back to pull "new" material. A day off (no recordings) shouldn't make
// the next plan empty — 48h gives a little overlap without dredging stale work.
const LOOKBACK_HOURS = parseInt(process.env.DAILY_PLAN_LOOKBACK_HOURS ?? '48', 10)
const MAX_NOTES = 15
const MAX_TASKS = 30
const MAX_PENDING = 20
const MAX_FEEDBACK = 30
const MAX_ITEMS = 12

// ── Types ────────────────────────────────────────────────────────────────

export type PlanItem = {
  title: string
  detail: string
  reasoning: string
  priority: 'high' | 'normal' | 'low'
  category: 'follow_up' | 'task' | 'message' | 'reminder' | 'decision' | 'other'
  source: string | null
}

export type DailyPlan = {
  id: string
  rep_id: string
  plan_date: string
  status: 'pending_review' | 'reviewed'
  intro: string | null
  items: PlanItem[]
  created_at: string
}

export type DailyPlanTickResult = {
  reps_checked: number
  plans_generated: number
  skipped_existing: number
  skipped_empty: number
  errors: number
}

type RepRow = {
  id: string
  display_name: string
  timezone: string | null
  is_active: boolean
  claude_api_key?: string | null
}

// ── Rep-local clock ──────────────────────────────────────────────────────

// Returns the rep's local calendar date (YYYY-MM-DD) and hour (0-23). Used both
// to decide "is it morning yet" and to key the one-plan-per-day row.
export function repLocalNow(tz: string): { date: string; hour: number } {
  const safeTz = tz || 'America/New_York'
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(new Date())
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const date = `${get('year')}-${get('month')}-${get('day')}`
    // Intl can emit '24' for midnight in some runtimes — normalize to 0.
    const rawHour = parseInt(get('hour'), 10)
    const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0
    return { date, hour }
  } catch {
    const d = new Date()
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() }
  }
}

// ── Top-level entry point ────────────────────────────────────────────────

export async function runDailyPlanTick(): Promise<DailyPlanTickResult> {
  const result: DailyPlanTickResult = {
    reps_checked: 0,
    plans_generated: 0,
    skipped_existing: 0,
    skipped_empty: 0,
    errors: 0,
  }

  const allow = plaudAgentEnabledReps()
  if (allow && allow.has('__off__')) return result

  let repQ = supabase
    .from('reps')
    .select('id, display_name, timezone, is_active, claude_api_key')
    .eq('is_active', true)
  if (allow) repQ = repQ.in('id', Array.from(allow))

  const { data, error } = await repQ
  if (error) {
    console.error('[daily-plan] rep fetch failed', error.message)
    return { ...result, errors: 1 }
  }

  const reps = (data ?? []) as RepRow[]
  for (const rep of reps) {
    result.reps_checked++
    try {
      const tz = rep.timezone || 'America/New_York'
      const { date, hour } = repLocalNow(tz)

      // Only generate once it's morning, rep-local.
      if (hour < PLAN_HOUR) continue

      // Idempotent: one plan per rep per day. The unique index is the backstop;
      // this check just saves the tokens.
      const { data: existing } = await supabase
        .from('plaud_daily_plans')
        .select('id')
        .eq('rep_id', rep.id)
        .eq('plan_date', date)
        .maybeSingle()
      if (existing) {
        result.skipped_existing++
        continue
      }

      const outcome = await generatePlanForRep(rep, date, tz)
      if (outcome === 'generated') result.plans_generated++
      else if (outcome === 'empty') result.skipped_empty++
    } catch (err) {
      result.errors++
      console.error('[daily-plan] rep failed', rep.id, err)
    }
  }

  return result
}

// ── Per-rep generation ───────────────────────────────────────────────────

async function generatePlanForRep(
  rep: RepRow,
  planDate: string,
  tz: string,
): Promise<'generated' | 'empty'> {
  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString()

  const [
    { data: noteRows },
    { data: taskRows },
    { data: pendingRows },
    { data: feedbackRows },
    { data: projectTaskRows },
    { data: deferredRows },
  ] =
    await Promise.all([
      // Recordings the per-note agent already triaged as worth acting on.
      supabase
        .from('plaud_notes')
        .select('id, title, summary, action_items, triage_class, occurred_at')
        .eq('rep_id', rep.id)
        .gte('occurred_at', sinceIso)
        .in('triage_class', ['action', 'executive', 'unclear'])
        .order('occurred_at', { ascending: false })
        .limit(MAX_NOTES),
      // Open tasks already on the brain queue (many created BY the agent).
      supabase
        .from('brain_items')
        .select('id, content, item_type, priority, horizon, due_date, created_at')
        .eq('rep_id', rep.id)
        .eq('status', 'open')
        .in('item_type', ['task', 'note'])
        .order('created_at', { ascending: false })
        .limit(MAX_TASKS),
      // People-touching actions still awaiting Spencer's approval.
      supabase
        .from('plaud_actions')
        .select('id, kind, payload, reasoning, target_email')
        .eq('rep_id', rep.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(MAX_PENDING),
      // Standing preferences: how Spencer reacted to past plans.
      supabase
        .from('plaud_plan_feedback')
        .select('verdict, reason, item_title')
        .eq('rep_id', rep.id)
        .order('created_at', { ascending: false })
        .limit(MAX_FEEDBACK),
      // Open project (PM) tasks — a separate surface the plan should still
      // weigh, so "today's plan" reflects everything owed, not just brain items.
      supabase
        .from('project_tasks')
        .select('id, title, status, time_estimate')
        .eq('rep_id', rep.id)
        .in('status', ['todo', 'in_progress', 'blocked'])
        .order('updated_at', { ascending: false })
        .limit(MAX_TASKS),
      // Open reminders / parked items due to resurface.
      supabase
        .from('deferred_items')
        .select('title, body, remind_at')
        .eq('rep_id', rep.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(MAX_TASKS),
    ])

  const notes = (noteRows ?? []) as Array<Record<string, unknown>>
  const tasks = (taskRows ?? []) as Array<Record<string, unknown>>
  const pending = (pendingRows ?? []) as Array<Record<string, unknown>>
  const feedback = (feedbackRows ?? []) as Array<{ verdict: string; reason: string | null; item_title: string | null }>
  const projectTasks = (projectTaskRows ?? []) as Array<Record<string, unknown>>
  const deferred = (deferredRows ?? []) as Array<Record<string, unknown>>

  // Nothing new and nothing open → no plan worth showing. Don't insert a row so
  // tomorrow's tick can still try (and the dashboard simply shows no card).
  if (
    notes.length === 0 &&
    tasks.length === 0 &&
    pending.length === 0 &&
    projectTasks.length === 0 &&
    deferred.length === 0
  ) {
    return 'empty'
  }

  // Unified learned guidance (shared with the per-note agent) — distilled rules
  // from dismissals/corrections, on top of the legacy plan-level 👍/👎 feedback.
  const guidance = await loadGuidance(rep.id, 'planner')
  const system = buildSystemPrompt(rep.display_name, feedback, renderGuidance(guidance))
  const userMessage = buildUserMessage(notes, tasks, pending, projectTasks, deferred)

  const res = await runWithClaudeKey(rep.claude_api_key, () =>
    getAnthropic().messages.create({
      model: MODEL_PLANNER,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  )

  const text = res.content.find((b) => b.type === 'text')
  const parsed = parsePlan(text && text.type === 'text' ? text.text : '')

  if (parsed.items.length === 0) return 'empty'

  // Insert. On a unique-violation race (two ticks generated at once), swallow it
  // — the other tick won.
  const { error } = await supabase.from('plaud_daily_plans').insert({
    rep_id: rep.id,
    plan_date: planDate,
    timezone: tz,
    status: 'pending_review',
    intro: parsed.intro,
    items: parsed.items,
    source_counts: {
      notes: notes.length,
      open_tasks: tasks.length,
      pending_actions: pending.length,
      project_tasks: projectTasks.length,
      reminders: deferred.length,
    },
    model: MODEL_PLANNER,
  })
  if (error) {
    // 23505 = unique_violation (raced). Anything else is a real failure.
    if ((error as { code?: string }).code === '23505') return 'empty'
    throw new Error(`plaud_daily_plans insert: ${error.message}`)
  }
  return 'generated'
}

// ── Prompt construction ──────────────────────────────────────────────────

function buildSystemPrompt(
  repName: string,
  feedback: Array<{ verdict: string; reason: string | null; item_title: string | null }>,
  guidanceBlock = '',
): string {
  const feedbackBlock = renderFeedback(feedback)
  return `You are ${repName}'s executive chief of staff. Each morning you read everything that happened — recorded meetings and calls, open tasks, and drafts waiting for approval — and produce ONE focused plan for the day: the highest-leverage things ${repName} should actually get done, in priority order, each with a short reason WHY it matters today.

Principles:
- Be decisive and specific. "Follow up with the Acme deal — they asked for pricing on yesterday's call" beats "do follow-ups".
- Prioritize ruthlessly. A great plan is 4-8 items, not a brain-dump of everything. Fold trivia together; drop noise.
- Lead with what's time-sensitive or what unblocks the most (commitments made on calls, deals that asked for a next step, drafts sitting in the approval queue).
- Every item needs a one-sentence "reasoning" explaining why it's on today's list — this is shown to ${repName} and is how the plan earns trust.
- Don't invent work. Only use what's in the material below. If something is thin, say less.
${feedbackBlock}${guidanceBlock}
Return ONLY a JSON object on a single line, no markdown fences, with this exact shape:
{"intro":"<one sentence framing the day>","items":[{"title":"<imperative, specific>","detail":"<1-2 sentences of what to do>","reasoning":"<why this matters today>","priority":"high|normal|low","category":"follow_up|task|message|reminder|decision|other","source":"<short label of which recording/task this came from, or null>"}]}
Max ${MAX_ITEMS} items. Order them the way ${repName} should work them.`
}

// Renders recent feedback as standing do/don't rules. This is the learning loop:
// the planner literally reads how Spencer reacted to past plans and adapts.
function renderFeedback(
  feedback: Array<{ verdict: string; reason: string | null; item_title: string | null }>,
): string {
  if (feedback.length === 0) return ''
  const liked: string[] = []
  const disliked: string[] = []
  for (const f of feedback) {
    const title = (f.item_title ?? '').trim()
    const reason = (f.reason ?? '').trim()
    const label = title
      ? reason ? `${title} — ${reason}` : title
      : reason
    if (!label) continue
    if (f.verdict === 'up') liked.push(label)
    else disliked.push(label)
  }
  if (liked.length === 0 && disliked.length === 0) return ''
  const lines: string[] = [
    `\nSTANDING FEEDBACK — how they reacted to past plans. Treat these as durable preferences and weight them heavily:`,
  ]
  if (disliked.length > 0) {
    lines.push('Avoid / they pushed back on:')
    for (const d of disliked.slice(0, 12)) lines.push(`  - ${d}`)
  }
  if (liked.length > 0) {
    lines.push('They valued:')
    for (const l of liked.slice(0, 8)) lines.push(`  - ${l}`)
  }
  return lines.join('\n') + '\n'
}

function buildUserMessage(
  notes: Array<Record<string, unknown>>,
  tasks: Array<Record<string, unknown>>,
  pending: Array<Record<string, unknown>>,
  projectTasks: Array<Record<string, unknown>>,
  deferred: Array<Record<string, unknown>>,
): string {
  const blocks: string[] = []

  if (notes.length > 0) {
    const lines = notes.map((n) => {
      const title = String(n.title ?? 'Recording')
      const cls = String(n.triage_class ?? '')
      const summary = typeof n.summary === 'string' && n.summary.trim() ? n.summary.trim() : ''
      const items = Array.isArray(n.action_items) ? (n.action_items as string[]) : []
      const itemsLine = items.length > 0 ? `\n    action items: ${items.slice(0, 8).join('; ')}` : ''
      const summaryLine = summary ? `\n    summary: ${summary.slice(0, 600)}` : ''
      return `  • [${cls}] ${title}${summaryLine}${itemsLine}`
    })
    blocks.push(`RECENT RECORDINGS (already triaged by the per-note agent):\n${lines.join('\n')}`)
  }

  if (pending.length > 0) {
    const lines = pending.map((a) => {
      const kind = String(a.kind ?? '')
      const reason = typeof a.reasoning === 'string' && a.reasoning.trim() ? a.reasoning.trim() : ''
      const to = typeof a.target_email === 'string' ? a.target_email : ''
      const payload = (a.payload ?? {}) as Record<string, unknown>
      const subj = typeof payload.subject === 'string' ? payload.subject : ''
      const label = [kind, to && `→ ${to}`, subj && `"${subj}"`].filter(Boolean).join(' ')
      return `  • ${label}${reason ? ` — ${reason}` : ''}`
    })
    blocks.push(`DRAFTS AWAITING APPROVAL (the agent prepared these; they need a decision):\n${lines.join('\n')}`)
  }

  if (tasks.length > 0) {
    const lines = tasks.map((t) => {
      const content = String(t.content ?? '')
      const pr = String(t.priority ?? 'normal')
      const due = typeof t.due_date === 'string' && t.due_date ? ` (due ${t.due_date})` : ''
      const prTag = pr === 'high' ? '[HIGH] ' : ''
      return `  • ${prTag}${content}${due}`
    })
    blocks.push(`OPEN TASKS ON THE QUEUE:\n${lines.join('\n')}`)
  }

  if (projectTasks.length > 0) {
    const lines = projectTasks.map((t) => {
      const title = String(t.title ?? '')
      const status = String(t.status ?? 'todo')
      const est = typeof t.time_estimate === 'string' && t.time_estimate ? ` · ${t.time_estimate}` : ''
      const statusTag = status === 'in_progress' ? ' [in progress]' : status === 'blocked' ? ' [blocked]' : ''
      return `  • ${title}${statusTag}${est}`
    })
    blocks.push(`OPEN PROJECT TASKS:\n${lines.join('\n')}`)
  }

  if (deferred.length > 0) {
    const lines = deferred.map((d) => {
      const title = String(d.title ?? '')
      const when = typeof d.remind_at === 'string' && d.remind_at ? ` (remind ${d.remind_at.slice(0, 10)})` : ''
      return `  • ${title}${when}`
    })
    blocks.push(`OPEN REMINDERS:\n${lines.join('\n')}`)
  }

  return blocks.join('\n\n')
}

// ── Parsing ──────────────────────────────────────────────────────────────

const VALID_PRIORITY = new Set(['high', 'normal', 'low'])
const VALID_CATEGORY = new Set(['follow_up', 'task', 'message', 'reminder', 'decision', 'other'])

export function parsePlan(text: string): { intro: string | null; items: PlanItem[] } {
  const fallback = { intro: null, items: [] as PlanItem[] }
  // Grab the outermost JSON object.
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  let raw: unknown
  try {
    raw = JSON.parse(match[0])
  } catch {
    return fallback
  }
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>
  const intro = typeof obj.intro === 'string' && obj.intro.trim() ? obj.intro.trim() : null
  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const items: PlanItem[] = []
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) continue
    const priorityRaw = String(o.priority ?? 'normal').toLowerCase()
    const categoryRaw = String(o.category ?? 'other').toLowerCase()
    items.push({
      title,
      detail: typeof o.detail === 'string' ? o.detail.trim() : '',
      reasoning: typeof o.reasoning === 'string' ? o.reasoning.trim() : '',
      priority: (VALID_PRIORITY.has(priorityRaw) ? priorityRaw : 'normal') as PlanItem['priority'],
      category: (VALID_CATEGORY.has(categoryRaw) ? categoryRaw : 'other') as PlanItem['category'],
      source: typeof o.source === 'string' && o.source.trim() ? o.source.trim() : null,
    })
    if (items.length >= MAX_ITEMS) break
  }
  return { intro, items }
}

// ── Dashboard reader ─────────────────────────────────────────────────────

// Loads today's plan (rep-local) for the Command Center card. Returns null when
// no plan was generated for today — the card simply doesn't render.
export async function loadTodaysPlan(repId: string, tz: string): Promise<DailyPlan | null> {
  const { date } = repLocalNow(tz)
  const { data } = await supabase
    .from('plaud_daily_plans')
    .select('id, rep_id, plan_date, status, intro, items, created_at')
    .eq('rep_id', repId)
    .eq('plan_date', date)
    .maybeSingle()
  if (!data) return null
  const row = data as Record<string, unknown>
  return {
    id: String(row.id),
    rep_id: String(row.rep_id),
    plan_date: String(row.plan_date),
    status: (row.status as DailyPlan['status']) ?? 'pending_review',
    intro: (row.intro as string | null) ?? null,
    items: Array.isArray(row.items) ? (row.items as PlanItem[]) : [],
    created_at: String(row.created_at),
  }
}

// Existing feedback for a plan, keyed by item index ('plan' for plan-level), so
// the card can show which items Spencer already rated.
export async function loadPlanFeedback(
  planId: string,
): Promise<Record<string, 'up' | 'down'>> {
  const { data } = await supabase
    .from('plaud_plan_feedback')
    .select('item_index, verdict, created_at')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })
  const map: Record<string, 'up' | 'down'> = {}
  for (const r of (data ?? []) as Array<{ item_index: number | null; verdict: 'up' | 'down' }>) {
    const key = r.item_index === null ? 'plan' : String(r.item_index)
    map[key] = r.verdict // last write wins (ordered asc)
  }
  return map
}
