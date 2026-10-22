/**
 * The public demo's clock. "Today" is the real date (UTC day), so the demo is
 * never stuck on the day it was built; the rail clock is held at 9:14am
 * Central so the morning view always reads the same way. Everything else on
 * the demo (the week, meeting dates, report windows) counts from here.
 */
export const DAY_MS = 86_400_000

const now = new Date()
/** Midnight UTC of today. */
export const DEMO_DAY = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
/** 9:14am Central (UTC-5) today. */
export const DEMO_NOW = new Date(DEMO_DAY + 14 * 3_600_000 + 14 * 60_000)

export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
export const TODAY = isoDay(DEMO_DAY)
export const dayOffset = (n: number) => DEMO_DAY + n * DAY_MS
/** The same day `n` months back (clamped to the month's last day). */
export function monthsBack(n: number, t = DEMO_DAY): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() - n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last))
}

const fmt = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', ...o })
/** "Thursday, October 22" */
export const longDay = (t: number) => fmt(t, { weekday: 'long', month: 'long', day: 'numeric' })
/** "Thu, Oct 22" */
export const shortDay = (t: number) => fmt(t, { weekday: 'short', month: 'short', day: 'numeric' })
/** "Oct 22, 2026" */
export const shortDate = (t: number) => fmt(t, { month: 'short', day: 'numeric', year: 'numeric' })
/** "October 22, 2026" */
export const fullDate = (t: number) => fmt(t, { month: 'long', day: 'numeric', year: 'numeric' })

/** Monday-first index of today (Mon = 0 … Sun = 6). */
export const TODAY_IDX = (new Date(DEMO_DAY).getUTCDay() + 6) % 7
/** The seven days of this week, Monday first, as UTC midnights. */
export const WEEK = Array.from({ length: 7 }, (_, i) => dayOffset(i - TODAY_IDX))
/** "October 19 – 25, 2026", or "September 28 – October 4, 2026" across a month end. */
export function weekLabel(): string {
  const a = new Date(WEEK[0])
  const b = new Date(WEEK[6])
  const month = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' })
  const end = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${month(b)} ${b.getUTCDate()}`
  return `${month(a)} ${a.getUTCDate()} – ${end}, ${b.getUTCFullYear()}`
}
