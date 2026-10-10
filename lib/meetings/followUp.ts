/**
 * Follow-up on meeting to-dos ("Mira tracks every one to done"). In-app only:
 * the owner's Today puts due and overdue items on top with a tag, the
 * meeting's page shows each item's state, and the morning brief on Today
 * names the overdue ones. No email, text or push: nothing is sent.
 */

export type FollowState = 'done' | 'overdue' | 'due' | 'open'

/** YYYY-MM-DD for "today" in a timezone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function followState(t: { done_at: string | null; due_date: string | null }, today: string): FollowState {
  if (t.done_at) return 'done'
  if (t.due_date && t.due_date < today) return 'overdue'
  if (t.due_date && t.due_date === today) return 'due'
  return 'open'
}

/** "Overdue" / "Due today" tag for a to-do row, or null when neither. */
export function dueTag(due: string | null, done: boolean, today: string): 'Overdue' | 'Due today' | null {
  if (done || !due) return null
  if (due < today) return 'Overdue'
  if (due === today) return 'Due today'
  return null
}

/** The meeting page's status words for one sent item. */
export function trackLabel(state: FollowState, ownerFirst: string | null): string {
  const where = ownerFirst ? `on ${ownerFirst}'s Today` : 'on their Today'
  if (state === 'done') return 'Done'
  if (state === 'overdue') return `Overdue · ${where}`
  if (state === 'due') return `Due today · ${where}`
  return `${where.charAt(0).toUpperCase()}${where.slice(1)}`
}

/** "Mira is tracking 3: 1 done, 1 overdue, 1 open." for a meeting's sent items. */
export function trackSummary(states: FollowState[]): string | null {
  if (!states.length) return null
  const n = (s: FollowState) => states.filter((x) => x === s).length
  const parts = [
    n('done') ? `${n('done')} done` : null,
    n('overdue') ? `${n('overdue')} overdue` : null,
    n('due') ? `${n('due')} due today` : null,
    n('open') ? `${n('open')} open` : null,
  ].filter(Boolean)
  return `Mira is tracking ${states.length}: ${parts.join(', ')}.`
}

/** The brief's overdue line, or null when nothing is overdue. Names up to two. */
export function overdueBriefLine(
  todos: Array<{ body: string; done_at: string | null; due_date: string | null; meeting_title?: string | null }>,
  today: string,
): string | null {
  const late = todos
    .filter((t) => followState(t, today) === 'overdue')
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  if (!late.length) return null
  const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57).replace(/\s+\S*$/, '')}…` : s)
  const named = late.slice(0, 2).map((t) => `"${short(t.body)}"${t.meeting_title ? ` (from ${t.meeting_title})` : ''}`)
  const more = late.length > 2 ? ` and ${late.length - 2} more` : ''
  return `${late.length} ${late.length === 1 ? 'to-do is' : 'to-dos are'} overdue: ${named.join(', ')}${more}.`
}
