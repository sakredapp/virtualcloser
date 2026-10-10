/**
 * Recurring reports, the pure part: when a job runs next, which kinds a
 * caller may set, and what the report says. No AI: a report is a plain list
 * built from the follow-up items. An empty report is never sent.
 */
import { groupByPerson, openItemsFor, type FollowItem, type FollowMember, type OpenRow } from '@/lib/followups/shared'
import { dueDateLabel } from '@/lib/dueRemindersShared'

export const REPORT_KINDS = ['open_by_person', 'overdue', 'waiting_on', 'my_open'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
/** Employees may only report on themselves. */
export const EMPLOYEE_REPORT_KINDS: ReadonlySet<ReportKind> = new Set(['waiting_on', 'my_open'])

export const REPORT_LABEL: Record<ReportKind, string> = {
  open_by_person: 'Open requests and to-dos by person',
  overdue: 'Overdue items by person',
  waiting_on: 'What you are waiting on',
  my_open: 'What you owe',
}

export function asReportKind(v: unknown): ReportKind | null {
  return (REPORT_KINDS as readonly string[]).includes(v as string) ? (v as ReportKind) : null
}

export type Cadence = 'daily' | 'weekly'
export type JobTiming = { cadence: Cadence; weekday: number | null; hour: number }

/** Offset (ms) of a time zone at an instant: local wall time minus UTC. */
function tzOffsetMs(at: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000
}

/** The UTC instant of a local wall time in a zone. */
export function zonedToUtcMs(y: number, mo: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h)
  let t = guess - tzOffsetMs(new Date(guess), tz)
  t = guess - tzOffsetMs(new Date(t), tz)
  return t
}

function safeTz(tz: string | null | undefined): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York' })
    return tz || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

/** Next run strictly after `after`, at `hour` local, on `weekday` (weekly) or Mon–Fri (daily). */
export function nextRunAt(job: JobTiming, tzIn: string | null | undefined, after: Date): Date {
  const tz = safeTz(tzIn)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(after)
  const [y, m, d] = day.split('-').map(Number)
  for (let i = 0; i <= 8; i++) {
    const base = new Date(Date.UTC(y, m - 1, d + i, 12))
    const at = zonedToUtcMs(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), job.hour, tz)
    if (at <= after.getTime()) continue
    if (job.cadence === 'weekly' && job.weekday !== null && base.getUTCDay() !== job.weekday) continue
    if (job.cadence === 'daily' && (base.getUTCDay() === 0 || base.getUTCDay() === 6)) continue
    return new Date(at)
  }
  return new Date(after.getTime() + 7 * 86_400_000)
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export function parseWeekday(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) return v
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  const i = WEEKDAYS.findIndex((w) => w.startsWith(s.slice(0, 3)))
  return i >= 0 ? i : null
}

export function timingWords(job: JobTiming): string {
  const h = job.hour % 12 === 0 ? 12 : job.hour % 12
  const time = `${h}${job.hour < 12 ? 'am' : 'pm'}`
  if (job.cadence === 'daily') return `every weekday at ${time}`
  const wd = WEEKDAYS[job.weekday ?? 1]
  return `every ${wd[0].toUpperCase()}${wd.slice(1)} at ${time}`
}

function line(r: OpenRow): string {
  const when = r.due ? (r.overdue ? `overdue since ${dueDateLabel(r.due)}` : `due ${dueDateLabel(r.due)}`) : 'no due date'
  return `${r.title} (${when}${r.asker ? `, asked by ${r.asker}` : ''})`
}

/**
 * The report text for one run, or null when there is nothing in it (no
 * empty sends). Company-wide kinds are only built when `companyWide`.
 */
export function buildReport(input: {
  kind: ReportKind
  items: FollowItem[]
  members: FollowMember[]
  memberId: string
  companyWide: boolean
  now: Date
  tz: string
}): { title: string; body: string; count: number } | null {
  const { kind } = input
  if ((kind === 'open_by_person' || kind === 'overdue') && !input.companyWide) return null
  const view = kind === 'open_by_person' ? 'company' : kind === 'overdue' ? 'overdue' : kind === 'waiting_on' ? 'waiting_on' : 'owed_by_me'
  const rows = openItemsFor({ items: input.items, members: input.members, memberId: input.memberId, view, now: input.now, tz: input.tz })
  if (!rows.length) return null
  let body: string
  if (kind === 'open_by_person' || kind === 'overdue') {
    body = groupByPerson(rows)
      .map((g) => `${g.person} (${g.rows.length})\n${g.rows.slice(0, 15).map((r) => `  - ${line(r)}`).join('\n')}${g.rows.length > 15 ? `\n  - and ${g.rows.length - 15} more` : ''}`)
      .join('\n\n')
  } else {
    body = rows.slice(0, 40).map((r) => `- ${kind === 'waiting_on' ? `${r.owes.join(', ')}: ` : ''}${line(r)}`).join('\n')
  }
  return { title: `${REPORT_LABEL[kind]}: ${rows.length}`, body: body.slice(0, 7900), count: rows.length }
}
