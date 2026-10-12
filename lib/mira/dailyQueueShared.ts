/**
 * Run daily queue (owner 10-11): the pure half. Types, the safe / needs-you
 * line, the report maths and the demo sample. No database, no model, so the
 * client, the demo and the tests can all import it.
 *
 * The line (one place, enforced on the server for the app AND for a
 * connected Claude):
 *   Mira does alone      = internal and reversible: file a to-do, sort a
 *                          message, write a draft, write a brief, propose
 *                          talking points, list what is due.
 *   Needs a tap          = anything that leaves the person's hands: sending
 *                          an email or a message, booking or moving an
 *                          event, putting points on a shared 1:1 agenda,
 *                          assigning work, posting praise.
 */

/** A run never makes more model calls than this. */
export const MAX_MODEL_CALLS = 8
export const QUEUE_COMMAND = 'Run daily queue'

/** "run daily queue", "Run my daily queue.", "run the daily queue" */
export function isRunQueueText(text: string): boolean {
  return /^\s*run\s+(my\s+|the\s+)?daily\s+queue\s*[.!]?\s*$/i.test(text)
}

// ── What a run did ──────────────────────────────────────────────────────────

export const DONE_KEYS = ['todos', 'sorted', 'reply_drafts', 'email_drafts', 'talking_points', 'briefs', 'due', 'goals', 'one_on_ones', 'reminders'] as const
export type DoneKey = (typeof DONE_KEYS)[number]
/** `key` is stable per source so a later run the same day never lists it twice. */
export type DoneLine = { key: string; text: string; detail?: string | null }
export type DoneSection = { key: DoneKey; lines: DoneLine[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function sectionLabel(key: DoneKey, n: number): string {
  switch (key) {
    case 'todos': return `${plural(n, 'to-do', 'to-dos')} filed`
    case 'sorted': return `${plural(n, 'message', 'messages')} sorted`
    case 'reply_drafts': return `${plural(n, 'reply', 'replies')} drafted`
    case 'email_drafts': return `${plural(n, 'email', 'emails')} drafted`
    case 'talking_points': return `Talking points for ${plural(n, '1:1', '1:1s')}`
    case 'briefs': return `${plural(n, 'meeting brief', 'meeting briefs')}`
    case 'due': return `${n} due or overdue`
    case 'goals': return `${plural(n, 'goal', 'goals')} off pace`
    case 'one_on_ones': return `${plural(n, '1:1', '1:1s')} overdue`
    case 'reminders': return 'Due-date reminders written'
  }
}

// ── What is waiting on a tap ────────────────────────────────────────────────

/** Kept rows (cxo_daily_queue_items). */
export const ITEM_KINDS = ['reply_draft', 'email_draft', 'inbox_draft', 'talking_points', 'brief'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/**
 * Which kept items leave the person's hands when acted on. A brief is theirs
 * alone; everything else is sent to, or shown to, someone else.
 */
export function needsTap(kind: ItemKind): boolean {
  return kind !== 'brief'
}
export const TAP_WORDS: Record<Exclude<ItemKind, 'brief'>, string> = {
  reply_draft: 'Send reply',
  email_draft: 'Send email',
  inbox_draft: 'Send reply',
  talking_points: 'Add to agenda',
}

export type NeedItem = { id: string; kind: Exclude<ItemKind, 'brief'>; title: string; body: string; cta: string }

export type QueueReport = {
  day: string
  /** Last run today, ISO; null = not run today. */
  ranAt: string | null
  done: DoneSection[]
  needs: NeedItem[]
  modelCalls: number
  estCostUsd: number
  /** Set when part of the run was skipped (cap reached, feature not switched on). */
  note?: string | null
}

export const EMPTY_REPORT = (day: string): QueueReport => ({ day, ranAt: null, done: [], needs: [], modelCalls: 0, estCostUsd: 0, note: null })

export function reportIsEmpty(r: Pick<QueueReport, 'done' | 'needs'>): boolean {
  return r.needs.length === 0 && r.done.every((s) => s.lines.length === 0)
}

export const NOTHING_LINE = 'Nothing pending. You are caught up.'

/** One line for the chat history and for screen readers. */
export function summaryLine(r: QueueReport): string {
  if (reportIsEmpty(r)) return NOTHING_LINE
  const parts = r.done.filter((s) => s.lines.length > 0).map((s) => sectionLabel(s.key, s.lines.length))
  const needs = r.needs.length ? `${r.needs.length} need${r.needs.length === 1 ? 's' : ''} you` : ''
  return [parts.length ? `Done: ${parts.join(', ')}.` : '', needs ? `${needs.charAt(0).toUpperCase()}${needs.slice(1)}.` : ''].filter(Boolean).join(' ')
}

export function countsOf(done: DoneSection[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of done) if (s.lines.length) out[s.key] = (out[s.key] ?? 0) + s.lines.length
  return out
}

/** Every line key a set of earlier runs already reported. */
export function seenKeys(earlier: Array<{ done?: DoneSection[] | null }>): Set<string> {
  const out = new Set<string>()
  for (const r of earlier) for (const s of r.done ?? []) for (const l of s.lines ?? []) out.add(`${s.key}|${l.key}`)
  return out
}

/** Drop lines an earlier run today already reported: a second run only shows what is new. */
export function onlyNew(done: DoneSection[], seen: Set<string>): DoneSection[] {
  return done
    .map((s) => ({ key: s.key, lines: s.lines.filter((l) => !seen.has(`${s.key}|${l.key}`)) }))
    .filter((s) => s.lines.length > 0)
}

/** The day's report: every run's sections folded together, in the fixed order, no line twice. */
export function mergeDone(runs: Array<{ done?: DoneSection[] | null }>): DoneSection[] {
  const by = new Map<DoneKey, DoneLine[]>()
  const seen = new Set<string>()
  for (const r of runs) {
    for (const s of r.done ?? []) {
      if (!(DONE_KEYS as readonly string[]).includes(s.key)) continue
      for (const l of s.lines ?? []) {
        const k = `${s.key}|${l.key}`
        if (seen.has(k)) continue
        seen.add(k)
        by.set(s.key, [...(by.get(s.key) ?? []), l])
      }
    }
  }
  return DONE_KEYS.filter((k) => by.has(k)).map((k) => ({ key: k, lines: by.get(k)! }))
}

// ── The call budget ─────────────────────────────────────────────────────────

export type Budget = { max: number; calls: number; costUsd: number }
export const newBudget = (max = MAX_MODEL_CALLS): Budget => ({ max, calls: 0, costUsd: 0 })
/** How many more calls may be made while keeping `reserve` back for later steps. */
export function callsLeft(b: Budget, reserve = 0): number {
  return Math.max(0, b.max - b.calls - reserve)
}

// ── Small rules the gatherer and the tests share ────────────────────────────

const DAY_MS = 86_400_000
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS)
/** Overdue this long = stale: it goes to the top of the list. */
export const STALE_DAYS = 7

export type DueRow = { kind: 'todo' | 'card'; id: string; title: string; due_date: string }
export type DueView = DueRow & { days_overdue: number; stale: boolean }

/** Due today or overdue, stale first, then oldest first. */
export function dueList(rows: DueRow[], today: string): DueView[] {
  return rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) && r.due_date <= today)
    .map((r) => {
      const d = dayDiff(today, r.due_date)
      return { ...r, days_overdue: d, stale: d >= STALE_DAYS }
    })
    .sort((a, b) => b.days_overdue - a.days_overdue || a.title.localeCompare(b.title))
}

export function dueWords(d: DueView): string {
  const when = d.days_overdue === 0 ? 'due today' : d.days_overdue === 1 ? '1 day overdue' : `${d.days_overdue} days overdue`
  return `${d.title} · ${when}${d.stale ? ' · stale' : ''}`
}

/** Pull the first JSON object out of a model reply. */
export function parseJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `{ <field>: [{ i, <value> }] }` → index → trimmed string, for a batched call. */
export function parseBatch(text: string, field: string, value: string, max = 600): Map<number, string> {
  const out = new Map<number, string>()
  const o = parseJson(text)
  const list = o && Array.isArray(o[field]) ? (o[field] as unknown[]) : []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const i = Number(r.i)
    const v = Array.isArray(r[value]) ? (r[value] as unknown[]).filter((x) => typeof x === 'string').join('\n') : typeof r[value] === 'string' ? (r[value] as string) : ''
    if (Number.isInteger(i) && i >= 0 && v.trim()) out.set(i, v.trim().slice(0, max))
  }
  return out
}

// ── /cxo/demo: an invented day ──────────────────────────────────────────────

export const DEMO_QUEUE: QueueReport = {
  day: '2026-10-08',
  ranAt: '2026-10-08T12:05:00.000Z',
  modelCalls: 5,
  estCostUsd: 0.03,
  note: null,
  done: [
    {
      key: 'todos',
      lines: [
        { key: 'd1', text: 'Send the Q4 activation checklist to the agency leads', detail: 'From: Agency leadership sync' },
        { key: 'd2', text: 'Confirm the carrier training date', detail: 'From: Agency leadership sync' },
        { key: 'd3', text: 'Look at the activation checklist draft', detail: 'Request from Priya' },
      ],
    },
    { key: 'sorted', lines: [{ key: 'd4', text: 'Dana: needs your decision' }, { key: 'd5', text: 'Marcus: just so you know' }] },
    { key: 'reply_drafts', lines: [{ key: 'd6', text: 'Reply to Dana, ready below' }] },
    { key: 'briefs', lines: [{ key: 'd7', text: 'Carrier review · 2:00pm', detail: 'With Dana and two guests. Last time: placement plan agreed, training date left open. 2 open items.' }] },
    { key: 'due', lines: [{ key: 'd8', text: 'Renewal deck · 9 days overdue · stale' }, { key: 'd9', text: 'Sign the Q4 comp plan · due today' }] },
    { key: 'goals', lines: [{ key: 'd10', text: 'Agencies activated: 14 of 30 (47%), pace says 62%' }] },
  ],
  needs: [
    { id: 'demo-reply', kind: 'reply_draft', title: 'Reply to Dana', body: 'Yes, go ahead with the two-carrier pilot. Let us look at the first month together on the 22nd.', cta: TAP_WORDS.reply_draft },
    { id: 'demo-agenda', kind: 'talking_points', title: '1:1 with Marcus · tomorrow', body: 'Agencies activated is 15 points behind pace\nThe open item on the renewal deck\nWhat he needs from you on carrier training', cta: TAP_WORDS.talking_points },
    { id: 'demo-email', kind: 'email_draft', title: 'Email to Northfield Partners', body: 'Following up on Tuesday: the activation checklist is attached and the training date is next.', cta: TAP_WORDS.email_draft },
  ],
}
