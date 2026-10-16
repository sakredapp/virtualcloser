// Pure scheduling + idempotency logic for the weekly Ciao learnings pass.
// No DB, no AI: unit-tested in __tests__/cxo/weeklyLearningsSchedule.spec.ts.
//
// Rule: once per tenant member per ISO week (tenant-local), and only from
// Monday RUN_LOCAL_HOUR (7am) local onward. A worker that was down at 7am on
// Monday catches up on its next check later that week.

export const RUN_LOCAL_HOUR = 7
export const WEEKLY_LEARNINGS_JOB = 'ciao-weekly-learnings'
export const DEFAULT_TZ = 'America/New_York'
/** Marker id used for the tenant-level outcome pass (no member). */
export const TENANT_MARKER = 'tenant'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type LocalParts = { year: number; month: number; day: number; hour: number; weekday: number } // weekday 1=Mon..7=Sun

export function localParts(now: Date, tz: string | null | undefined): LocalParts {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = fmt(tz || DEFAULT_TZ)
  } catch {
    parts = fmt('UTC')
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = Number(get('hour')) % 24 // some engines render midnight as "24"
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    weekday: WEEKDAYS.indexOf(get('weekday') as (typeof WEEKDAYS)[number]) + 1,
  }
}

/** ISO-8601 week key ("2026-W42") of the tenant-local calendar date. */
export function isoWeekKey(now: Date, tz: string | null | undefined): string {
  const p = localParts(now, tz)
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day))
  // Thursday of this ISO week decides the ISO year.
  d.setUTCDate(d.getUTCDate() + 4 - p.weekday)
  const isoYear = d.getUTCFullYear()
  const jan1 = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

/** True from Monday 7am tenant-local through Sunday night (the ISO week's run window). */
export function isInWeeklyRunWindow(now: Date, tz: string | null | undefined): boolean {
  const p = localParts(now, tz)
  return !(p.weekday === 1 && p.hour < RUN_LOCAL_HOUR)
}

export function markerKey(repId: string, memberId: string | null, week: string): string {
  return `${repId}:${memberId ?? TENANT_MARKER}:${week}`
}

/** Builds the set of done keys from job_runs.meta rows ({rep_id, member_id, week}). */
export function doneKeysFromRuns(rows: Array<{ meta: unknown; ok?: boolean | null }>): Set<string> {
  const keys = new Set<string>()
  for (const r of rows) {
    if (r.ok === false) continue
    const m = (r.meta ?? {}) as Record<string, unknown>
    if (typeof m.rep_id !== 'string' || typeof m.week !== 'string') continue
    const memberId = typeof m.member_id === 'string' ? m.member_id : null
    keys.add(markerKey(m.rep_id, memberId, m.week))
  }
  return keys
}

export type LearningMember = {
  id: string
  role: string
  is_active: boolean
  settings?: unknown
}

export const MIN_HISTORY_TURNS = 6

export function memberHistory(m: LearningMember): Array<{ role: string; content: string }> {
  const h = (m.settings as Record<string, unknown> | null | undefined)?.agent_history
  return Array.isArray(h) ? (h as Array<{ role: string; content: string }>) : []
}

/**
 * Active owners/admins of a tenant who still need this week's pass and have a
 * real conversation to mine (members with a short history cost nothing to
 * skip, so they are not marked and simply get re-checked).
 */
export function dueMembers<M extends LearningMember>(
  repId: string,
  members: M[],
  week: string,
  done: Set<string>,
): M[] {
  return members.filter(
    (m) =>
      m.is_active &&
      (m.role === 'owner' || m.role === 'admin') &&
      !done.has(markerKey(repId, m.id, week)) &&
      memberHistory(m).filter((h) => h && typeof h.content === 'string').length >= MIN_HISTORY_TURNS,
  )
}
