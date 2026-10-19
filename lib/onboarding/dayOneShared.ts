/**
 * Day one with Ciao (Suite CXO): the pure half. No database, no next/headers,
 * so the route, the card, the Hetzner tick and the tests all share one answer
 * to "what is left for this person's first day".
 *
 * The steps come from real state only (lib/onboarding/dayOne gathers it):
 *   - calendar:   their own Google calendar is connected (email too on the
 *                 Pinnacle edition only, where the inbox exists)
 *   - abilities:  they have seen what Ciao can do for their role
 *   - manager:    their employee record names a manager
 *   - one_on_one: a 1:1 with that manager has a date
 *   - first_todo: they have at least one to-do
 * A step that does not apply to someone (an owner has no manager) is left
 * out. When every step is done the card is gone and their manager hears it
 * once.
 */
import { ASSISTANT_NAME as DEFAULT_NAME } from '@/lib/assistantName'

/** Who counts as new: joined in the last two weeks. Older logins are never onboarded. */
export const ONBOARD_WINDOW_DAYS = 14
/** Their first day: the manager hears how it went after this, even if steps are open. */
export const FIRST_DAY_MS = 24 * 3600_000

/** Notice key prefix (one key per person: once, ever). */
export const ONBOARD_PREFIX = 'onboard-'
export const welcomeKey = (memberId: string) => `${ONBOARD_PREFIX}welcome-${memberId}`
export const readyKey = (memberId: string) => `${ONBOARD_PREFIX}ready-${memberId}`

/** Anchor of the card on their home page. */
export const DAY_ONE_ANCHOR = 'day-one'

export type StepId = 'calendar' | 'abilities' | 'manager' | 'one_on_one' | 'first_todo'

export type StepAction =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'ask'; label: string; prompt: string }
  | { kind: 'ack'; label: string }
  | { kind: 'todo'; label: string }

export type Step = { id: StepId; title: string; detail: string; done: boolean; action: StepAction | null }

export type DayOneFacts = {
  /** An employee login (role rep/observer on an exec org). */
  employeeOnly: boolean
  role: string
  /** Their login is linked to a cxo_employees row. */
  hasEmployeeRow: boolean
  managerName: string | null
  calendarConnected: boolean
  /** The Pinnacle edition: Google connects email too. */
  inbox: boolean
  oneOnOneDate: string | null
  hasOneOnOne: boolean
  todoCount: number
  abilitiesSeen: boolean
}

export type MemberDates = { created_at?: string | null; invited_at?: string | null; accepted_at?: string | null; last_login_at?: string | null }

/** When they got this login: the later of the row and its last invite (a re-invite starts over). */
export function joinedAt(m: MemberDates): string | null {
  const t = [m.created_at, m.invited_at].filter((x): x is string => !!x && !Number.isNaN(Date.parse(x)))
  if (!t.length) return null
  return new Date(Math.max(...t.map((x) => Date.parse(x)))).toISOString()
}

/** Joined in the last ONBOARD_WINDOW_DAYS. */
export function isNewMember(m: MemberDates, now: Date): boolean {
  const j = joinedAt(m)
  return !!j && now.getTime() - Date.parse(j) <= ONBOARD_WINDOW_DAYS * 86_400_000 && Date.parse(j) <= now.getTime() + 60_000
}

/** Their first day is over: a full day since their first sign-in (never signed in = not started). */
export function firstDayOver(m: MemberDates, now: Date): boolean {
  const start = m.accepted_at || m.last_login_at
  if (!start || Number.isNaN(Date.parse(start))) return false
  const begin = Math.max(Date.parse(start), Date.parse(joinedAt(m) ?? start))
  return now.getTime() - begin >= FIRST_DAY_MS
}

const dayWords = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))

/** The manager steps apply to an employee login, or to anyone whose record names a manager. An owner without one never sees them. */
export function managerStepsApply(f: Pick<DayOneFacts, 'employeeOnly' | 'managerName' | 'role'>): boolean {
  if (f.managerName) return true
  return f.employeeOnly && f.role !== 'owner'
}

/** The checklist for one person, in order. */
export function dayOneSteps(f: DayOneFacts, opts: { home: string; abilities?: string[]; assistantName?: string; roleLabel?: string | null }): Step[] {
  const ASSISTANT_NAME = opts.assistantName || DEFAULT_NAME
  const steps: Step[] = []
  const what = f.inbox ? 'calendar and email' : 'calendar'
  steps.push({
    id: 'calendar',
    title: `Connect your Google ${what}`,
    detail: f.calendarConnected
      ? `Connected. ${ASSISTANT_NAME} can see your day and find open times.`
      : `So ${ASSISTANT_NAME} can see your day, find open times and book meetings when you ask.`,
    done: f.calendarConnected,
    action: f.calendarConnected ? null : { kind: 'link', label: 'Connect Google', href: `/api/google/oauth/start?return=${encodeURIComponent(opts.home)}` },
  })
  const n = opts.abilities?.length ?? 0
  steps.push({
    id: 'abilities',
    title: `See what ${ASSISTANT_NAME} can do for you`,
    detail: f.abilitiesSeen
      ? 'Done. Ask any time: "What can you do for me?"'
      : opts.roleLabel
        ? `${n ? `${n} things, picked` : 'Picked'} for you as ${opts.roleLabel}.`
        : n ? `${n} things, picked for your role.` : 'Picked for your role.',
    done: f.abilitiesSeen,
    action: f.abilitiesSeen ? null : { kind: 'ack', label: 'Got it' },
  })
  if (managerStepsApply(f)) {
    steps.push({
      id: 'manager',
      title: 'Know who your manager is',
      detail: f.managerName ? `You report to ${f.managerName}.` : 'Your record does not name a manager yet.',
      done: !!f.managerName,
      action: f.managerName ? null : { kind: 'ask', label: `Ask ${ASSISTANT_NAME}`, prompt: 'Please send an admin a message: my employee record does not name my manager yet. Can they add it?' },
    })
    steps.push({
      id: 'one_on_one',
      title: f.managerName ? `Your first 1:1 with ${f.managerName}` : 'Your first 1:1',
      detail: f.hasOneOnOne
        ? f.oneOnOneDate
          ? `Set for ${dayWords(f.oneOnOneDate)}.`
          : 'Set up.'
        : f.managerName
          ? 'Not on the calendar yet. Your manager sets it.'
          : 'Once you have a manager, they set it.',
      done: f.hasOneOnOne,
      action: f.hasOneOnOne || !f.managerName ? null : { kind: 'ask', label: `Ask ${f.managerName.split(' ')[0]}`, prompt: `Please send ${f.managerName} a message asking to set up our first 1:1.` },
    })
  }
  steps.push({
    id: 'first_todo',
    title: 'Add your first to-do',
    detail: f.todoCount > 0 ? 'Done. Ask me to add more any time.' : `Something you want to get done this week. ${ASSISTANT_NAME} keeps track of it.`,
    done: f.todoCount > 0,
    action: f.todoCount > 0 ? null : { kind: 'todo', label: 'Add' },
  })
  return steps
}

export const allDone = (steps: Step[]) => steps.length > 0 && steps.every((s) => s.done)
export const doneCount = (steps: Step[]) => steps.filter((s) => s.done).length

/** Plain words for a step that is still open, for the manager. */
const openWords = (ASSISTANT_NAME: string): Record<StepId, string> => ({
  calendar: 'Calendar not connected.',
  abilities: `Has not looked at what ${ASSISTANT_NAME} can do yet.`,
  manager: 'No manager on their record.',
  one_on_one: 'No 1:1 on the calendar yet. You can set it on their page.',
  first_todo: 'No to-dos yet.',
})
const doneWords = (ASSISTANT_NAME: string): Record<StepId, string> => ({
  calendar: 'Calendar connected.',
  abilities: `Has seen what ${ASSISTANT_NAME} can do.`,
  manager: 'Knows you are their manager.',
  one_on_one: '1:1 is set.',
  first_todo: 'First to-do added.',
})

/** The one welcome notice for the new person. Null when nothing is left. */
/**
 * Is Google live for this person? Same rule as the integrations page's
 * "Connected": their own connection, else the company-level one (member_id
 * null). A connection Google stopped honouring (needs_reconnect) does not count.
 */
export function googleConnectedFor(rows: ReadonlyArray<{ member_id: string | null; needs_reconnect?: boolean | null }>, memberId: string): boolean {
  return rows.some((r) => (r.member_id === memberId || r.member_id == null) && !r.needs_reconnect)
}

export function welcomeNoticeText(firstName: string, steps: Step[], ASSISTANT_NAME: string = DEFAULT_NAME): { title: string; body: string } | null {
  const open = steps.filter((s) => !s.done)
  if (!open.length) return null
  const hi = firstName ? `Welcome, ${firstName}.` : 'Welcome.'
  return {
    title: `${hi} Your first day with ${ASSISTANT_NAME}`,
    body: [`${open.length} quick step${open.length === 1 ? '' : 's'} to get set up:`, ...open.map((s) => `- ${s.title}`), '', 'The list is at the top of your page. Each one takes a tap.'].join('\n'),
  }
}

/** The one notice to their manager: set up, or how the first day went. */
export function managerNoticeText(name: string, steps: Step[], assistantName: string = DEFAULT_NAME): { title: string; body: string } {
  const OPEN_WORDS = openWords(assistantName)
  const DONE_WORDS = doneWords(assistantName)
  if (allDone(steps)) {
    return { title: `${name} is set up`, body: steps.map((s) => `- ${DONE_WORDS[s.id]}`).join('\n') }
  }
  const open = steps.filter((s) => !s.done)
  const done = steps.filter((s) => s.done)
  return {
    title: `${name}'s first day: ${done.length} of ${steps.length} set up`,
    body: ['Still open:', ...open.map((s) => `- ${OPEN_WORDS[s.id]}`), ...(done.length ? ['', 'Done:', ...done.map((s) => `- ${DONE_WORDS[s.id]}`)] : [])].join('\n'),
  }
}

/** A to-do from the card: one line, trimmed. */
export function cleanTodo(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
}
