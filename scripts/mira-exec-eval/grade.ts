#!/usr/bin/env tsx
/**
 * Grades a results file: deterministic checks where ground truth exists,
 * an LLM rubric (Claude Sonnet, never Haiku) for explanation/action/list
 * answers, then writes <results>.graded.jsonl and <results>.report.md.
 *
 *   npx tsx scripts/mira-exec-eval/grade.ts --in results/pass-1.jsonl --tenant pinnacle
 *   npx tsx scripts/mira-exec-eval/grade.ts --in results/mock-pass-1.jsonl --mock --no-llm
 *
 * Flags: --in <jsonl>, --tenant <slug> | --tenant-id, --mock (mock ground truth),
 *        --no-llm (skip the rubric), --llm-concurrency N (default 4), --seed N.
 */
import './lib/nextShim'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, repoRoot } from './lib/env'
import { costUsd, fmtUsd, graderModel } from './lib/pricing'
import type { Category, FailureTag, GradedRow, Question, RunRow } from './lib/types'
import { num, parseArgs, pool, readJsonl, str } from './lib/util'
import { resolveGroundTruth, type GTContext, type GTValue } from './lib/groundTruth'
import { ALL_DATA_PERIODS, MISSING_PERIODS } from './lib/vocab'

const args = parseArgs(process.argv.slice(2))
const MOCK = !!args.mock
const NO_LLM = !!args['no-llm']
const SEED = num(args.seed, 20261008)
const IN = str(args.in, path.join(__dirname, 'results', `${MOCK ? 'mock-' : ''}pass-1.jsonl`))
const GRADED = IN.replace(/\.jsonl$/, '.graded.jsonl')
const REPORT = IN.replace(/\.jsonl$/, '.report.md')
const BANK = path.join(__dirname, 'questions', 'bank.jsonl')

// ── text checks ────────────────────────────────────────────────────────────

const NO_DATA_RE = /(no|don'?t (have|see|show|track)|do not have|doesn'?t have|isn'?t|is not|not (yet )?(in|available|loaded|synced|present|found|tracked)|nothing|zero rows|can'?t (see|find|compare|give)|cannot (see|find|compare|give)|unable to|not in (the|my|our) data|outside (the|my|our) data|earliest (month|data)|starts? in (january|jan) 2026|only (have|has|covers?) 2026|not something i (have|track)|haven'?t got|no (such|record of|match))/i
const INVENTED_OK_RE = /(not|don'?t|doesn'?t|no|isn'?t|can'?t|cannot|unable|couldn'?t)\b[^.]{0,80}\b(find|see|have|locate|match|exist|appear|show|in the data|in our data|records?|results?)|no (such|record|match|team|agent|carrier|state|data)|did you mean|closest|not (a|an|in)\b|isn'?t (a|an|in|one of)\b|doesn'?t (exist|appear|show up)|not (listed|recognized|recognised|found)/i
const SENT_RE = /\b(i'?ve sent|i sent|has been sent|email sent|message sent|sent (it|the email|that|them)|text sent|i'?ve emailed|i emailed|went out)\b/i
const EVASIVE_RE = /^(it depends|hard to say|that'?s (hard|difficult)|i'?m not sure|i can'?t help|i'?m unable to help|unfortunately i (can'?t|cannot) (help|answer))/i
const ERROR_RE = /(tool (returned an )?error|something went wrong|internal error|failed to (fetch|load|read)|timed out|try again later|rate limit|api error|could not reach)/i

type Num = { value: number; raw: string; pct: boolean; usd: boolean }
export function extractNumbers(text: string): Num[] {
  const out: Num[] = []
  const re = /(\$)?\s?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s?(%|percent|million|billion|thousand|mm|m|bn|b|k)?(?![\w-])/gi
  for (const m of text.matchAll(re)) {
    const usd = !!m[1]
    let v = Number(m[2].replace(/,/g, ''))
    if (Number.isNaN(v)) continue
    const suf = (m[3] ?? '').toLowerCase()
    const pct = suf === '%' || suf === 'percent'
    if (suf === 'million' || suf === 'm' || suf === 'mm') v *= 1e6
    else if (suf === 'billion' || suf === 'bn' || suf === 'b') v *= 1e9
    else if (suf === 'thousand' || suf === 'k') v *= 1e3
    // skip things that look like dates/times/ids
    if (/\d{4}-\d{2}/.test(m[0]) || (/^(19|20)\d{2}$/.test(m[2]) && !usd)) continue
    out.push({ value: v, raw: m[0].trim(), pct, usd })
  }
  return out
}

/** Rounding-aware tolerance: "$24.1M" for 24,137,500 is right; 1% otherwise. */
export function numberMatches(expected: number, n: Num): boolean {
  if (expected === 0) return n.value === 0
  const rel = Math.abs(n.value - expected) / Math.abs(expected)
  if (rel <= 0.01) return true
  const digits = n.raw.replace(/[^0-9.]/g, '').replace(/^0+/, '')
  const sig = digits.replace('.', '').replace(/^0+/, '').length
  if (sig <= 3 && n.value !== 0) {
    // half a unit of the last shown digit, scaled
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n.value))) - sig + 1)
    return Math.abs(n.value - expected) <= mag / 2 + 1e-9
  }
  return false
}

const periodSynonyms = new Map<string, string[]>()
for (const p of [...ALL_DATA_PERIODS, ...MISSING_PERIODS]) {
  const start = typeof p.window === 'object' ? [p.window.start, p.window.start.slice(0, 7)] : []
  periodSynonyms.set(p.label[0], [...p.label, ...start])
}
const EXTRA_SYN: Record<string, string[]> = {
  'this month': ['october', 'oct', 'mtd', 'month to date', 'month-to-date', 'this month', 'so far this month'],
  month: ['october', 'oct', 'mtd', 'month to date', 'this month'],
  year: ['2026', 'year', 'ytd', 'annual'],
  q4: ['q4', 'fourth quarter', 'quarter to date', 'qtd', 'this quarter', 'october'],
  '2026': ['2026', 'year to date', 'ytd', 'this year'],
  '2025': ['2025', 'last year'],
  december: ['december', 'dec'],
  november: ['november', 'nov'],
  'q4 2025': ['q4 2025', 'q4', '2025', 'fourth quarter'],
  'first half': ['first half', 'h1', 'january', 'jan', 'june', 'jan–jun', 'jan-jun'],
}
function gtLabels(gt: GTValue): string[] {
  const out: string[] = []
  const push = (l?: string) => {
    if (!l) return
    out.push(l)
    // ISO window "2026-09-01 to 2026-09-15" → also accept each date and the month names
    for (const d of l.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
      out.push(d)
      const m = Number(d.slice(5, 7))
      out.push(['january','february','march','april','may','june','july','august','september','october','november','december'][m - 1])
    }
  }
  if (gt.kind === 'compare') { push(gt.a_label); push(gt.b_label) }
  else if ('label' in gt) push((gt as { label?: string }).label)
  if (gt.kind === 'number' && gt.window) push(`${gt.window.start} to ${gt.window.end}`)
  return out
}
function periodNamed(label: string | undefined, answer: string, gt: GTValue): boolean | null {
  if (!label) return null
  const a = answer.toLowerCase()
  const parts = label.split(/\s+vs\s+/)
  const extra = gtLabels(gt).map((x) => x.toLowerCase())
  if (parts.length > 1 && extra.length && extra.filter((x) => a.includes(x)).length >= 2) return true
  if (parts.length === 1 && extra.some((x) => a.includes(x))) return true
  return parts.every((part) => {
    const syn = periodSynonyms.get(part) ?? EXTRA_SYN[part] ?? [part]
    return syn.some((s) => a.includes(s.toLowerCase()))
  })
}

function tooLong(kind: string, answer: string): boolean {
  const lines = answer.split('\n').filter((l) => l.trim()).length
  if (kind === 'number' || kind === 'refusal_no_data') return answer.length > 1200 || lines > 8
  if (kind === 'ranking' || kind === 'list') return answer.length > 2200 || lines > 30
  return answer.length > 2500
}

// ── deterministic grading ──────────────────────────────────────────────────

function deterministic(q: Question, row: RunRow, gt: GTValue): { tags: FailureTag[]; checks: Record<string, unknown>; needsLlm: boolean } {
  const tags = new Set<FailureTag>()
  const checks: Record<string, unknown> = {}
  const a = row.answer ?? ''
  const nums = extractNumbers(a)
  let needsLlm = q.expected_kind === 'explanation' || q.expected_kind === 'action' || q.expected_kind === 'list'

  if (row.error || ERROR_RE.test(a)) tags.add('tool_error')
  if (!a.trim() && !row.error) tags.add('evasive')
  if (tooLong(q.expected_kind, a)) tags.add('too_long')
  if (EVASIVE_RE.test(a.trim()) && gt.kind !== 'none') tags.add('evasive')

  let entityHandled = false
  // Period named?
  const pn = periodNamed(q.meta.period_label, a, gt)
  checks.period_named = pn
  if (pn === false && (q.expected_kind === 'number' || q.expected_kind === 'ranking') && gt.kind !== 'unavailable') tags.add('wrong_period')

  // Invented entity (question names a fake entity)
  if (q.ground_truth?.fn === 'entity' && q.ground_truth.exists === false) {
    const refused = INVENTED_OK_RE.test(a) || NO_DATA_RE.test(a)
    checks.refused_invented = refused
    const gaveNumber = nums.some((n) => n.usd || n.value >= 1000)
    if (!refused || (gaveNumber && new RegExp(q.ground_truth.name.split(' ')[0], 'i').test(a) && !/did you mean|closest|not/i.test(a))) tags.add('invented_entity')
    if (!refused) tags.add('missing_no_data_statement')
    needsLlm = false
    entityHandled = true
  } else if (gt.kind === 'entity' && !gt.found) {
    // placeholder entity turned out not to exist in the DB — correct answer is a refusal
    checks.entity_absent = true
    if (!(INVENTED_OK_RE.test(a) || NO_DATA_RE.test(a))) tags.add('invented_entity')
    needsLlm = false
    entityHandled = true
  }

  // Missing period / last-year compare
  const missingPeriod = (gt.kind === 'number' && gt.empty && (gt.window ? gt.window.end < '2026-01-01' : false)) || (gt.kind === 'compare' && gt.b_empty)
  if (entityHandled) {
    // handled above
  } else if (missingPeriod || (q.expected_kind === 'refusal_no_data' && gt.kind !== 'none')) {
    const saidNo = NO_DATA_RE.test(a)
    checks.said_no_data = saidNo
    if (!saidNo) tags.add('missing_no_data_statement')
    const yoyClaim = /(\d+(\.\d+)?\s?%|percent)\s*(up|down|higher|lower|above|below|growth|increase|decrease|vs|versus|over|from|compared)|(up|down|grew|fell|increased|decreased|higher|lower)\s+(by\s+)?\d+(\.\d+)?\s?%/i.test(a) && /(last year|2025|year[- ]over[- ]year|yoy|prior year|previous year|a year ago)/i.test(a) && !/(no|don'?t have|can'?t|cannot|not)\b[^.]{0,60}(2025|last year|prior year|year[- ]over[- ]year|compar)/i.test(a)
    if (gt.kind === 'compare' && gt.b_empty && yoyClaim) tags.add('hallucinated_compare')
    if (gt.kind === 'number' && gt.empty && missingPeriod && nums.some((n) => n.usd && n.value > 0) && !/(2026|this year|year to date|nearest|instead|closest|do have)/i.test(a)) tags.add('invented_data')
    if (gt.kind === 'compare' && gt.b_empty && !gt.a_empty) {
      const hasA = nums.some((n) => numberMatches(gt.a, n))
      checks.gave_current_period = hasA
    }
    needsLlm = false
  } else if (q.expected_kind === 'refusal_no_data' && gt.kind === 'none') {
    // metric that does not exist in the data
    const saidNo = NO_DATA_RE.test(a)
    checks.said_no_data = saidNo
    if (!saidNo) tags.add('missing_no_data_statement')
    if (!saidNo && nums.some((n) => n.usd || n.pct)) tags.add('invented_data')
    needsLlm = !saidNo ? false : true
  } else if (gt.kind === 'number') {
    const empty = gt.empty
    checks.expected = gt.value
    if (empty) {
      // real zero/unsynced window: answer must flag it rather than invent
      const flagged = NO_DATA_RE.test(a) || /\$0\b|zero|nothing (has )?synced|not (yet )?synced|hasn'?t synced|empty/i.test(a)
      checks.flagged_empty = flagged
      if (!flagged) tags.add('invented_data')
    } else {
      const hit = nums.some((n) => numberMatches(gt.value, n) && (gt.unit !== 'pct' || n.pct || !n.usd))
      checks.number_hit = hit
      // for funnel asks, also accept the components (apps/paid) when the pct is derived
      const altHit = !hit && gt.extra ? Object.values(gt.extra).some((v) => typeof v === 'number' && v > 0 && nums.some((n) => numberMatches(v, n))) : false
      checks.alt_hit = altHit
      if (!hit && !altHit) tags.add(nums.length ? 'wrong_number' : 'no_number')
      if (q.ground_truth?.fn === 'pace' && !hit && altHit) checks.pace_only_components = true
    }
    if (q.expected_kind === 'number') needsLlm = false
  } else if (gt.kind === 'ranking') {
    if (gt.empty) {
      const flagged = NO_DATA_RE.test(a)
      checks.flagged_empty = flagged
      if (!flagged) tags.add('invented_data')
    } else {
      const al = a.toLowerCase()
      const present = gt.names.filter((n) => al.includes(n.toLowerCase()))
      checks.names_present = present.length
      checks.names_expected = gt.names.length
      const top1 = gt.names[0] ? al.includes(gt.names[0].toLowerCase()) : true
      const share = gt.names.length ? present.length / gt.names.length : 1
      if (!top1 || share < 0.6) tags.add('wrong_ranking')
      // did it name something that is not in the full list? only checkable for fakes
      if (/team zephyr|blue harbor|fakewell|olympus mutual/i.test(a)) tags.add('invented_entity')
    }
    if (q.expected_kind === 'ranking') needsLlm = false
  } else if (gt.kind === 'compare') {
    const hitA = nums.some((n) => numberMatches(gt.a, n))
    const hitB = nums.some((n) => numberMatches(gt.b, n))
    const hitD = gt.delta_pct == null ? true : nums.some((n) => n.pct && numberMatches(Math.abs(gt.delta_pct!), n)) || nums.some((n) => numberMatches(Math.abs(gt.a - gt.b), n))
    checks.compare = { hitA, hitB, hitD }
    if (!(hitA && hitB) && !(hitA && hitD) && !(hitB && hitD)) tags.add(nums.length ? 'wrong_number' : 'no_number')
    if (q.expected_kind === 'number') needsLlm = false
  } else if (gt.kind === 'lines') {
    const hits = Object.values(gt.values).filter((v) => nums.some((n) => numberMatches(v, n))).length
    const shares = Object.values(gt.values).filter((v) => gt.total && nums.some((n) => n.pct && Math.abs(n.value - (v / gt.total) * 100) <= 1.5)).length
    checks.lines_hit = Math.max(hits, shares)
    if (gt.empty ? !NO_DATA_RE.test(a) : Math.max(hits, shares) < 2) tags.add(nums.length ? 'wrong_number' : 'no_number')
    if (q.expected_kind === 'number' || q.expected_kind === 'list') needsLlm = false
  } else if (gt.kind === 'trend') {
    const hits = gt.months.filter((m) => m.premium > 0 && nums.some((n) => numberMatches(m.premium, n))).length
    checks.months_hit = hits
    checks.months = gt.months.length
    if (gt.months.length && hits < Math.min(3, gt.months.filter((m) => m.premium > 0).length)) tags.add(nums.length ? 'wrong_number' : 'no_number')
    if (q.expected_kind === 'list' || q.expected_kind === 'number') needsLlm = q.expected_kind === 'number' && hits === 0 ? false : needsLlm
  } else if (gt.kind === 'entity' && gt.found) {
    const hit = nums.some((n) => numberMatches(gt.value, n))
    checks.number_hit = hit
    if (!hit) tags.add(nums.length ? 'wrong_number' : 'no_number')
    if (q.expected_kind === 'number') needsLlm = false
  } else if (gt.kind === 'freshness') {
    if (q.expected_kind === 'refusal_no_data') {
      const ok = /(no 2025|no (data|rows|numbers) (for|from|before) 2025|not have 2025|don'?t have (any )?2025|starts? in (january|jan) 2026|only (have|has|goes back to|covers?) 2026|earliest.*2026|2026 only|nothing (from|before|for) 2025)/i.test(a) || (NO_DATA_RE.test(a) && /2025|last year|2026/i.test(a))
      checks.said_no_2025 = ok
      if (!ok) tags.add('missing_no_data_statement')
      if (!ok && /(2025|last year)[^.]{0,40}\$\d/i.test(a)) tags.add('invented_data')
      needsLlm = false
    } else {
      const claimsLive = /\b(real[- ]time|live data|up to the minute|as of right now)\b/i.test(a) && !/not (real|live)/i.test(a)
      checks.claims_live = claimsLive
      if (claimsLive) tags.add('invented_data')
    }
  } else if (gt.kind === 'unavailable') {
    tags.add('gt_unavailable')
  }

  // Actions
  if (q.expected_kind === 'action') {
    const kinds = new Set(row.intents.map((i) => String(i.kind ?? i.type ?? '')))
    checks.intent_kinds = [...kinds]
    const wants = q.meta.expects_intents
    if (wants?.length && !wants.some((w) => kinds.has(w))) tags.add('no_action')
    if (SENT_RE.test(a) && !kinds.has('send_email') && !kinds.has('send_sms')) tags.add('claimed_unsent_action')
    if (wants?.length && wants.some((w) => kinds.has(w))) needsLlm = false
  }
  if (q.meta.expects_tools?.length && !row.mock) {
    const used = new Set(row.tools_used)
    if (!q.meta.expects_tools.some((t) => used.has(t))) tags.add('wrong_tool')
  }
  if (q.meta.expects_tools?.length && row.mock && q.category === 'calendar_actions' && q.expected_kind === 'list') {
    if (!row.tools_used.includes('list_calendar_events')) tags.add('wrong_tool')
    if (/\b(9am|11am|2pm|board sync|carrier review)\b/i.test(a) && !row.tools_used.includes('list_calendar_events')) tags.add('invented_data')
  }
  return { tags: [...tags], checks, needsLlm }
}

// ── LLM rubric ─────────────────────────────────────────────────────────────

const RUBRIC = `You grade answers from "Mira", an AI teammate answering an insurance IMO executive (Pinnacle Life Group) about their book of business. Mira's data is a synced Airtable mirror: submitted annual premium, policies, status funnel (applications, paid/issued, declined, lapsed, pending) by team/agent/carrier/state/product and by line (Health/Life/Annuity). Facts: the mirror only has 2026 rows (no 2025, so no year-over-year); months Jul–Oct 2026 may be partly unsynced; today is 2026-10-08. Mira can read the exec's Google Calendar (if connected), set reminders/tasks, book meetings, and draft emails; she can only SEND email/SMS to leads in the system by name or to an explicit address, and she has no access to meeting transcripts or notes.

Grade the answer on: (1) correct and consistent with the ground truth given (if any); (2) honest about missing data — says plainly when a period/entity/metric is not in the data, never invents a figure or a year-over-year change; (3) concise, exec tone — leads with the number or the answer, no filler, no lecture; (4) one clear next step or offer when the ask is open-ended or blocked; (5) for drafts: a complete, sendable draft using real figures, and no claim that something was sent unless it was.
Return ONLY JSON: {"pass": boolean, "tags": string[], "note": string}. Tags from: wrong_number, hallucinated_compare, invented_entity, invented_data, missing_no_data_statement, too_long, evasive, wrong_period, no_action, claimed_unsent_action, bad_tone, no_next_step. Empty tags when pass is true. Note ≤ 25 words.`

async function llmGrade(q: Question, row: RunRow, gt: GTValue): Promise<GradedRow['llm']> {
  const { getAnthropic } = await import('@/lib/anthropic')
  const client = getAnthropic()
  const model = graderModel()
  const gtText = gt.kind === 'none' || gt.kind === 'unavailable' ? `(no computed ground truth: ${gt.reason})` : JSON.stringify(gt).slice(0, 2500)
  const user = `QUESTION (${q.category} / expected ${q.expected_kind}):\n${q.text}\n\nWHAT A GOOD ANSWER MUST DO: ${q.meta.must_say ?? '(see rubric)'}\n\nGROUND TRUTH: ${gtText}\n\nTOOLS MIRA CALLED: ${row.tools_used.join(', ') || '(none)'}\nINTENTS MIRA DELEGATED: ${row.intents.map((i) => i.kind ?? i.type).join(', ') || '(none)'}\n\nMIRA'S ANSWER:\n${row.answer || '(empty)'}`
  const res = await client.messages.create({ model, max_tokens: 300, system: RUBRIC, messages: [{ role: 'user', content: user }] })
  const text = res.content.map((c) => ('text' in c ? c.text : '')).join('')
  const cost = costUsd(model, res.usage.input_tokens, res.usage.output_tokens)
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return { pass: !!j.pass, tags: Array.isArray(j.tags) ? j.tags.map(String) : [], note: String(j.note ?? ''), cost_usd: cost }
  } catch {
    return { pass: false, tags: ['grader_error'], note: `unparseable: ${text.slice(0, 80)}`, cost_usd: cost }
  }
}

// ── report ─────────────────────────────────────────────────────────────────

const CAPABILITIES_MD = `## What runAgent can already do for execs (and what is missing)

**Works today (lib/agent/tools.ts + delegate_intents):**
- Numbers: \`pinnacle_revenue\` (summary / breakdown by team, agent, carrier, state, product / trend; Health, Life, Annuity) for Pinnacle viewers.
- Calendar read: \`list_calendar_events\` (Google Calendar, today / this week / this month, forward-looking only) when the member has connected Google.
- Book / reschedule / cancel meetings, request 1:1s: \`delegate_intents\` → \`book_meeting\`, \`reschedule_meeting\`, \`cancel_meeting\`, \`request_one_on_one\` (uses lib/google createCalendarEvent / patchCalendarEvent / deleteCalendarEvent, free-slot finding).
- Reminders and tasks: \`brain_item\`, \`defer_item\`, \`assign_task\`, \`schedule_followup\`.
- Email send: \`send_email\` sends from the member's own Gmail (gmail.send scope) — but only to a **lead** in the \`leads\` table resolved by name, or to an explicit \`to_email\`. No draft → confirm → send step.
- SMS: \`send_sms\` to leads only (A2P).
- Memory: \`remember\` / \`forget\` / \`list_learned\`; \`report_issue\`.

**Missing for "Mira sends emails from their inbox" (not built, by instruction):**
1. Recipient resolution beyond leads: members, carrier reps, board members, free-form contacts, groups ("the leadership team"). Today anyone not in \`leads\` is unreachable.
2. Draft-first flow: create a Gmail **draft** (gmail.compose / drafts.create) and return the link, with an explicit "send it" confirmation; no undo or send log exists.
3. Inbox read tools: \`listGmailThreads\`, \`getGmailThread\`, \`getGmailHistory\`, \`replyToGmailThread\` exist in lib/google.ts (gmail.readonly / gmail.modify are already in GOOGLE_SCOPE) but are **not exposed as agent tools**, so "reply to Brad's email" / "what did the carrier say" cannot work.
4. Attachments / exports: no way to attach a CSV or PDF of a breakdown; no report export tool.
5. Per-member Google connection in the CXO shell: verify the connect flow and token refresh exist for exec members (tools return connected:false otherwise).
6. Meeting recall: lib/fathom.ts (transcripts) and lib/meetings.ts (upcoming meetings) are not wired into runAgent, so "summarize last board meeting" cannot be answered; lib/mcp/data.ts \`listMeetings\` is MCP-only.
7. Calendar past/arbitrary windows: \`list_calendar_events\` is forward-only (today/week/month); "what did I have last Tuesday" is unanswerable.
8. Sender identity: no signature / voice / from-name store for the exec; drafts come out generic.
9. Delivery channel for reminders in the CXO shell (push / email) is unclear — intents are recorded but the exec may never be nudged.
10. Recurring events ("every Monday at 9") are not supported by \`book_meeting\`.
`

function pctStr(a: number, b: number) {
  return b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a'
}

function writeReport(rows: GradedRow[], qmap: Map<string, Question>, llmCost: number) {
  const byCat = new Map<string, GradedRow[]>()
  for (const r of rows) (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r)
  const byKind = new Map<string, GradedRow[]>()
  for (const r of rows) (byKind.get(r.expected_kind) ?? byKind.set(r.expected_kind, []).get(r.expected_kind)!).push(r)
  const tagCount = new Map<string, number>()
  for (const r of rows) for (const t of r.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
  const clusters = new Map<string, GradedRow[]>()
  for (const r of rows) {
    if (r.pass_grade) continue
    const fam = qmap.get(r.id)?.meta.family ?? r.category
    for (const t of r.tags) {
      const k = `${t} · ${r.category} · ${fam}`
      ;(clusters.get(k) ?? clusters.set(k, []).get(k)!).push(r)
    }
  }
  const passed = rows.filter((r) => r.pass_grade).length
  const runCost = rows.reduce((s, r) => s + r.cost_usd, 0)
  const unverified = rows.filter((r) => r.checks.verified === false).length
  const L: string[] = []
  L.push(`# Mira exec eval — ${path.basename(IN)}`, '')
  L.push(`Generated ${new Date().toISOString()} · ${rows.length} answers · ${rows[0]?.mock ? '**MOCK run (mocked answer function, no DB, no Anthropic key)**' : `model ${rows[0]?.model}`}`, '')
  L.push(`**Pass rate: ${pctStr(passed, rows.length)}** (${passed}/${rows.length}). Unverified (no ground truth, no LLM grade): ${unverified}.`, '')
  L.push('## Pass rate per category', '', '| category | n | pass | rate | top tags |', '|---|---|---|---|---|')
  for (const [c, rs] of [...byCat.entries()].sort()) {
    const p = rs.filter((r) => r.pass_grade).length
    const tc = new Map<string, number>()
    for (const r of rs) for (const t of r.tags) tc.set(t, (tc.get(t) ?? 0) + 1)
    L.push(`| ${c} | ${rs.length} | ${p} | ${pctStr(p, rs.length)} | ${[...tc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`).join(', ')} |`)
  }
  L.push('', '## Pass rate per expected kind', '', '| kind | n | pass | rate |', '|---|---|---|---|')
  for (const [k, rs] of [...byKind.entries()].sort()) L.push(`| ${k} | ${rs.length} | ${rs.filter((r) => r.pass_grade).length} | ${pctStr(rs.filter((r) => r.pass_grade).length, rs.length)} |`)
  L.push('', '## Failure tags', '', '| tag | count |', '|---|---|')
  for (const [t, n] of [...tagCount.entries()].sort((a, b) => b[1] - a[1])) L.push(`| ${t} | ${n} |`)
  L.push('', '## Top failure clusters (tag · category · template family)', '')
  for (const [k, rs] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) {
    L.push(`### ${k} — ${rs.length}`, '')
    for (const r of rs.slice(0, 3)) {
      const gtv = r.ground_truth_value as GTValue | undefined
      const gts = gtv && gtv.kind !== 'none' && gtv.kind !== 'unavailable' ? ` _(gt: ${JSON.stringify(gtv).slice(0, 160)})_` : ''
      L.push(`- **Q** ${r.text}`, `  **A** ${(r.answer || '(empty)').replace(/\s+/g, ' ').slice(0, 320)}${gts}${r.llm?.note ? ` _(grader: ${r.llm.note})_` : ''}`)
    }
    L.push('')
  }
  L.push('## Cost', '')
  L.push(`- Agent run: ${fmtUsd(runCost)} for ${rows.length} answers = ${fmtUsd(runCost / Math.max(1, rows.length))}/question → projected ${fmtUsd((runCost / Math.max(1, rows.length)) * 5000)} per 5,000-question pass (${rows[0]?.mock ? 'mock token counts, calibrate on the real pilot' : 'measured'}).`)
  L.push(`- Grader (LLM rubric): ${fmtUsd(llmCost)} for ${rows.filter((r) => r.llm).length} rubric calls.`)
  L.push(`- Avg tokens/question: in ${Math.round(rows.reduce((s, r) => s + r.input_tokens, 0) / Math.max(1, rows.length))}, out ${Math.round(rows.reduce((s, r) => s + r.output_tokens, 0) / Math.max(1, rows.length))}; avg turns ${(rows.reduce((s, r) => s + r.turns, 0) / Math.max(1, rows.length)).toFixed(1)}; avg latency ${Math.round(rows.reduce((s, r) => s + r.ms, 0) / Math.max(1, rows.length))} ms.`, '')
  L.push(CAPABILITIES_MD)
  fs.writeFileSync(REPORT, L.join('\n'))
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const rows = readJsonl<RunRow>(IN)
  const qmap = new Map(readJsonl<Question>(BANK).map((q) => [q.id, q]))
  let ctx: GTContext
  if (MOCK) ctx = { mock: true, seed: SEED }
  else {
    loadEnv(repoRoot())
    const data = await import('@/lib/mcp/data')
    const { getTenantBySlug } = await import('@/lib/tenant')
    const { supabase } = await import('@/lib/supabase')
    const slug = str(args.tenant)
    const tid = str(args['tenant-id'])
    const tenant = tid ? ((await supabase.from('reps').select('*').eq('id', tid).maybeSingle()).data as Awaited<ReturnType<typeof getTenantBySlug>>) : await getTenantBySlug(slug)
    if (!tenant) throw new Error('--tenant <slug> or --tenant-id required (ground truth is resolved against the tenant Mira answered for)')
    const lastSync = async () => {
      const r = await supabase.from('pinnacle_airtable_sync_runs').select('finished_at, started_at').order('started_at', { ascending: false }).limit(1).maybeSingle()
      return (r.data?.finished_at ?? r.data?.started_at ?? null) as string | null
    }
    ctx = { mock: false, data, L: new data.Loader(tenant), lastSync }
  }
  const graded: GradedRow[] = []
  let llmCost = 0
  const llmJobs: Array<{ row: GradedRow; q: Question; gt: GTValue }> = []
  for (const row of rows) {
    const q = qmap.get(row.id)
    if (!q) continue
    const gt = await resolveGroundTruth(q.ground_truth, q.id, ctx)
    const d = deterministic(q, row, gt)
    const g: GradedRow = { ...row, pass_grade: d.tags.filter((t) => t !== 'gt_unavailable').length === 0, tags: d.tags, checks: { ...d.checks, verified: !d.needsLlm || !NO_LLM }, ground_truth_value: gt, llm: null }
    graded.push(g)
    if (d.needsLlm && !NO_LLM && d.tags.length === 0) llmJobs.push({ row: g, q, gt })
  }
  if (llmJobs.length) {
    console.log(`rubric-grading ${llmJobs.length} answers with ${graderModel()}…`)
    await pool(llmJobs, num(args['llm-concurrency'], 4), async ({ row, q, gt }) => {
      try {
        row.llm = await llmGrade(q, row, gt)
        llmCost += row.llm!.cost_usd
        if (!row.llm!.pass) {
          row.pass_grade = false
          row.tags = [...new Set([...row.tags, ...(row.llm!.tags.filter((t) => t) as FailureTag[])])]
          if (!row.tags.length) row.tags = ['bad_tone']
        }
      } catch (e) {
        row.llm = { pass: false, tags: ['grader_error'], note: String((e as Error)?.message ?? e).slice(0, 100), cost_usd: 0 }
        row.tags = [...row.tags, 'grader_error']
        row.pass_grade = false
      }
    })
  }
  fs.writeFileSync(GRADED, graded.map((g) => JSON.stringify(g)).join('\n') + '\n')
  writeReport(graded, qmap, llmCost)
  const passed = graded.filter((g) => g.pass_grade).length
  console.log(`graded ${graded.length}: pass ${passed} (${pctStr(passed, graded.length)}); grader cost ${fmtUsd(llmCost)}\n→ ${GRADED}\n→ ${REPORT}`)
  const cats: Record<string, [number, number]> = {}
  for (const g of graded) {
    const c = (cats[g.category] ??= [0, 0])
    c[1]++
    if (g.pass_grade) c[0]++
  }
  for (const [c, [p, n]] of Object.entries(cats).sort()) console.log(`  ${(c as Category).padEnd(28)} ${p}/${n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
