/**
 * Prep the Leadership Meeting Agenda (Suite CXO, Ciao): the pure half. No DB,
 * no model. Shared by the Hetzner tick and Ciao's leadership_agenda tool
 * (lib/meetings/agenda), and by the agenda card on Today (client-safe).
 *
 *  - Which meeting: a recurring series on the execs' own calendars whose
 *    title reads like a leadership meeting (leadership, exec, staff, L10,
 *    management...), or, failing that, the recurring series with the most
 *    leaders on it. A series an exec marked through Ciao always wins; one
 *    they said is not it is never picked.
 *  - When: about 24 hours before it starts; when it was booked later than
 *    that, as soon as it is found (not before 7am their time).
 *  - What: the numbers that moved, decisions still owed from last time,
 *    overdue commitments by owner, blockers from the weekly status, and what
 *    people asked to raise. Every line comes from rows; a model never writes it.
 *  - The invite: the agenda goes in the invite notes between two marker lines,
 *    replacing an earlier copy, and only after an exec says yes.
 */
import { localParts } from '@/lib/agent/weeklyLearningsSchedule'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { AGENDA_NOTICE_PREFIX, agendaInvitePrompt } from '@/lib/followups/noticeActionsShared'

export const AGENDA_PREFIX = AGENDA_NOTICE_PREFIX
/** Who gets the draft and may edit it: the owner and admins. */
export const AGENDA_ROLES = ['owner', 'admin'] as const
/** Who counts as a leader when a series is picked by who is on it. */
export const LEADER_ROLES = ['owner', 'admin', 'manager'] as const
export const DRAFT_HOURS_BEFORE = 24
export const EARLIEST_LOCAL_HOUR = 7
/** Within this long of the start, draft even before EARLIEST_LOCAL_HOUR. */
export const LAST_CALL_MIN = 120
export const LOOKAHEAD_DAYS = 8
/** A series picked by who is on it needs at least this many leaders. */
export const MIN_LEADERS = 3
export const MAX_TITLE_SERIES = 2
export const MAX_MARKED_SERIES = 3
export const AGENDA_ANCHOR = 'leadership-agenda'

export const MAX_NUMBERS = 5
export const MAX_OWED = 6
export const MAX_OVERDUE_OWNERS = 8
export const MAX_OVERDUE_EACH = 3
export const MAX_BLOCKERS = 6
export const MAX_RAISED = 8
export const MAX_LINE = 240
export const MAX_BODY = 6000

export const INVITE_START = '[Agenda]'
export const INVITE_END = '[End of agenda]'

const LEADERSHIP_RE = /\b(leadership|leaders|exec|execs|executive|executives|exco|staff meeting|staff sync|weekly staff|l10|level 10|management|mgmt|slt|elt|senior team|operating review|ops review|business review|wbr|mbr|qbr)\b/i
const ONE_ON_ONE_RE = /\b(1:1|1-1|1 on 1|one on one|one-on-one|1o1)\b/i

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const oneLine = (s: unknown, n = MAX_LINE) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

function uniq(lines: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of lines) {
    const l = oneLine(raw)
    const k = l.toLowerCase()
    if (!l || seen.has(k)) continue
    seen.add(k)
    out.push(l)
    if (out.length >= max) break
  }
  return out
}

export function titleLooksLeadership(title: string | null | undefined): boolean {
  const t = String(title ?? '')
  return LEADERSHIP_RE.test(t) && !ONE_ON_ONE_RE.test(t)
}

// ── Which meeting ───────────────────────────────────────────────────────────

export type SeriesEvent = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  attendees: Array<{ email: string; name?: string | null }>
  seriesId?: string | null
  organizer?: string | null
  notBusy?: boolean
}

export type SeriesMark = { series_id: string; choice: 'leadership' | 'not' | string }

export type SeriesCandidate = {
  seriesId: string
  title: string
  eventId: string
  start: string
  end: string
  organizer: string | null
  attendeeEmails: string[]
  leaders: number
  titleMatch: boolean
  marked: boolean
}

/** The next instance of every recurring, timed series with other people on it. */
export function recurringSeries(events: SeriesEvent[], leaderEmails: string[], now: Date, marks: SeriesMark[] = []): SeriesCandidate[] {
  const leaders = new Set(leaderEmails.map(lower).filter(Boolean))
  const marked = new Set(marks.filter((m) => m.choice === 'leadership').map((m) => m.series_id))
  const next = new Map<string, SeriesEvent>()
  for (const e of events) {
    if (!e.seriesId || e.allDay || !e.start || Date.parse(e.start) <= now.getTime()) continue
    const have = next.get(e.seriesId)
    if (!have || Date.parse(e.start) < Date.parse(have.start)) next.set(e.seriesId, e)
  }
  const out: SeriesCandidate[] = []
  for (const [seriesId, e] of next) {
    const emails = [...new Set([...e.attendees.map((a) => lower(a.email)), lower(e.organizer)].filter((x) => x && !x.endsWith('resource.calendar.google.com')))]
    out.push({
      seriesId,
      title: oneLine(e.title || 'Untitled meeting', 200),
      eventId: e.id,
      start: e.start,
      end: e.end,
      organizer: e.organizer ? lower(e.organizer) : null,
      attendeeEmails: emails,
      leaders: emails.filter((x) => leaders.has(x)).length,
      titleMatch: titleLooksLeadership(e.title),
      marked: marked.has(seriesId),
    })
  }
  return out.sort((a, b) => Number(b.marked) - Number(a.marked) || Number(b.titleMatch) - Number(a.titleMatch) || b.leaders - a.leaders || a.start.localeCompare(b.start))
}

/**
 * The leadership meeting(s) to prep. Marked series only, when any is on the
 * calendar; else series whose title reads like one (with at least three
 * people, or two leaders); else the single series with the most leaders.
 */
export function pickLeadershipSeries(input: { events: SeriesEvent[]; leaderEmails: string[]; marks: SeriesMark[]; now: Date }): SeriesCandidate[] {
  const not = new Set(input.marks.filter((m) => m.choice === 'not').map((m) => m.series_id))
  const all = recurringSeries(input.events, input.leaderEmails, input.now, input.marks).filter((c) => !not.has(c.seriesId))
  const marked = all.filter((c) => c.marked)
  if (marked.length) return marked.slice(0, MAX_MARKED_SERIES)
  const byTitle = all.filter((c) => c.titleMatch && (c.attendeeEmails.length >= 3 || c.leaders >= 2))
  if (byTitle.length) return byTitle.sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_TITLE_SERIES)
  const byPeople = all.filter((c) => c.leaders >= MIN_LEADERS && !ONE_ON_ONE_RE.test(c.title))
  return byPeople.length ? [byPeople[0]] : []
}

/** Is it time to draft this instance? About 24h before; a late booking as soon as it is found (from 7am). */
export function isDraftTime(startIso: string, now: Date, tz: string | null | undefined): boolean {
  const left = Date.parse(startIso) - now.getTime()
  if (!Number.isFinite(left) || left <= 0 || left > DRAFT_HOURS_BEFORE * 3_600_000) return false
  return localParts(now, tz).hour >= EARLIEST_LOCAL_HOUR || left <= LAST_CALL_MIN * 60_000
}

/** "Mon Oct 19, 9:00am" in the zone. */
export function startLabel(iso: string, tz: string | null | undefined): string {
  const zone = tz || 'America/New_York'
  try {
    const d = new Date(iso)
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(d)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase()
    return `${day}, ${time}`
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

/** YYYY-MM-DD of an instant in a zone. */
export function dayOf(iso: string, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/** Does a free-text ask ("Monday's leadership meeting", "the L10") point at this series? */
export function matchesAsk(c: Pick<SeriesCandidate, 'title' | 'start'>, ask: string | null | undefined, tz: string | null | undefined): boolean {
  const q = lower(ask)
  if (!q) return true
  const words = q.replace(/[^a-z0-9: ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'for', 'our', 'meeting', 'agenda', 'draft', 'next', 'this', 'week', 'weekly'].includes(w))
  if (!words.length) return true
  const weekday = (() => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'long' }).format(new Date(c.start)).toLowerCase()
    } catch {
      return ''
    }
  })()
  const title = lower(c.title)
  return words.some((w) => title.includes(w) || (weekday && weekday.startsWith(w.replace(/'?s$/, ''))))
}

// ── What goes on it ─────────────────────────────────────────────────────────

const OWED_RE = /\b(decide|deciding|decision|tbd|to be decided|undecided|revisit|open question|pending|parked|tabled?|sign[- ]?off|approve|approval|agree on|choose between|pick between|whether|go\/no[- ]go)\b/i

export type PriorDigest = {
  decisions?: unknown
  items?: unknown
  notes?: unknown
} | null | undefined

/** Decisions still owed from last time: digest lines that say a call is pending and were not decided. */
export function owedFromDigest(d: PriorDigest): string[] {
  if (!d || typeof d !== 'object') return []
  const decided = new Set((Array.isArray(d.decisions) ? d.decisions : []).map((x) => lower(x)))
  const out: string[] = []
  for (const it of Array.isArray(d.items) ? d.items : []) {
    const o = (it && typeof it === 'object' ? it : {}) as { text?: unknown; owner?: unknown }
    const text = oneLine(o.text)
    if (!text || decided.has(text.toLowerCase()) || !OWED_RE.test(text)) continue
    out.push(o.owner ? `${text} (${oneLine(o.owner, 60)})` : text)
  }
  for (const n of Array.isArray(d.notes) ? d.notes : []) {
    const text = oneLine(n)
    if (!text || decided.has(text.toLowerCase())) continue
    if (OWED_RE.test(text) || /\?\s*$/.test(text)) out.push(text)
  }
  return uniq(out, MAX_OWED)
}

export type OverdueTodo = { owner: string; body: string; due_date: string; meeting_title?: string | null }
export type OwnerOverdue = { owner: string; items: string[]; more: number }

const shortDate = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? ymd : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d)
}

/** Overdue meeting commitments grouped by owner, the longest-late owner first. */
export function overdueByOwner(todos: OverdueTodo[], today: string): OwnerOverdue[] {
  const late = todos.filter((t) => t.due_date && t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date))
  const groups = new Map<string, OverdueTodo[]>()
  for (const t of late) groups.set(t.owner, [...(groups.get(t.owner) ?? []), t])
  return [...groups.entries()]
    .sort((a, b) => a[1][0].due_date.localeCompare(b[1][0].due_date) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_OVERDUE_OWNERS)
    .map(([owner, ts]) => {
      const items = uniq(ts.map((t) => `${oneLine(t.body, 140)} (due ${shortDate(t.due_date)}${t.meeting_title ? `, from ${oneLine(t.meeting_title, 60)}` : ''})`), MAX_OVERDUE_EACH)
      return { owner, items, more: Math.max(0, ts.length - items.length) }
    })
}

const ASK_RE = /\b(agenda|leadership meeting|leadership sync|exec meeting|staff meeting|l10|bring (this|it|that) up|raise (this|it|that)|put (this|it|that) on|add (this|it|that) to (the )?(meeting|agenda)|discuss (this|it|that) (at|in) (the|our|monday'?s?|tuesday'?s?|wednesday'?s?|thursday'?s?|friday'?s?) )/i

/** A coworker message that asks for something to be raised at this meeting. */
export function asksForMeeting(body: string | null | undefined, seriesTitle: string | null | undefined): boolean {
  const b = String(body ?? '')
  if (!b.trim()) return false
  if (ASK_RE.test(b)) return true
  const t = lower(seriesTitle)
  return t.length >= 5 && b.toLowerCase().includes(t)
}

export type RaisedItem = { text: string; by: string | null; at?: string }

export function cleanRaised(v: unknown): RaisedItem[] {
  const arr = Array.isArray(v) ? v : []
  return arr
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ text: oneLine(x.text), by: x.by ? oneLine(x.by, 80) : null, ...(typeof x.at === 'string' ? { at: x.at } : {}) }))
    .filter((x) => x.text)
    .slice(0, 30)
}

export type AgendaSections = {
  numbers: string[]
  owed: string[]
  overdue: OwnerOverdue[]
  blockers: string[]
  raised: string[]
}

export const emptySections = (): AgendaSections => ({ numbers: [], owed: [], overdue: [], blockers: [], raised: [] })

export function cleanSections(x: Partial<AgendaSections>): AgendaSections {
  return {
    numbers: uniq(x.numbers ?? [], MAX_NUMBERS),
    owed: uniq(x.owed ?? [], MAX_OWED),
    overdue: (x.overdue ?? []).slice(0, MAX_OVERDUE_OWNERS),
    blockers: uniq(x.blockers ?? [], MAX_BLOCKERS),
    raised: uniq(x.raised ?? [], MAX_RAISED),
  }
}

export const sectionCount = (s: AgendaSections) => s.numbers.length + s.owed.length + s.overdue.length + s.blockers.length + s.raised.length

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n')

/** The agenda as plain text, one heading per non-empty part. Empty string when there is nothing. */
export function composeAgenda(s: AgendaSections): string {
  const parts: string[] = []
  if (s.numbers.length) parts.push(`Numbers that moved\n${bullets(s.numbers)}`)
  if (s.owed.length) parts.push(`Decisions still owed from last time\n${bullets(s.owed)}`)
  if (s.overdue.length) {
    parts.push(`Overdue commitments\n${s.overdue.map((o) => `- ${o.owner}: ${o.items.join('; ')}${o.more ? ` (+${o.more} more)` : ''}`).join('\n')}`)
  }
  if (s.blockers.length) parts.push(`Blockers from the weekly status\n${bullets(s.blockers)}`)
  if (s.raised.length) parts.push(`Asked to raise\n${bullets(s.raised)}`)
  return parts.join('\n\n').slice(0, MAX_BODY)
}

/** A person's edit: plain text, trimmed and capped. */
export function cleanBody(v: unknown): string {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY)
}

export const agendaNoticeKey = (agendaId: string, memberId: string) => `${AGENDA_PREFIX}${agendaId}-${memberId}`

export function agendaNoticeText(title: string, when: string, body: string): { title: string; body: string } {
  return {
    title: oneLine(`Agenda drafted for ${title}, ${when}`, 300),
    body: `${body}\n\nEdit it on Today. Tap Add to the invite when it is right. Nothing goes on the invite until you say yes.`.slice(0, 8000),
  }
}

export { agendaInvitePrompt }

const stripTags = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

/** The invite's notes with the agenda block in place: an earlier block is replaced, the rest kept. */
export function mergeIntoDescription(existing: string | null | undefined, agenda: string): string {
  let rest = stripTags(String(existing ?? ''))
  const s = rest.indexOf(INVITE_START)
  if (s >= 0) {
    const e = rest.indexOf(INVITE_END, s)
    rest = (rest.slice(0, s) + (e >= 0 ? rest.slice(e + INVITE_END.length) : '')).trim()
  }
  const block = `${INVITE_START}\n${agenda.trim()}\n${INVITE_END}`
  return (rest.trim() ? `${block}\n\n${rest.trim()}` : block).slice(0, 8000)
}

/** The agenda footnote with the viewer's name for the assistant. */
export function agendaFootnote(assistantName: string = ASSISTANT_NAME): string {
  return `${assistantName} drafted this from last meeting's notes, open to-dos, the weekly status and what people asked to raise.`
}

export const AGENDA_FOOTNOTE = agendaFootnote()
