/**
 * Wrap Up Each Person's Day (Suite CXO), the pure part. The evening twin of
 * the morning brief: what got done, what slips to tomorrow (one tap moves it),
 * replies still owed, and tomorrow's first meeting. Built from the same reads
 * as Today (lib/today) and the daily queue (lib/mira/dailyQueue). No model,
 * no numbers from anywhere but these rows.
 */
import { DAY_WRAP_PREFIX, dayWord as dayWordFor } from '@/lib/followups/noticeActionsShared'
import { localParts } from '@/lib/followups/shared'

/** Default wrap hour (local) when the person has not set working hours. */
export const DEFAULT_WRAP_HOUR = 17
/** How long after the wrap hour it may still go out (a late worker still lands it the same evening). */
export const WRAP_WINDOW_HOURS = 3
/** Most to-dos one "move" tap carries. */
export const MAX_MOVE = 20

type Settings = { settings?: unknown }
const settingsOf = (m: Settings): Record<string, unknown> => (m.settings && typeof m.settings === 'object' ? (m.settings as Record<string, unknown>) : {})

/**
 * When their day ends: an hour before the end of their own working hours if
 * they set them, else 5pm. Days: their work days, else Monday to Friday.
 */
export function wrapSchedule(m: Settings): { hour: number; days: number[] } {
  const w = settingsOf(m).work_hours as { start?: unknown; end?: unknown; days?: unknown } | undefined
  const start = Number.isInteger(w?.start) ? (w!.start as number) : 9
  const end = Number.isInteger(w?.end) && (w!.end as number) >= 1 && (w!.end as number) <= 24 && (w!.end as number) > start ? (w!.end as number) : null
  const days =
    Array.isArray(w?.days) && (w!.days as unknown[]).length && (w!.days as unknown[]).every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      ? (w!.days as number[])
      : [1, 2, 3, 4, 5]
  const hour = end == null ? DEFAULT_WRAP_HOUR : Math.max(start + 1, end - 1)
  return { hour: Math.min(hour, 23), days }
}

/** True in the few hours after their wrap hour, on one of their work days. */
export function isWrapTime(m: Settings, tz: string, now: Date): boolean {
  const { hour, days } = wrapSchedule(m)
  const p = localParts(now, tz)
  return days.includes(p.weekday) && p.hour >= hour && p.hour < hour + WRAP_WINDOW_HOURS
}

/** Their next work day after `day` (YYYY-MM-DD). */
export function nextWorkDay(day: string, days: number[]): string {
  const base = Date.parse(day + 'T12:00:00Z')
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base + i * 86_400_000)
    if (!days.length || days.includes(d.getUTCDay())) return d.toISOString().slice(0, 10)
  }
  return new Date(base + 86_400_000).toISOString().slice(0, 10)
}

/** One wrap per person per day: the notice key is the lock. */
export const wrapKey = (day: string, memberId: string) => `${DAY_WRAP_PREFIX}${day}-${memberId}`

export type WrapTodo = { id: string; body: string; done_at: string | null; due_date: string | null }
export type WrapOwed = { from: string; kind: string }
export type WrapMeeting = { title: string; start: string; allDay: boolean }

export type WrapInput = {
  day: string
  tz: string
  /** Their to-dos (open, and done in the last 18 hours), as lib/today.listTodos gives them. */
  todos: WrapTodo[]
  /** In-app messages to them, unread, that want an answer. */
  owed: WrapOwed[]
  /** Emails in their own mailbox needing a reply. Null when not shown (no mailbox, or not the Pinnacle edition). */
  mailOwed: number | null
  /** Their meetings over the next couple of days. */
  meetings: WrapMeeting[]
  nextDay: string
}

export type Wrap = { title: string; body: string; moveIds: string[] }

const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()
const oneLine = (s: string, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const list = (xs: string[], max = 3) => (xs.length <= max ? xs.join('; ') : `${xs.slice(0, max).join('; ')} and ${xs.length - max} more`)

/** What got done today (local day), and what is due today or earlier and still open. */
export function sortTodos(todos: WrapTodo[], day: string, tz: string): { done: WrapTodo[]; slipping: WrapTodo[] } {
  const done = todos.filter((t) => t.done_at && dayOf(t.done_at, tz) === day)
  const slipping = todos.filter((t) => !t.done_at && !!t.due_date && t.due_date.slice(0, 10) <= day)
  return { done, slipping }
}

/** The first timed meeting on `nextDay`. */
export function firstMeetingOn(meetings: WrapMeeting[], nextDay: string, tz: string): WrapMeeting | null {
  return meetings.filter((m) => !m.allDay && dayOf(m.start, tz) === nextDay).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null
}

/**
 * The wrap, or null when there is nothing to say. Tomorrow's meeting alone is
 * not a reason to write: it rides along with something they did or still owe.
 */
export function composeWrap(x: WrapInput): Wrap | null {
  const { done, slipping } = sortTodos(x.todos, x.day, x.tz)
  const mail = x.mailOwed ?? 0
  if (!done.length && !slipping.length && !x.owed.length && mail <= 0) return null

  const lines: string[] = []
  if (done.length) lines.push(`Done today: ${plural(done.length, 'to-do')} (${list(done.map((t) => oneLine(t.body, 60)))}).`)
  const moveIds = slipping.slice(0, MAX_MOVE).map((t) => t.id)
  if (slipping.length) {
    const when = x.nextDay ? dayWordFor(x.day, x.nextDay) : 'tomorrow'
    lines.push(`Slips to ${when}: ${plural(slipping.length, 'to-do')} still open (${list(slipping.map((t) => oneLine(t.body, 60)))}). Tap to move ${slipping.length === 1 ? 'it' : 'them'} to ${when}.`)
  }
  if (x.owed.length) {
    const who = [...new Set(x.owed.map((o) => o.from))]
    lines.push(`Replies owed: ${plural(x.owed.length, 'message')} from ${list(who, 3)}.`)
  }
  if (mail > 0) lines.push(`Email: ${plural(mail, 'email')} in your inbox still need${mail === 1 ? 's' : ''} a reply.`)
  const first = firstMeetingOn(x.meetings, x.nextDay, x.tz)
  if (first) lines.push(`First meeting ${dayWordFor(x.day, x.nextDay)}: ${oneLine(first.title, 80)} at ${timeOf(first.start, x.tz)}.`)

  const bits: string[] = []
  if (done.length) bits.push(`${done.length} done`)
  if (slipping.length) bits.push(`${slipping.length} to move`)
  if (x.owed.length + mail > 0) bits.push(`${x.owed.length + mail} ${x.owed.length + mail === 1 ? 'reply' : 'replies'} owed`)
  return { title: `Your day: ${bits.join(', ')}`, body: lines.join('\n'), moveIds }
}

