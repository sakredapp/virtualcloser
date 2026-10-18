/**
 * What "this week" and "next week" mean, as real dates. Pure.
 *
 * Owner rule (10-18, after Ciao booked "next week" on Tue Oct 20 when asked
 * on Sunday Oct 18):
 *  - A week runs Sunday to Saturday; the work week is its Monday to Friday.
 *  - "This week" = Mon-Fri of the current week. On a Sunday that is the
 *    coming Mon-Fri (tomorrow onward).
 *  - "Next week" = Mon-Fri of the following week. On Sunday Oct 18 that is
 *    Mon Oct 26 to Fri Oct 30, never Oct 19-23.
 *  - On a Saturday the work week has ended: "this week" is the Mon-Fri just
 *    gone, "next week" the coming Mon-Fri.
 */

export type DayRange = { from: string; to: string }

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const DAY = 86_400_000

function parse(todayIso: string): number {
  const [y, m, d] = todayIso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Monday-to-Friday ranges (inclusive local dates) for this week and next week. */
export function weekRanges(todayIso: string): { thisWeek: DayRange; nextWeek: DayRange; weekday: number } {
  const t = parse(todayIso)
  const wd = new Date(t).getUTCDay() // 0 = Sunday
  const sunday = t - wd * DAY
  const mon = sunday + DAY
  return {
    weekday: wd,
    thisWeek: { from: iso(mon), to: iso(mon + 4 * DAY) },
    nextWeek: { from: iso(mon + 7 * DAY), to: iso(mon + 11 * DAY) },
  }
}

/** Number of calendar days in an inclusive range. */
export function daysIn(r: DayRange): number {
  return Math.round((parse(r.to) - parse(r.from)) / DAY) + 1
}

const label = (d: string) => new Date(parse(d) + 12 * 3_600_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** One prompt line that pins the words to dates. */
export function weekRuleLine(todayIso: string): string {
  const { thisWeek, nextWeek, weekday } = weekRanges(todayIso)
  const sundayNote = weekday === 0 ? ' Today is Sunday, so "this week" is the coming Mon-Fri.' : weekday === 6 ? ' Today is Saturday, so the work week is over; "next week" is the coming Mon-Fri.' : ''
  return (
    `Week words (fixed rule): "this week" = ${label(thisWeek.from)} to ${label(thisWeek.to)}; "next week" = ${label(nextWeek.from)} to ${label(nextWeek.to)} (${nextWeek.from} to ${nextWeek.to}).` +
    sundayNote +
    ' Use exactly these dates for calendar reads, free time and booking; never put a "next week" meeting inside "this week".'
  )
}
