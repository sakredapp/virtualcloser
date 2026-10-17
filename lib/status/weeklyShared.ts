/**
 * Weekly status update (Suite CXO, Ciao): the pure half. No DB, no model.
 *
 *  - When: the Friday ask goes out from ASK_HOUR in the person's own time
 *    zone; the Monday rollup from ROLLUP_HOUR in the company's.
 *  - Prefill: what they moved (to-dos done, board cards closed, meetings),
 *    what is next (open to-dos and cards, soonest due first) and what may be
 *    blocking them (requests they sent that nobody has answered). Always from
 *    their own rows, never written by a model.
 *  - Rollup: one notice for each exec, blockers first, then each team.
 *
 * Client-safe: the status card on Today and the employee page imports it.
 */
import { isoWeekKey, localParts } from '@/lib/agent/weeklyLearningsSchedule'
import { ASSISTANT_NAME } from '@/lib/assistantName'

import { WEEKLY_ROLLUP_NOTICE_PREFIX, WEEKLY_STATUS_NOTICE_PREFIX } from '@/lib/followups/noticeActionsShared'

export const WEEKLY_STATUS_PREFIX = WEEKLY_STATUS_NOTICE_PREFIX
export const WEEKLY_ROLLUP_PREFIX = WEEKLY_ROLLUP_NOTICE_PREFIX
export const WEEKLY_ROLLUP_ROLES = ['owner', 'admin'] as const
/** Friday, from 2pm in the person's own zone. */
export const ASK_WEEKDAY = 5
export const ASK_HOUR = 14
/** Monday, from 8am in the company's zone. */
export const ROLLUP_WEEKDAY = 1
export const ROLLUP_HOUR = 8

export const MAX_MOVED = 8
export const MAX_NEXT = 5
export const MAX_BLOCKERS = 4
export const MAX_LINES = 10
export const MAX_LINE = 300

export type StatusLines = { moved: string[]; next: string[]; blockers: string[] }

export { isoWeekKey }

export const statusKey = (week: string, memberId: string) => `${WEEKLY_STATUS_PREFIX}${week}-${memberId}`
export const rollupKey = (week: string, memberId: string) => `${WEEKLY_ROLLUP_PREFIX}${week}-${memberId}`

export function isAskTime(now: Date, tz: string | null | undefined): boolean {
  const p = localParts(now, tz)
  return p.weekday === ASK_WEEKDAY && p.hour >= ASK_HOUR
}

export function isRollupTime(now: Date, tz: string | null | undefined): boolean {
  const p = localParts(now, tz)
  return p.weekday === ROLLUP_WEEKDAY && p.hour >= ROLLUP_HOUR
}

/** The ISO week that just ended (the one a Monday rollup covers). */
export function lastWeekKey(now: Date, tz: string | null | undefined): string {
  return isoWeekKey(new Date(now.getTime() - 7 * 86_400_000), tz)
}

/** Minutes the zone is ahead of UTC at this instant. */
function zoneOffsetMin(at: Date, tz: string): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(at)
  } catch {
    return 0
  }
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** Monday 00:00 of this week in the zone, as an ISO instant. */
export function weekStartIso(now: Date, tz: string | null | undefined): string {
  const zone = tz || 'America/New_York'
  const p = localParts(now, zone)
  const mondayUtc = Date.UTC(p.year, p.month - 1, p.day - (p.weekday - 1))
  let t = mondayUtc - zoneOffsetMin(new Date(mondayUtc), zone) * 60_000
  t = mondayUtc - zoneOffsetMin(new Date(t), zone) * 60_000 // settle across a DST change
  return new Date(t).toISOString()
}

const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE)

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

export type PrefillInput = {
  doneTodos: Array<{ body: string }>
  doneCards: Array<{ title: string }>
  meetings: Array<{ title: string | null }>
  openTodos: Array<{ body: string; due_date: string | null; priority?: string | null }>
  openCards: Array<{ title: string; due_date: string | null }>
  /** Requests they sent that nobody has answered yet. */
  waitingOn: Array<{ to: string; body: string }>
}

const dueRank = (d: string | null) => d ?? '9999-12-31'

/** Ciao's draft of their week, from their own rows. */
export function composePrefill(x: PrefillInput): StatusLines {
  const met = x.meetings.map((m) => (m.title ? `Met: ${m.title}` : '')).filter(Boolean)
  const moved = uniq([...x.doneTodos.map((t) => t.body), ...x.doneCards.map((c) => c.title), ...met], MAX_MOVED)
  const next = uniq(
    [
      ...x.openTodos.map((t) => ({ text: t.body, due: dueRank(t.due_date), high: t.priority === 'high' ? 0 : 1 })),
      ...x.openCards.map((c) => ({ text: c.title, due: dueRank(c.due_date), high: 1 })),
    ]
      .sort((a, b) => a.due.localeCompare(b.due) || a.high - b.high)
      .map((n) => n.text),
    MAX_NEXT,
  )
  const blockers = uniq(x.waitingOn.map((w) => `Waiting on ${w.to}: ${w.body}`), MAX_BLOCKERS)
  return { moved, next, blockers }
}

export const isEmpty = (s: StatusLines) => !s.moved.length && !s.next.length && !s.blockers.length

/** A person's edit: an array of lines or one block of text, one item per line. */
export function cleanLines(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : []
  return uniq(raw.map((l) => String(l ?? '').replace(/^\s*[-*•]\s*/, '')), MAX_LINES)
}

export function cleanStatus(v: unknown): StatusLines {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { moved: cleanLines(o.moved), next: cleanLines(o.next), blockers: cleanLines(o.blockers) }
}

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n')

/** The Friday ask. */
export function askNoticeText(p: StatusLines): { title: string; body: string } {
  if (isEmpty(p)) {
    return { title: 'Your weekly status: what did you move this week?', body: 'Add what you moved, what is next and anything blocking you. It goes in the Monday rollup.' }
  }
  const parts: string[] = []
  if (p.moved.length) parts.push(`Moved\n${bullets(p.moved)}`)
  if (p.next.length) parts.push(`Next\n${bullets(p.next)}`)
  parts.push(p.blockers.length ? `Blocking you?\n${bullets(p.blockers)}` : 'Blocking you?\n- Nothing I can see')
  return { title: 'Your weekly status is drafted. Does it look right?', body: `${parts.join('\n\n')}\n\nTap Looks right to send it to the Monday rollup, or open it to edit.` }
}

export type RollupPerson = { name: string; team: string } & StatusLines & { confirmed: boolean }

/** "W42" → "the week of Oct 12" is nicer, but a week key is exact; keep the key short. */
const weekLabel = (week: string) => week.replace(/^\d{4}-/, '')

/** The Monday rollup for an exec: blockers first, then each team. Null when nobody has a status. */
export function composeRollup(week: string, people: RollupPerson[]): { title: string; body: string } | null {
  const withAny = people.filter((p) => !isEmpty(p))
  if (!withAny.length) return null
  const byName = (a: RollupPerson, b: RollupPerson) => a.name.localeCompare(b.name)
  const blocked = withAny.filter((p) => p.blockers.length).sort((a, b) => a.team.localeCompare(b.team) || byName(a, b))
  const parts: string[] = []
  if (blocked.length) {
    parts.push(`Blockers\n${blocked.flatMap((p) => p.blockers.map((b) => `- ${p.name} (${p.team}): ${b}`)).join('\n')}`)
  }
  const teams = [...new Set(withAny.map((p) => p.team))].sort((a, b) => {
    const ab = withAny.some((p) => p.team === a && p.blockers.length) ? 0 : 1
    const bb = withAny.some((p) => p.team === b && p.blockers.length) ? 0 : 1
    return ab - bb || a.localeCompare(b)
  })
  for (const team of teams) {
    const lines: string[] = []
    for (const p of withAny.filter((x) => x.team === team).sort((a, b) => (b.blockers.length ? 1 : 0) - (a.blockers.length ? 1 : 0) || byName(a, b))) {
      const bits: string[] = []
      if (p.moved.length) bits.push(`moved ${p.moved.slice(0, 3).join('; ')}${p.moved.length > 3 ? ` (+${p.moved.length - 3})` : ''}`)
      if (p.next.length) bits.push(`next ${p.next.slice(0, 2).join('; ')}`)
      lines.push(`- ${p.name}${p.confirmed ? '' : ' (not confirmed)'}: ${bits.join('. ') || 'only blockers'}`)
    }
    parts.push(`${team}\n${lines.join('\n')}`)
  }
  const unconfirmed = withAny.filter((p) => !p.confirmed).length
  const blockerCount = blocked.reduce((n, p) => n + p.blockers.length, 0)
  const head = blockerCount ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}` : 'no blockers'
  return {
    title: `Weekly status ${weekLabel(week)}: ${withAny.length} ${withAny.length === 1 ? 'person' : 'people'}, ${head}`,
    body: `${parts.join('\n\n')}${unconfirmed ? `\n\n${unconfirmed} not confirmed: that is ${ASSISTANT_NAME}'s draft from their to-dos, cards and meetings.` : ''}`,
  }
}

export type TeamFacts = { department: string | null; manager: string | null }

export function teamName(f: TeamFacts | undefined): string {
  const dept = (f?.department ?? '').trim()
  if (dept) return dept
  const mgr = (f?.manager ?? '').trim()
  return mgr ? `${mgr}'s team` : 'No team set'
}
