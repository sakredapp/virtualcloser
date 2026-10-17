/**
 * One-tap actions on Ciao's in-app notices (cxo_followup_notices). Pure and
 * client-safe: the Messages card and the employee page ask actionsFor() which
 * buttons a notice gets, and the server (lib/followups/noticeActions) checks
 * the same key before it does anything.
 *
 * Notices have no payload column, so a notice that carries an action says so
 * by its key prefix; item_id holds the ids the action works on and due_date
 * the day it moves things to.
 */

/** "Wrap up your day" (lib/mira/dayWrap). item_id = to-do ids joined by '|'. due_date = the next work day. */
export const DAY_WRAP_PREFIX = 'daywrap-'

/** Key prefixes that show whether or not the company's employee-ops switch is on. */
export const ALWAYS_SHOWN_PREFIXES = [DAY_WRAP_PREFIX] as const

export type NoticeActionName = 'move_tomorrow'
export type NoticeAction = { action: NoticeActionName; label: string }
export type ActionableNotice = { key?: string | null; item_id?: string | null; due_date?: string | null }

const ID_SEP = '|'
export const joinIds = (ids: string[]) => ids.filter(Boolean).join(ID_SEP)
export const splitIds = (s: string | null | undefined) => String(s ?? '').split(ID_SEP).map((x) => x.trim()).filter(Boolean)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "tomorrow", or the weekday name when the next work day is further out. `from` and `to` are YYYY-MM-DD. */
export function dayWord(from: string, to: string): string {
  const gap = Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86_400_000)
  if (gap === 1) return 'tomorrow'
  return WEEKDAYS[new Date(to + 'T12:00:00Z').getUTCDay()] ?? 'tomorrow'
}

/** The buttons a notice gets, beyond Open / Got it. */
export function actionsFor(n: ActionableNotice, today?: string): NoticeAction[] {
  const key = String(n.key ?? '')
  if (key.startsWith(DAY_WRAP_PREFIX) && splitIds(n.item_id).length && n.due_date) {
    const day = key.slice(DAY_WRAP_PREFIX.length, DAY_WRAP_PREFIX.length + 10)
    const from = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today
    return [{ action: 'move_tomorrow', label: `Move to ${from ? dayWord(from, n.due_date) : 'tomorrow'}` }]
  }
  return []
}
