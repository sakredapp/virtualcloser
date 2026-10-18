/**
 * Timed to-do reminders (QA gap 9, 2026-10-18): "remind me at 2:30 to call
 * Dana" and "remind me every Monday at 9 to send the numbers" ping the person
 * at that minute through the app's notice path (cxo_followup_notices, plus
 * email when they turned it on), not at the 4pm wrap.
 *
 * Pure: reading the time Ciao passes, the next time a repeating reminder
 * fires, and the notice key. The worker side is lib/todoReminders.
 */

import { localToUtcMs, zoneOffsetMinutes } from '@/lib/cxoFreeTime'
import { TODO_REMIND_PREFIX } from '@/lib/followups/noticeActionsShared'

/** Notice key prefix; on the always-shown list, so it shows whether or not the employee-ops switch is on. */
export { TODO_REMIND_PREFIX }

export const REMIND_RULES = ['daily', 'weekdays', 'weekly'] as const
export type RemindRule = (typeof REMIND_RULES)[number]

export function asRemindRule(v: unknown): RemindRule | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (REMIND_RULES as readonly string[]).includes(s) ? (s as RemindRule) : null
}

/** A reminder this far in the past is refused (it would fire at once as if late). */
const PAST_GRACE_MS = 2 * 60_000

/**
 * The time Ciao passed → a UTC ISO instant. Takes an ISO with an offset
 * ("2026-10-19T09:00:00-04:00"), or a local wall time with no offset
 * ("2026-10-19T09:00", read in the person's timezone).
 */
export function parseRemindAt(raw: unknown, tz: string, nowMs: number): { iso: string } | { error: string } | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  let ms: number
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s)
  if (local) {
    ms = localToUtcMs(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]), tz)
  } else if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    ms = Date.parse(s)
  } else {
    return { error: 'remind_at must be a date and time, like 2026-10-19T09:00' }
  }
  if (!Number.isFinite(ms)) return { error: 'remind_at is not a real time' }
  if (ms < nowMs - PAST_GRACE_MS) return { error: 'that time has already passed' }
  return { iso: new Date(ms).toISOString() }
}

function localParts(ms: number, tz: string): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  const local = new Date(ms + zoneOffsetMinutes(new Date(ms), tz) * 60_000)
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), hh: local.getUTCHours(), mm: local.getUTCMinutes(), dow: local.getUTCDay() }
}

/**
 * The next time a repeating reminder fires after it just did: the same wall
 * clock time in their timezone (so 9:00 stays 9:00 across a clock change),
 * one day / one weekday / one week on, and always after now.
 */
export function nextRemindAt(prevIso: string, rule: RemindRule, tz: string, nowMs: number): string {
  const prev = Date.parse(prevIso)
  const p = localParts(prev, tz)
  let dayMs = Date.UTC(p.y, p.m - 1, p.d)
  for (let i = 0; i < 800; i++) {
    dayMs += (rule === 'weekly' ? 7 : 1) * 86_400_000
    const d = new Date(dayMs)
    const dow = d.getUTCDay()
    if (rule === 'weekdays' && (dow === 0 || dow === 6)) continue
    const at = localToUtcMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), p.hh, p.mm, tz)
    if (at > nowMs) return new Date(at).toISOString()
  }
  return new Date(nowMs + 86_400_000).toISOString()
}

/** One notice per to-do per firing time: the worker can run twice and nobody is pinged twice. */
export function remindKey(todoId: string, remindAtIso: string): string {
  return `${TODO_REMIND_PREFIX}${todoId}-${remindAtIso.slice(0, 16)}`
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Mon Oct 19, 9:00 AM" in their timezone, plus "every Monday" for a repeat. */
export function remindLabel(iso: string, tz: string, rule: RemindRule | null): string {
  const when = new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (!rule) return when
  const time = new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  const every = rule === 'daily' ? 'every day' : rule === 'weekdays' ? 'every weekday' : `every ${DAY[localParts(Date.parse(iso), tz).dow]}`
  return `${every} at ${time}, starting ${when}`
}
