/**
 * Monthly board update (Suite CXO, Ciao): the pure half. Timing, the month
 * key, who may see it, and the wording of the draft. No server imports, so
 * the card, the API, Ciao's tool, the worker and the tests all share it.
 *
 * Every figure here comes in as a number from lib/boardUpdate/data.ts
 * (deterministic rollups of the book, the sales plan and QuickBooks) and is
 * only formatted. No model writes or changes a figure. Ciao never sends the
 * update: the exec edits it, copies it and sends it themselves.
 */
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { canViewComp } from '@/lib/employees/shared'
import { BOARD_UPDATE_NOTICE_PREFIX } from '@/lib/followups/noticeActionsShared'

export const BOARD_UPDATE_PREFIX = BOARD_UPDATE_NOTICE_PREFIX
export const BOARD_UPDATE_ANCHOR = 'board-update'
export const BOARD_UPDATE_ROLES = ['owner', 'admin'] as const
/** Drafted from this local hour on the first business day. */
export const DRAFT_HOUR = 8
/** A tenant first seen later in the month still gets its draft through this day. */
export const CATCH_UP_DAY = 10
export const MAX_BODY = 20_000
export const MAX_GOALS = 5
export const MAX_CARDS = 5
export const MAX_DECISIONS = 8

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export function boardUpdateOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CXO_BOARD_UPDATE ?? '').trim().toLowerCase() !== 'off'
}

/** Owners and admins who can see the money. Never employees, managers or assistants. */
export function canSeeBoardUpdate(member: { role?: string | null; settings?: Record<string, unknown> | null } | null | undefined): boolean {
  if (!member) return false
  if (!(BOARD_UPDATE_ROLES as readonly string[]).includes(String(member.role))) return false
  return canViewComp(member)
}

// ── Time ───────────────────────────────────────────────────────────────────

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function zoneParts(at: Date, tz: string | null | undefined): Parts {
  const make = (zone: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  let fmt: Intl.DateTimeFormat
  try {
    fmt = make(tz || 'America/New_York')
  } catch {
    fmt = make('America/New_York')
  }
  const get = (t: string) => Number(fmt.formatToParts(at).find((p) => p.type === t)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const monthKeyOf = (year: number, month: number) => `${year}-${pad(month)}`

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key ?? '').trim())
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null
}

export function shiftMonth(key: string, by: number): string {
  const p = parseMonthKey(key)
  if (!p) return key
  const idx = p.year * 12 + (p.month - 1) + by
  return monthKeyOf(Math.floor(idx / 12), (idx % 12) + 1)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthLabel(key: string): string {
  const p = parseMonthKey(key)
  return p ? `${MONTH_NAMES[p.month - 1]} ${p.year}` : key
}

/** First weekday of the month (Mon to Fri), skipping New Year's Day. */
export function firstBusinessDay(year: number, month: number): number {
  for (let d = 1; d <= 7; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay()
    if (wd === 0 || wd === 6) continue
    if (month === 1 && d === 1) continue
    return d
  }
  return 1
}

/** The tenant's local date as YYYY-MM-DD. */
export function localDate(now: Date, tz: string | null | undefined): string {
  const p = zoneParts(now, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** The month the update covers: the one that just closed, in the tenant's zone. */
export function coveredMonth(now: Date, tz: string | null | undefined): string {
  const p = zoneParts(now, tz)
  return shiftMonth(monthKeyOf(p.year, p.month), -1)
}

/** True from 8am on the first business day of the month, through the catch-up day. */
export function isDraftTime(now: Date, tz: string | null | undefined): boolean {
  const p = zoneParts(now, tz)
  const fbd = firstBusinessDay(p.year, p.month)
  if (p.day === fbd) return p.hour >= DRAFT_HOUR
  return p.day > fbd && p.day <= CATCH_UP_DAY
}

/** UTC instant of local midnight on a calendar day in a zone. */
export function zonedMidnightIso(year: number, month: number, day: number, tz: string | null | undefined): string {
  const guess = Date.UTC(year, month - 1, day)
  const p = zoneParts(new Date(guess), tz)
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess
  let at = guess - offset
  // A DST change between the guess and the answer moves the offset once more.
  const q = zoneParts(new Date(at), tz)
  const offset2 = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - at
  if (offset2 !== offset) at = guess - offset2
  return new Date(at).toISOString()
}

/** The month as dates (for the book and due dates) and as instants (for timestamps), in the tenant's zone. */
export function monthBounds(key: string, tz: string | null | undefined) {
  const p = parseMonthKey(key)
  if (!p) throw new Error(`bad month ${key}`)
  const last = daysInMonth(p.year, p.month)
  const next = parseMonthKey(shiftMonth(key, 1))!
  return {
    startDate: `${key}-01`,
    endDate: `${key}-${pad(last)}`,
    startIso: zonedMidnightIso(p.year, p.month, 1, tz),
    endIso: zonedMidnightIso(next.year, next.month, 1, tz),
  }
}

export const noticeKey = (month: string, memberId: string) => `${BOARD_UPDATE_PREFIX}${month}-${memberId}`

// ── Facts in, sections out ──────────────────────────────────────────────────

export type Money2 = { premium: number; policies: number }
export type QboSlice = { income: number; net_income: number }

export type BoardFacts = {
  month: string
  company: string | null
  /** The book of business. null when the tenant has none. */
  book: null | {
    month: Money2
    /** Same month last year. null when the book does not go back that far. */
    monthLastYear: Money2 | null
    ytd: Money2
    ytdLastYear: Money2 | null
    through: string | null
  }
  /** The sales plan (premium). null when no plan was set for the year. */
  plan: null | { month: number; ytd: number }
  /** QuickBooks profit and loss. null when QuickBooks is not connected or has no month. */
  qbo: null | {
    month: QboSlice | null
    monthLastYear: QboSlice | null
    ytd: QboSlice
    ytdLastYear: QboSlice | null
  }
  goalsDone: string[]
  goalsMissed: string[]
  kpis: { hit: number; missed: number }
  cardsDone: { count: number; titles: string[] }
  cardsMissed: { count: number; titles: string[] }
  decisions: Array<{ text: string; meeting_title: string | null; decided_at: string }>
}

export type HeadlineLine = {
  label: string
  unit: 'money' | 'count' | 'percent'
  actual: number | null
  plan: number | null
  last_year: number | null
  source: 'book' | 'plan' | 'quickbooks'
  text: string
}

export type BoardSections = {
  month: string
  month_label: string
  company: string | null
  headline: HeadlineLine[]
  wins: string[]
  misses: string[]
  decisions: string[]
  asks: string[]
  sources: string[]
  through: string | null
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
}
export const fmtCount = (n: number) => Math.round(n).toLocaleString('en-US')

/** Percent change, one decimal. null when there is nothing to compare against. */
export function changePct(now: number, before: number | null | undefined): number | null {
  if (before == null || !Number.isFinite(before) || before === 0) return null
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10
}

/** Share of plan as a whole percent. null without a plan. */
export function ofPlanPct(actual: number, plan: number | null | undefined): number | null {
  if (plan == null || !Number.isFinite(plan) || plan <= 0) return null
  return Math.round((actual / plan) * 100)
}

const changeWords = (c: number | null) => (c == null ? null : c === 0 ? 'flat' : c > 0 ? `up ${c}%` : `down ${Math.abs(c)}%`)

function line(label: string, unit: HeadlineLine['unit'], source: HeadlineLine['source'], actual: number, plan: number | null, lastYear: number | null, noLastYearWhy?: string): HeadlineLine {
  const f = unit === 'money' ? fmtMoney : fmtCount
  const parts: string[] = [`${label}: ${f(actual)}`]
  if (plan != null) {
    const p = ofPlanPct(actual, plan)
    parts.push(`plan ${f(plan)}${p == null ? '' : ` (${p}% of plan)`}`)
  }
  if (lastYear != null) {
    const c = changeWords(changePct(actual, lastYear))
    parts.push(`last year ${f(lastYear)}${c ? ` (${c})` : ''}`)
  } else if (noLastYearWhy) {
    parts.push(noLastYearWhy)
  }
  return { label, unit, actual, plan, last_year: lastYear, source, text: parts.join(', ') }
}

const short = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${SHORT[Number(m[2]) - 1]} ${Number(m[3])}` : iso
}
const clip = (s: string, n = 200) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t
}
const listOf = (titles: string[]) => titles.map((t) => clip(t, 90)).join('; ')

export function composeSections(f: BoardFacts): BoardSections {
  const mLabel = monthLabel(f.month)
  const mShort = (() => {
    const p = parseMonthKey(f.month)
    return p ? SHORT[p.month - 1] : f.month
  })()
  const headline: HeadlineLine[] = []
  const wins: string[] = []
  const misses: string[] = []
  const sources: string[] = []
  const noLy = 'no book for last year to compare'

  if (f.book) {
    sources.push('the book')
    const b = f.book
    headline.push(line(`Premium written in ${mShort}`, 'money', 'book', b.month.premium, f.plan?.month ?? null, b.monthLastYear?.premium ?? null, noLy))
    headline.push(line('Premium year to date', 'money', 'book', b.ytd.premium, f.plan?.ytd ?? null, b.ytdLastYear?.premium ?? null, noLy))
    headline.push(line(`Policies in ${mShort}`, 'count', 'book', b.month.policies, null, b.monthLastYear?.policies ?? null, noLy))

    const p = ofPlanPct(b.month.premium, f.plan?.month)
    if (p != null && p >= 100) wins.push(`Premium beat the ${mShort} plan: ${fmtMoney(b.month.premium)} against ${fmtMoney(f.plan!.month)} (${p}%).`)
    else if (p != null && p < 95) misses.push(`Premium came in under the ${mShort} plan: ${fmtMoney(b.month.premium)} against ${fmtMoney(f.plan!.month)} (${p}%).`)
    const py = ofPlanPct(b.ytd.premium, f.plan?.ytd)
    if (py != null && py < 95) misses.push(`Year to date premium is behind plan: ${fmtMoney(b.ytd.premium)} against ${fmtMoney(f.plan!.ytd)} (${py}%).`)
    const c = changePct(b.month.premium, b.monthLastYear?.premium)
    if (c != null && c > 0) wins.push(`Premium is up ${c}% on ${mShort} last year.`)
    else if (c != null && c < -5) misses.push(`Premium is down ${Math.abs(c)}% on ${mShort} last year.`)
  } else if (f.plan) {
    headline.push(line(`Planned premium for ${mShort}`, 'money', 'plan', f.plan.month, null, null))
    headline.push(line('Planned premium year to date', 'money', 'plan', f.plan.ytd, null, null))
  }
  if (f.plan) sources.push('the sales plan')

  if (f.qbo) {
    sources.push('QuickBooks')
    const q = f.qbo
    if (q.month) {
      headline.push(line(`Revenue in ${mShort}`, 'money', 'quickbooks', q.month.income, null, q.monthLastYear?.income ?? null))
      const margin = q.month.income > 0 ? Math.round((q.month.net_income / q.month.income) * 100) : null
      const ni = line(`Net income in ${mShort}`, 'money', 'quickbooks', q.month.net_income, null, q.monthLastYear?.net_income ?? null)
      headline.push(margin == null ? ni : { ...ni, text: `${ni.text}, margin ${margin}%` })
      if (q.month.net_income < 0) misses.push(`${mShort} ran at a loss of ${fmtMoney(Math.abs(q.month.net_income))} in QuickBooks.`)
      const rc = changePct(q.month.income, q.monthLastYear?.income)
      if (rc != null && rc > 0) wins.push(`Revenue is up ${rc}% on ${mShort} last year.`)
      else if (rc != null && rc < -5) misses.push(`Revenue is down ${Math.abs(rc)}% on ${mShort} last year.`)
    }
    headline.push(line('Revenue year to date', 'money', 'quickbooks', q.ytd.income, null, q.ytdLastYear?.income ?? null))
    headline.push(line('Net income year to date', 'money', 'quickbooks', q.ytd.net_income, null, q.ytdLastYear?.net_income ?? null))
  }

  const goalsDone = f.goalsDone.slice(0, MAX_GOALS)
  if (goalsDone.length) wins.push(`Goals reached: ${listOf(goalsDone)}${f.goalsDone.length > goalsDone.length ? ` and ${f.goalsDone.length - goalsDone.length} more` : ''}.`)
  const goalsMissed = f.goalsMissed.slice(0, MAX_GOALS)
  if (goalsMissed.length) misses.push(`Goals that passed their due date: ${listOf(goalsMissed)}${f.goalsMissed.length > goalsMissed.length ? ` and ${f.goalsMissed.length - goalsMissed.length} more` : ''}.`)
  const kTotal = f.kpis.hit + f.kpis.missed
  if (kTotal > 0) {
    if (f.kpis.hit > 0) wins.push(`${f.kpis.hit} of ${kTotal} monthly KPIs hit their target.`)
    if (f.kpis.missed > 0) misses.push(`${f.kpis.missed} of ${kTotal} monthly KPIs missed their target.`)
  }
  if (f.cardsDone.count > 0) {
    const t = f.cardsDone.titles.slice(0, MAX_CARDS)
    wins.push(`${f.cardsDone.count} board ${f.cardsDone.count === 1 ? 'card' : 'cards'} done${t.length ? `, including ${listOf(t)}` : ''}.`)
  }
  if (f.cardsMissed.count > 0) {
    const t = f.cardsMissed.titles.slice(0, MAX_CARDS)
    misses.push(`${f.cardsMissed.count} board ${f.cardsMissed.count === 1 ? 'card was' : 'cards were'} due in ${mShort} and not done${t.length ? `: ${listOf(t)}` : ''}.`)
  }

  const decisions = f.decisions.slice(0, MAX_DECISIONS).map((d) => {
    const where = [d.meeting_title ? clip(d.meeting_title, 80) : null, short(d.decided_at)].filter(Boolean).join(', ')
    return `${clip(d.text)} (${where})`
  })

  return {
    month: f.month,
    month_label: mLabel,
    company: f.company,
    headline,
    wins,
    misses,
    decisions,
    asks: [],
    sources,
    through: f.book?.through ?? null,
  }
}

/** Nothing worth a notice: no numbers, no wins, no misses, no decisions. */
export function hasContent(s: BoardSections): boolean {
  return s.headline.length + s.wins.length + s.misses.length + s.decisions.length > 0
}

const bullets = (items: string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${empty}`)

/** The plain-text draft the exec edits, copies and sends. */
export function composeText(s: BoardSections, assistantName: string = ASSISTANT_NAME): string {
  const head = [`Board update: ${s.month_label}`]
  if (s.company) head.push(s.company)
  const coverage = s.sources.length
    ? `Figures come from ${joinWords(s.sources)}${s.through ? `, with the book through ${short(s.through)}` : ''}.`
    : 'No book, plan or QuickBooks numbers are connected yet, so there are no figures.'
  const out = [
    head.join('\n'),
    `Headline numbers\n${bullets(s.headline.map((h) => h.text), 'No numbers for this month yet.')}`,
    `Wins\n${bullets(s.wins, 'Add your wins.')}`,
    `Misses\n${bullets(s.misses, 'No misses found in the numbers, goals or board.')}`,
    `Decisions\n${bullets(s.decisions, 'No decisions were logged in meetings this month.')}`,
    `Asks\n${bullets(s.asks, 'Add what you need from the board.')}`,
    `${coverage} ${assistantName} drafted this. Check it before you send it.`,
  ]
  return out.join('\n\n').slice(0, MAX_BODY)
}

function joinWords(a: string[]): string {
  if (a.length <= 1) return a.join('')
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`
}

/** On regenerate, keep the exec's own edits unless they asked for a fresh copy. */
export function nextBody(current: { body: string; edited: boolean } | null, draftText: string, keepEdits = true): { body: string; edited: boolean } {
  if (current && current.edited && keepEdits && current.body.trim()) return { body: current.body, edited: true }
  return { body: draftText, edited: false }
}

export function cleanBody(raw: unknown): string {
  return String(raw ?? '').replace(/\r\n/g, '\n').slice(0, MAX_BODY)
}

export function noticeText(s: BoardSections, assistantName: string = ASSISTANT_NAME): { title: string; body: string } {
  const name = assistantName
  const lines = s.headline.slice(0, 2).map((h) => h.text)
  return {
    title: `Your board update for ${s.month_label} is drafted`,
    body: [
      `${name} drafted it from ${s.sources.length ? joinWords(s.sources) : 'your goals, board and meetings'}. Edit it, copy it and send it yourself. ${name} never sends it.`,
      ...lines,
    ].join('\n'),
  }
}
