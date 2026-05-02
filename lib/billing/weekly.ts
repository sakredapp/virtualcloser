// Weekly billing cycle helpers.
//
// Anchor: every Monday 00:00 UTC. Cash collected upfront on the cycle date.
// ISO week format: 'YYYY-Www' (e.g. '2026-W18'). UTC throughout — never use
// the host's local timezone for billing math.

export const SECONDS_PER_HOUR = 3600
export const HOUR_BUFFER = 1 // 1 reserved hour every pack — see catalog.ts

export type WeekBounds = {
  isoWeek: string         // '2026-W18'
  weekStart: Date         // Monday 00:00 UTC
  weekEnd: Date           // next Monday 00:00 UTC (exclusive)
}

/** Return the Monday-anchored week containing the given UTC date. */
export function weekBoundsForDate(d: Date = new Date()): WeekBounds {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // getUTCDay: 0=Sun..6=Sat. Shift so Monday=0.
  const dow = (utc.getUTCDay() + 6) % 7
  const weekStart = new Date(utc.getTime() - dow * 24 * 60 * 60 * 1000)
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { isoWeek: isoWeekString(weekStart), weekStart, weekEnd }
}

export function nextMondayUTC(after: Date = new Date()): Date {
  const { weekEnd } = weekBoundsForDate(after)
  return weekEnd
}

export function isoWeekString(d: Date): string {
  // ISO 8601 week number. Implementation reference:
  // https://en.wikipedia.org/wiki/ISO_week_date#Calculating_the_week_number_from_an_ordinal_date
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (t.getUTCDay() + 6) % 7              // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - dow + 3)            // Thursday of the same ISO week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** Unix seconds for the next Monday 00:00 UTC after `from`. Used as
 *  Stripe `billing_cycle_anchor`. */
export function billingCycleAnchorEpoch(from: Date = new Date()): number {
  return Math.floor(nextMondayUTC(from).getTime() / 1000)
}
