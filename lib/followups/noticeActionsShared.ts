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

/**
 * "Calendar conflicts" (lib/mira/calendarConflicts). Key = calconf-<kind>-<ref>-<member>.
 * item_id = the calendar event ids joined by '|'. The fix is a prepared ask to
 * Ciao, which proposes the exact change through the calendar tools and waits
 * for their yes before it moves, declines or edits anything.
 */
export const CAL_CONFLICT_PREFIX = 'calconf-'

/** Weekly status ask (lib/status/weekly). item_id = the cxo_weekly_status row. */
export const WEEKLY_STATUS_NOTICE_PREFIX = 'weekly-status-'
/** Monday rollup of everyone's weekly status, for the owner and admins. */
export const WEEKLY_ROLLUP_NOTICE_PREFIX = 'weekly-rollup-'

/** Key prefixes that show whether or not the company's employee-ops switch is on. */
export const ALWAYS_SHOWN_PREFIXES = [DAY_WRAP_PREFIX, CAL_CONFLICT_PREFIX, WEEKLY_STATUS_NOTICE_PREFIX, WEEKLY_ROLLUP_NOTICE_PREFIX] as const

export type NoticeActionName = 'move_tomorrow' | 'ask' | 'confirm_status'
/** `ask` runs in the browser: it opens Ciao's chat with `prompt`; nothing is changed until they say yes there. */
export type NoticeAction = { action: NoticeActionName; label: string; prompt?: string }
export type ActionableNotice = { key?: string | null; item_id?: string | null; due_date?: string | null; title?: string | null; body?: string | null }

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

const WAIT = 'Use my calendar tools: show me the exact change first and wait for my yes before you change anything.'

/** The fix button for a calendar-conflict notice, as a prepared ask to Ciao. */
function calendarAsk(n: ActionableNotice): NoticeAction | null {
  const kind = String(n.key ?? '').slice(CAL_CONFLICT_PREFIX.length).split('-')[0]
  const ids = splitIds(n.item_id)
  const what = [n.title, n.body].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')
  const ref = ids.length ? ` (event id${ids.length === 1 ? '' : 's'} ${ids.join(', ')})` : ''
  const ask = (label: string, task: string): NoticeAction => ({ action: 'ask', label, prompt: `${what}${ref} ${task} ${WAIT}`.trim() })
  switch (kind) {
    case 'double':
      return ask('Move or decline', 'Help me fix this double-booking: suggest which one to move (and to when I am free) or decline.')
    case 'no_break':
      return ask('Find a break', 'Find me a break that day: suggest one meeting to move or shorten.')
    case 'no_link':
      return ask('Add a video link', 'Add a video link to this meeting.')
    case 'no_agenda':
      return ask('Draft an agenda', 'Draft a short agenda for this meeting and add it to the invite.')
  }
  return null
}

/** The buttons a notice gets, beyond Open / Got it. */
export function actionsFor(n: ActionableNotice, today?: string): NoticeAction[] {
  const key = String(n.key ?? '')
  if (key.startsWith(DAY_WRAP_PREFIX) && splitIds(n.item_id).length && n.due_date) {
    const day = key.slice(DAY_WRAP_PREFIX.length, DAY_WRAP_PREFIX.length + 10)
    const from = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today
    return [{ action: 'move_tomorrow', label: `Move to ${from ? dayWord(from, n.due_date) : 'tomorrow'}` }]
  }
  if (key.startsWith(CAL_CONFLICT_PREFIX)) {
    const a = calendarAsk(n)
    return a ? [a] : []
  }
  if (key.startsWith(WEEKLY_STATUS_NOTICE_PREFIX) && n.item_id) return [{ action: 'confirm_status', label: 'Looks right' }]
  return []
}

/** Opens Ciao's chat with a prepared ask (the `ask` action). Browser only. */
export function askCiao(prompt: string | undefined): void {
  if (!prompt || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('mira:ask', { detail: { text: prompt } }))
}
