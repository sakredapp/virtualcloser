/**
 * Board due-date reminders — the pure part (no DB), shared by the cron, the
 * Messages card and the tests.
 *
 * Marty (Pinnacle, 10-09): "Mike, you've got this due in four days. Paul,
 * three days." Each member on a card with a due date is reminded 7, 3 and 1
 * days before, on the day, and once when it goes overdue. Every reminder is
 * keyed card + member + kind and stored, so none is ever sent twice.
 */

export const REMINDER_KINDS = ['d7', 'd3', 'd1', 'd0', 'overdue'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]

/** Reminder thresholds, furthest first. */
const THRESHOLDS: Array<{ days: number; kind: ReminderKind }> = [
  { days: 7, kind: 'd7' },
  { days: 3, kind: 'd3' },
  { days: 1, kind: 'd1' },
  { days: 0, kind: 'd0' },
]

/** YYYY-MM-DD for an instant in a time zone. */
export function dayInZone(at: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** Whole days from `today` to `due` (both YYYY-MM-DD). Negative = overdue. */
export function daysBetween(today: string, due: string): number {
  return Math.round((Date.parse(due + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000)
}

/**
 * Which reminder is due now, given whole days left. More than 7 days: none.
 * Between thresholds it is the nearest one not yet passed (5 days left → the
 * 7-day reminder, so a card made 5 days out still gets one; 2 days → the
 * 3-day one). Overdue → 'overdue'. Already sent kinds are filtered by the
 * caller, so a member never hears the same step twice.
 */
export function reminderKindFor(daysLeft: number): ReminderKind | null {
  if (!Number.isFinite(daysLeft)) return null
  if (daysLeft < 0) return 'overdue'
  let pick: ReminderKind | null = null
  for (const t of THRESHOLDS) if (daysLeft <= t.days) pick = t.kind
  return pick
}

export type PlanCard = { id: string; rep_id: string; due_date: string | null; done_at: string | null }
export type PlanAssignee = { card_id: string; member_id: string | null; partner_id: string | null }
export type PlanMember = { id: string; rep_id: string; timezone: string | null; is_active: boolean }
export type PlannedReminder = { rep_id: string; card_id: string; member_id: string; kind: ReminderKind; due_date: string; days_left: number }

/** Cards long overdue are left alone: one overdue reminder only within this many days. */
export const OVERDUE_WINDOW_DAYS = 14

/**
 * Every reminder that should go out now. Partners (outside people) get
 * nothing — only platform members on the card. Done cards, cards without a
 * due date, inactive members and anything already in `sent`
 * ("card|member|kind") are skipped.
 */
export function planReminders(input: {
  cards: PlanCard[]
  assignees: PlanAssignee[]
  members: PlanMember[]
  sent: Set<string>
  now: Date
  fallbackTz?: string
}): PlannedReminder[] {
  const byId = new Map(input.members.map((m) => [m.id, m]))
  const cards = new Map(input.cards.map((c) => [c.id, c]))
  const out: PlannedReminder[] = []
  const seen = new Set<string>()
  for (const a of input.assignees) {
    if (!a.member_id) continue // partner: never automatic
    const card = cards.get(a.card_id)
    const m = byId.get(a.member_id)
    if (!card || !m || !m.is_active || !card.due_date || card.done_at) continue
    if (m.rep_id !== card.rep_id) continue
    const today = dayInZone(input.now, m.timezone || input.fallbackTz || 'America/New_York')
    const left = daysBetween(today, card.due_date.slice(0, 10))
    if (left < -OVERDUE_WINDOW_DAYS) continue
    const kind = reminderKindFor(left)
    if (!kind) continue
    const key = reminderKey(card.id, m.id, kind)
    if (input.sent.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ rep_id: card.rep_id, card_id: card.id, member_id: m.id, kind, due_date: card.due_date.slice(0, 10), days_left: left })
  }
  return out
}

export const reminderKey = (cardId: string, memberId: string, kind: string) => `${cardId}|${memberId}|${kind}`

/** "Due in 4 days", "Due tomorrow", "Due today", "Overdue by 2 days". */
export function dueWords(daysLeft: number): string {
  if (daysLeft === 0) return 'Due today'
  if (daysLeft === 1) return 'Due tomorrow'
  if (daysLeft > 1) return `Due in ${daysLeft} days`
  const n = -daysLeft
  return `Overdue by ${n} ${n === 1 ? 'day' : 'days'}`
}

/** "Tue, Oct 13" for a YYYY-MM-DD. */
export function dueDateLabel(due: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(due.slice(0, 10) + 'T12:00:00Z'))
}

/** Where a reminder links: the board with the card open. */
export function cardHref(boardId: string, cardId: string): string {
  return `/dashboard/boards?board=${encodeURIComponent(boardId)}&card=${encodeURIComponent(cardId)}`
}

/** Member settings (members.settings jsonb): in-app on unless turned off, email off unless turned on. */
export function reminderPrefs(settings: unknown): { inApp: boolean; email: boolean } {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
  return { inApp: s.due_reminders_in_app !== false, email: s.due_reminders_email === true }
}

/** Digest window: open cards due within 7 days, or overdue up to the window. */
export function inDigest(daysLeft: number): boolean {
  return daysLeft <= 7 && daysLeft >= -OVERDUE_WINDOW_DAYS
}

/** What the Messages card shows for one reminder. */
export type ReminderView = {
  id: string
  card_id: string
  board_id: string
  board_name: string
  title: string
  kind: ReminderKind
  due_date: string
  days_left: number
  href: string
  created_at: string
}
