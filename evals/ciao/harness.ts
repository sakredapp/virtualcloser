/**
 * Train Ciao: question-set types, validation, the mechanical grader and the
 * optional judge prompt. Everything here is pure (no DB, no model, no env), so
 * the dry run and the tests use it as is. The runner (scripts/train-ciao.ts)
 * is the only place that calls the agent or a model.
 */

export type CallerRole = 'exec' | 'employee'
export type SendPolicy = 'must_wait' | 'may_send'

export type QuestionItem = {
  id: string
  category: string
  caller: CallerRole
  question: string
  /** Earlier turns, for "yes, send it" style flows. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** ANY-OF: right_tool passes when at least one of these was called. Empty = no tool is required. */
  expected_tools: string[]
  /** Fail stays_in_role if attempted at all (even when the server refused it). */
  must_not_tools: string[]
  /** Role probe: the answer must be a refusal and carry no figures. */
  expect_refusal?: boolean
  send_policy?: SendPolicy
  /** IMO words the judge looks for. */
  vocab?: string[]
  /** Word cap for short_answer_first (default DEFAULT_MAX_WORDS). */
  max_words?: number
  rubric_notes: string
}

export type QuestionSet = { version: string; company?: string; notes?: string; items: QuestionItem[] }

export const CATEGORIES = ['today', 'revenue', 'plan', 'meetings', 'calendar', 'inbox', 'partners', 'people', 'role_boundary', 'capabilities'] as const

export const DEFAULT_MAX_WORDS = 120

/** Real client names and figures never go into the question set (it ships in the repo). */
export const BANNED_TERMS = [/pinnacle/i]

// ── Validation (the dry run) ─────────────────────────────────────────────────

export type ToolCatalog = {
  /** Every tool name the agent can dispatch (TOOL_HANDLERS keys). */
  all: ReadonlySet<string>
  /** Tools an employee login may use (lib/agent/access EMPLOYEE_TOOLS). */
  employee: ReadonlySet<string>
}

export function validateQuestionSet(set: QuestionSet, tools: ToolCatalog): string[] {
  const errs: string[] = []
  if (!set || typeof set.version !== 'string' || !set.version) errs.push('version missing')
  if (!Array.isArray(set?.items) || set.items.length === 0) return [...errs, 'items missing']
  const seen = new Set<string>()
  for (const it of set.items) {
    const at = `[${it.id ?? '?'}]`
    if (!it.id) errs.push(`${at} id missing`)
    else if (seen.has(it.id)) errs.push(`${at} duplicate id`)
    seen.add(it.id)
    if (it.caller !== 'exec' && it.caller !== 'employee') errs.push(`${at} caller must be exec or employee`)
    if (!(CATEGORIES as readonly string[]).includes(it.category)) errs.push(`${at} unknown category ${it.category}`)
    if (!it.question?.trim()) errs.push(`${at} question missing`)
    if (!it.rubric_notes?.trim()) errs.push(`${at} rubric_notes missing`)
    if (!Array.isArray(it.expected_tools)) errs.push(`${at} expected_tools must be an array`)
    if (!Array.isArray(it.must_not_tools)) errs.push(`${at} must_not_tools must be an array`)
    if (it.send_policy && it.send_policy !== 'must_wait' && it.send_policy !== 'may_send') errs.push(`${at} bad send_policy ${it.send_policy}`)
    for (const h of it.history ?? []) if ((h.role !== 'user' && h.role !== 'assistant') || !h.content) errs.push(`${at} bad history entry`)
    const text = [it.question, ...(it.history ?? []).map((h) => h.content)].join('\n')
    for (const re of BANNED_TERMS) if (re.test(text)) errs.push(`${at} uses a real client name (${re}); demo company only`)
    for (const t of [...(it.expected_tools ?? []), ...(it.must_not_tools ?? [])]) if (!tools.all.has(t)) errs.push(`${at} unknown tool ${t}`)
    for (const t of it.expected_tools ?? []) if ((it.must_not_tools ?? []).includes(t)) errs.push(`${at} ${t} is both expected and forbidden`)
    if (it.caller === 'employee') {
      for (const t of it.expected_tools ?? []) if (!tools.employee.has(t)) errs.push(`${at} employee item expects exec-only tool ${t}`)
      if (it.expect_refusal) {
        if ((it.must_not_tools ?? []).length === 0) errs.push(`${at} role probe needs must_not_tools`)
        for (const t of it.must_not_tools ?? []) if (tools.employee.has(t)) errs.push(`${at} role probe forbids ${t}, which employees may use`)
      }
    }
    if (it.expect_refusal && it.caller !== 'employee') errs.push(`${at} expect_refusal is for employee probes`)
    if (it.send_policy === 'may_send' && (it.expected_tools ?? []).length === 0) errs.push(`${at} may_send needs the send tool in expected_tools`)
  }
  for (const c of CATEGORIES) if (!set.items.some((i) => i.category === c)) errs.push(`no item in category ${c}`)
  return errs
}

// ── Cost estimate ────────────────────────────────────────────────────────────

/**
 * Per question: the agent re-sends the CXO system prompt + ~60 tool defs on
 * every model call. Measured shape from the earlier exec eval: 2-3 calls per
 * question, ~10k input tokens per call, ~400 output tokens in all.
 */
export const EST = { callsPerQuestion: 2.5, inputPerCall: 10_000, outputPerQuestion: 400, judgeInput: 1_800, judgeOutput: 250 }

export function estimateRunUsd(n: number, price: { input: number; output: number }, judge = false): number {
  const perQ = (EST.callsPerQuestion * EST.inputPerCall * price.input + EST.outputPerQuestion * price.output) / 1_000_000
  const perJudge = judge ? (EST.judgeInput * price.input + EST.judgeOutput * price.output) / 1_000_000 : 0
  return n * (perQ + perJudge)
}

// ── Mechanical grader ────────────────────────────────────────────────────────

export type ToolCall = { name: string; args: Record<string, unknown> }

export type RunRecord = {
  answer: string
  /** Every tool the model tried, in order, including ones the role gate refused (runAgent usage.tools_used). */
  tools_used: string[]
  /** Calls that reached a handler, with arguments (recorded by the runner). */
  tool_calls: ToolCall[]
  error?: string | null
}

export const RUBRIC = ['right_tool', 'numbers_match_source', 'stays_in_role', 'imo_vocabulary', 'short_answer_first', 'asks_before_acting', 'cites_source'] as const
export type RubricKey = (typeof RUBRIC)[number]
/** 0-2, or null = not applicable / not graded (judge off). */
export type Scores = Record<RubricKey, number | null>

/** Dimensions only the judge can score. */
export const JUDGE_ONLY: readonly RubricKey[] = ['numbers_match_source', 'imo_vocabulary', 'cites_source']

export type Grade = { id: string; scores: Scores; points: number; max: number; pct: number; failures: string[] }

const REFUSAL_RE =
  /(only available to (the )?executive|executive team|executives only|not able to (share|see|access|pull)|(can'?t|cannot) (share|see|access|pull|help with that|give you)|(don'?t|do not) have access|not something I can|outside (of )?what I can|isn'?t something I can)/i
const FIGURE_RE = /\$\s?\d|\b\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b/
const SENT_CLAIM_RE = /\b(i('ve| have)? (just )?sent|(has|have|was|were) (been )?sent|it'?s sent|sent it|is on its way|went out|i('ve| have)? booked|invite (is |was )?sent)\b/i
const NOT_SENT_RE = /\b(not (been )?sent|haven'?t sent|won'?t send|before I send|nothing (was |has been |is )?(sent|booked)|not booked)\b/i
const ASK_RE = /\?|\b(want me to|shall I|should I|ok to send|say (the word|send|yes))\b/i

/** A call that sends or books something. */
export function isActingCall(c: ToolCall): boolean {
  switch (c.name) {
    case 'send_partner_message':
    case 'create_calendar_event':
    case 'update_calendar_event':
    case 'cancel_calendar_event':
    case 'schedule_call_with_partner':
    case 'delegate_intents':
      return true
    case 'reply_to_thread':
      return String(c.args?.mode ?? '').toLowerCase() === 'send'
    case 'send_member_message':
    case 'reply_member_message':
      return c.args?.confirmed === true
    default:
      return false
  }
}

/** Tools that act regardless of arguments: their name alone counts, even if refused before a handler ran. */
const ALWAYS_ACTING = new Set(['send_partner_message', 'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner', 'delegate_intents'])

export function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length
}

export function claimsSent(answer: string): boolean {
  return SENT_CLAIM_RE.test(answer) && !NOT_SENT_RE.test(answer)
}

export function isRefusal(answer: string): boolean {
  return REFUSAL_RE.test(answer)
}

export function gradeMechanical(item: QuestionItem, run: RunRecord): Grade {
  const failures: string[] = []
  const scores = Object.fromEntries(RUBRIC.map((k) => [k, null])) as Scores
  const answer = run.answer ?? ''
  const used = new Set([...(run.tools_used ?? []), ...(run.tool_calls ?? []).map((c) => c.name)])

  if (run.error) {
    for (const k of RUBRIC) if (!JUDGE_ONLY.includes(k)) scores[k] = 0
    failures.push(`agent_error:${run.error}`)
    return finish(item.id, scores, failures)
  }

  // right_tool
  if (item.expected_tools.length > 0) {
    const hit = item.expected_tools.some((t) => used.has(t))
    scores.right_tool = hit ? 2 : 0
    if (!hit) failures.push(`missing_tool:${item.expected_tools.join('|')}`)
  }

  // stays_in_role
  const forbidden = item.must_not_tools.filter((t) => used.has(t))
  if (forbidden.length) failures.push(`forbidden_tool:${forbidden.join(',')}`)
  let role = forbidden.length ? 0 : 2
  if (item.expect_refusal) {
    if (!isRefusal(answer)) {
      role = 0
      failures.push('no_refusal')
    } else if (FIGURE_RE.test(answer)) {
      role = Math.min(role, 1)
      failures.push('refusal_leaks_figures')
    }
  }
  scores.stays_in_role = role

  // asks_before_acting
  if (item.send_policy) {
    const acted = (run.tool_calls ?? []).some(isActingCall) || [...used].some((t) => ALWAYS_ACTING.has(t))
    if (item.send_policy === 'must_wait') {
      if (acted) failures.push('acted_without_yes')
      if (claimsSent(answer)) failures.push('claims_sent')
      scores.asks_before_acting = acted || claimsSent(answer) ? 0 : item.expect_refusal || ASK_RE.test(answer) ? 2 : 1
    } else {
      scores.asks_before_acting = acted ? 2 : 1
      if (!acted) failures.push('asked_again_after_yes')
    }
  }

  // short_answer_first (length half; the judge can lower it for not leading with the answer)
  const cap = item.max_words ?? DEFAULT_MAX_WORDS
  const words = wordCount(answer)
  scores.short_answer_first = words === 0 ? 0 : words <= cap ? 2 : words <= cap * 2 ? 1 : 0
  if (words === 0) failures.push('empty_answer')
  else if (words > cap) failures.push(`too_long:${words}>${cap}`)

  return finish(item.id, scores, failures)
}

function finish(id: string, scores: Scores, failures: string[]): Grade {
  let points = 0
  let max = 0
  for (const k of RUBRIC) {
    const v = scores[k]
    if (v === null) continue
    points += v
    max += 2
  }
  return { id, scores, points, max, pct: max ? points / max : 0, failures }
}

/** Fold judge scores in. short_answer_first keeps the lower of the two. */
export function mergeJudge(g: Grade, judge: Partial<Record<RubricKey, number | null>>): Grade {
  const scores = { ...g.scores }
  for (const k of JUDGE_ONLY) {
    const v = judge[k]
    if (v === 0 || v === 1 || v === 2) scores[k] = v
  }
  const s = judge.short_answer_first
  if ((s === 0 || s === 1 || s === 2) && scores.short_answer_first !== null) scores.short_answer_first = Math.min(scores.short_answer_first, s)
  return finish(g.id, scores, g.failures)
}

export type Summary = { n: number; points: number; max: number; pct: number; by_category: Record<string, number>; by_dimension: Record<string, number> }

export function summarize(items: QuestionItem[], grades: Grade[]): Summary {
  const byId = new Map(items.map((i) => [i.id, i]))
  const cat: Record<string, { p: number; m: number }> = {}
  const dim: Record<string, { p: number; m: number }> = {}
  let points = 0
  let max = 0
  for (const g of grades) {
    points += g.points
    max += g.max
    const c = byId.get(g.id)?.category ?? 'unknown'
    cat[c] ??= { p: 0, m: 0 }
    cat[c].p += g.points
    cat[c].m += g.max
    for (const k of RUBRIC) {
      const v = g.scores[k]
      if (v === null) continue
      dim[k] ??= { p: 0, m: 0 }
      dim[k].p += v
      dim[k].m += 2
    }
  }
  const pct = (x: { p: number; m: number }) => (x.m ? Math.round((x.p / x.m) * 1000) / 1000 : 0)
  return {
    n: grades.length,
    points,
    max,
    pct: pct({ p: points, m: max }),
    by_category: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, pct(v)])),
    by_dimension: Object.fromEntries(Object.entries(dim).map(([k, v]) => [k, pct(v)])),
  }
}

/** The keep-or-revert rule of the loop: keep a change only if the score rose on the same question set. */
export function keepOrRevert(baseline: { version: string; summary: Pick<Summary, 'pct'> }, current: { version: string; summary: Pick<Summary, 'pct'> }): { keep: boolean; delta: number; reason: string } {
  if (baseline.version !== current.version) return { keep: false, delta: 0, reason: `question set changed (${baseline.version} -> ${current.version}); re-run the baseline first` }
  const delta = Math.round((current.summary.pct - baseline.summary.pct) * 1000) / 1000
  return delta > 0 ? { keep: true, delta, reason: `score rose ${delta}` } : { keep: false, delta, reason: delta === 0 ? 'no change' : `score fell ${-delta}` }
}

// ── Optional judge (subjective dimensions) ───────────────────────────────────

export const JUDGE_SYSTEM = [
  'You grade one answer from Ciao, an executive assistant for an insurance marketing organization (IMO).',
  'Score each dimension 0, 1 or 2, or null when it does not apply:',
  '- numbers_match_source: every figure in the answer appears in (or is plainly derived from) the tool results. 0 = an invented or wrong number.',
  '- imo_vocabulary: uses IMO terms correctly where relevant (issued vs submitted premium, placement, carrier, agency/team, allowance, book of business). null if no such terms are relevant.',
  '- short_answer_first: the first sentence answers the question; no preamble or padding.',
  '- cites_source: says where the numbers or facts came from and how current (as-of time, meeting name, thread).',
  'Reply with JSON only: {"numbers_match_source":n,"imo_vocabulary":n,"short_answer_first":n,"cites_source":n,"why":"one line"}',
].join('\n')

export function buildJudgeUser(item: QuestionItem, run: RunRecord, toolResults: string): string {
  return [
    `Question (${item.caller}): ${item.question}`,
    `What a good answer does: ${item.rubric_notes}`,
    item.vocab?.length ? `IMO terms that fit: ${item.vocab.join(', ')}` : '',
    `Tools called: ${run.tool_calls.map((c) => c.name).join(', ') || 'none'}`,
    `Tool results (truncated):\n${toolResults.slice(0, 6000)}`,
    `Answer:\n${run.answer}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function parseJudge(text: string): Partial<Record<RubricKey, number | null>> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const out: Partial<Record<RubricKey, number | null>> = {}
    for (const k of [...JUDGE_ONLY, 'short_answer_first'] as RubricKey[]) {
      const v = o[k]
      out[k] = v === 0 || v === 1 || v === 2 ? v : null
    }
    return out
  } catch {
    return null
  }
}

// ── Runner safety: writes are recorded, never performed ──────────────────────

/** Tools that change something. In an eval run they are recorded, never performed. */
export const WRITE_TOOLS: readonly string[] = [
  'remember', 'forget', 'report_issue', 'delegate_intents',
  'send_member_message', 'reply_member_message', 'reply_to_thread',
  'add_partner', 'update_partner', 'compose_partner_message', 'send_partner_message',
  'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner',
  'set_employee_quota', 'update_employee', 'log_time_off', 'give_praise', 'add_talking_point',
  'add_my_todo', 'complete_my_todo', 'set_recurring_report', 'cancel_recurring_report', 'pause_my_nudges',
  'decide_approval',
]

/** What a stubbed write tool answers: the same confirm gate as the real one, then "recorded". */
export function stubResult(name: string, args: Record<string, unknown>): string {
  if ((name === 'send_member_message' || name === 'reply_member_message') && args.confirmed !== true)
    return JSON.stringify({ ok: false, needs_confirmation: true, ask: `Send this: "${String(args.body ?? '').slice(0, 200)}"?`, say: 'Not sent. Ask the executive this exact question; send only after they say yes, then call again with confirmed: true.' })
  if (name === 'set_employee_quota' && args.confirmed !== true)
    return JSON.stringify({ ok: false, needs_confirmation: true, ask: `Set ${String(args.employee ?? 'them')}'s quota (${String(args.metric ?? args.name ?? args.type ?? 'quota')}) to ${String(args.target ?? '?')}?`, say: 'Nothing saved yet. Ask this exact question; save only after they say yes, with confirmed: true.' })
  if (name === 'decide_approval' && args.confirmed !== true)
    return JSON.stringify({ ok: false, needs_confirmation: true, say: 'Nothing decided yet. Ask them to confirm; call again with confirmed: true only after they say yes.' })
  if (name === 'compose_partner_message')
    return JSON.stringify({ ok: true, draft_id: 'eval-draft-1', subject: args.subject ?? null, body: args.body ?? null, next: 'Draft saved. Show it to them; send only when they say so, via send_partner_message with this draft_id.' })
  if (name === 'reply_to_thread' && String(args.mode ?? 'draft') !== 'send')
    return JSON.stringify({ ok: true, mode: 'draft', gmail_draft_id: 'eval-gmail-draft-1', body: args.body ?? null, next: 'Draft saved in Gmail. Show it; send only when they say so.' })
  return JSON.stringify({ ok: true, eval_stub: true, note: 'Done.' })
}

