/**
 * Adoption (Suite CXO, owner 10-11, Pinnacle ask): who is using the suite,
 * how much, and whether it is growing. Pure: shared by the server loader,
 * the Adoption page, Mira's tool, the public demo and the tests.
 *
 * Everything is built from two daily rollups and nothing else:
 *   - cxo_activity: one row per member per day per KEY, where a key is a page
 *     path ('/dashboard/boards'), '/login', 'session', or an action
 *     ('act:card_created'). Counts only, never content.
 *   - agent_usage: Mira questions per member per day (a count, no text).
 */
import { pageName } from '@/lib/cxoUsageShared'

// ── Keys stored in cxo_activity.path ────────────────────────────────────────

export const LOGIN_KEY = '/login'
/** A browser session started (a new tab or a returning visit), counted each time. */
export const SESSION_KEY = 'session'
export const ACTION_PREFIX = 'act:'
/**
 * Mira questions asked while our admin was viewing as the member. They are in
 * agent_usage (billing counts them), so adoption subtracts them.
 */
export const IMPERSONATED_MIRA_KEY = 'x:mira'

/** Key actions, in the order they are listed. Add one here and record it with recordUsage(). */
export const USAGE_ACTIONS = {
  card_created: 'Cards created',
  card_moved: 'Cards moved',
  todo_done: 'To-dos completed',
  message_sent: 'Messages sent',
  meeting_note_opened: 'Meeting notes opened',
  praise_given: 'Praise given',
  one_on_one_held: '1:1s held',
} as const
export type UsageAction = keyof typeof USAGE_ACTIONS

export const actionKey = (a: UsageAction): string => `${ACTION_PREFIX}${a}`
export const isPageKey = (key: string): boolean => key.startsWith('/dashboard')

// ── Status ──────────────────────────────────────────────────────────────────

/** A person counts as active in a week when they used the suite on this many days or more. */
export const ACTIVE_DAYS_PER_WEEK = 2
export const WEEKS_SHOWN = 12

export type AdoptionStatus = 'active' | 'slipping' | 'not_started'

export const STATUS_LABEL: Record<AdoptionStatus, string> = {
  active: 'Active',
  slipping: 'Slipping',
  not_started: 'Not started',
}

export const STATUS_RULES =
  `Active: used the suite on ${ACTIVE_DAYS_PER_WEEK} or more of the last 7 days. ` +
  `Slipping: has used it before, but on fewer than ${ACTIVE_DAYS_PER_WEEK} of the last 7 days. ` +
  'Not started: has never signed in. A day counts when the person signed in, opened a page, asked Mira or did something (a card, a to-do, a message).'

/** The one rule behind the status column, the headline number and the weekly trend. */
export function adoptionStatus(daysActive7: number, everUsed: boolean): AdoptionStatus {
  if (daysActive7 >= ACTIVE_DAYS_PER_WEEK) return 'active'
  return everUsed ? 'slipping' : 'not_started'
}

// ── People ──────────────────────────────────────────────────────────────────

export type AdoptionGroup = 'exec' | 'employee' | 'assistant'

export const GROUP_LABEL: Record<AdoptionGroup, string> = { exec: 'Executives', employee: 'Employees', assistant: 'Assistants' }

/** Executives hold owner / admin / manager seats; employee logins are rep / observer; exec assistants are their own group. */
export function adoptionGroup(role: string | null | undefined): AdoptionGroup {
  if (role === 'assistant') return 'assistant'
  if (role === 'rep' || role === 'observer') return 'employee'
  return 'exec'
}

const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Executive',
  manager: 'Manager',
  rep: 'Team member',
  observer: 'Viewer',
  assistant: 'Executive assistant',
}

function titleOf(m: AdoptionMember): string {
  const raw = m.settings?.title
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/\s+/g, ' ').trim().slice(0, 60)
  return ROLE_WORDS[m.role] ?? 'Member'
}

export type AdoptionMember = {
  id: string
  display_name: string | null
  email: string | null
  role: string
  last_login_at: string | null
  settings?: Record<string, unknown> | null
}
export type ActivityRow = { member_id: string; day: string; path: string; count: number | null; updated_at?: string | null }
export type MiraRow = { member_id: string | null; day: string; requests: number | null }

export type PersonDay = {
  day: string
  signed_in: boolean
  sessions: number
  /** Plain page names opened that day ("Boards", "Revenue"). */
  pages: string[]
  mira: number
  actions: Partial<Record<UsageAction, number>>
}

export type AdoptionPerson = {
  id: string
  name: string
  title: string
  group: AdoptionGroup
  status: AdoptionStatus
  /** ISO timestamp, or null when they have never been seen. */
  last_seen: string | null
  days7: number
  days30: number
  mira30: number
  top_page: string | null
  /** 30 values, oldest first: how much they did each day (0 = not there). */
  spark: number[]
  /** Last 30 days, newest first, active days only. */
  days: PersonDay[]
  /** Days each page was opened in the last 30. */
  pages: Array<{ name: string; days: number }>
  actions: Array<{ key: UsageAction; label: string; count: number }>
}

export type AdoptionWeek = { label: string; start: string; end: string; active: number; mira: number }

export type AdoptionData = {
  today: string
  total: number
  active: number
  slipping: number
  not_started: number
  /** Active people as a share of everyone, 0-100. */
  pct: number
  /** Oldest first; the last one is the last 7 days. */
  weeks: AdoptionWeek[]
  /** Person-days each page was opened in the last 30 days. */
  top_pages: Array<{ name: string; value: number }>
  people: AdoptionPerson[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const addDays = (iso: string, n: number): string => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
export const shortDay = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${Number(iso.slice(8, 10))}`

/** How far back the page looks (12 weeks). */
export const adoptionSince = (today: string): string => addDays(today, -(WEEKS_SHOWN * 7 - 1))

const STATUS_ORDER: Record<AdoptionStatus, number> = { not_started: 0, slipping: 1, active: 2 }

type DayAcc = { signed_in: boolean; sessions: number; pages: Set<string>; miraRaw: number; miraOff: number; actions: Partial<Record<UsageAction, number>> }

/**
 * Members + the two rollups → everything the Adoption page shows. Rows for
 * anyone who is not in `members` (another org, a removed login) are ignored.
 */
export function buildAdoption(members: AdoptionMember[], activity: ActivityRow[], mira: MiraRow[], today: string): AdoptionData {
  const since = adoptionSince(today)
  const since30 = addDays(today, -29)
  const since7 = addDays(today, -6)
  const ids = new Set(members.map((m) => m.id))
  const byMember = new Map<string, Map<string, DayAcc>>()
  const seenAt = new Map<string, number>()
  const slot = (memberId: string, day: string): DayAcc => {
    let days = byMember.get(memberId)
    if (!days) byMember.set(memberId, (days = new Map()))
    let d = days.get(day)
    if (!d) days.set(day, (d = { signed_in: false, sessions: 0, pages: new Set(), miraRaw: 0, miraOff: 0, actions: {} }))
    return d
  }

  for (const a of activity) {
    if (!ids.has(a.member_id) || a.day < since || a.day > today) continue
    const n = Math.max(0, Number(a.count) || 0)
    const d = slot(a.member_id, a.day)
    if (a.path === IMPERSONATED_MIRA_KEY) {
      d.miraOff += n
      continue // our admin, not them: never moves "last seen"
    }
    if (a.path === LOGIN_KEY) d.signed_in = true
    else if (a.path === SESSION_KEY) d.sessions += n
    else if (a.path.startsWith(ACTION_PREFIX)) {
      const k = a.path.slice(ACTION_PREFIX.length) as UsageAction
      if (k in USAGE_ACTIONS) d.actions[k] = (d.actions[k] ?? 0) + n
      else continue
    } else if (isPageKey(a.path)) d.pages.add(pageName(a.path))
    else continue
    const at = Date.parse(a.updated_at ?? '') || Date.parse(a.day + 'T12:00:00Z')
    if (at > (seenAt.get(a.member_id) ?? 0)) seenAt.set(a.member_id, at)
  }
  for (const u of mira) {
    if (!u.member_id || !ids.has(u.member_id) || u.day < since || u.day > today) continue
    slot(u.member_id, u.day).miraRaw += Math.max(0, Number(u.requests) || 0)
  }

  const miraOf = (d: DayAcc) => Math.max(0, d.miraRaw - d.miraOff)
  const actionsOf = (d: DayAcc) => Object.values(d.actions).reduce((n: number, v) => n + (v ?? 0), 0)
  const isActive = (d: DayAcc | undefined) => !!d && (d.signed_in || d.sessions > 0 || d.pages.size > 0 || miraOf(d) > 0 || actionsOf(d) > 0)
  const score = (d: DayAcc | undefined) => (d && isActive(d) ? Math.max(1, d.pages.size + miraOf(d) + actionsOf(d)) : 0)

  const weeks: AdoptionWeek[] = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
    const end = addDays(today, -7 * (WEEKS_SHOWN - 1 - i))
    const start = addDays(end, -6)
    return { label: shortDay(start), start, end, active: 0, mira: 0 }
  })
  const pageDays = new Map<string, number>()

  const people: AdoptionPerson[] = members.map((m) => {
    const days = byMember.get(m.id) ?? new Map<string, DayAcc>()
    const activeDays = [...days.entries()].filter(([, d]) => isActive(d)).map(([day]) => day).sort()
    const in30 = activeDays.filter((d) => d >= since30)
    const days7 = activeDays.filter((d) => d >= since7).length
    const lastLogin = Date.parse(m.last_login_at ?? '') || 0
    const lastSeen = Math.max(lastLogin, activeDays.length ? seenAt.get(m.id) ?? Date.parse(activeDays[activeDays.length - 1] + 'T12:00:00Z') : 0)
    const everUsed = lastSeen > 0

    for (const w of weeks) {
      const n = activeDays.filter((d) => d >= w.start && d <= w.end).length
      if (n >= ACTIVE_DAYS_PER_WEEK) w.active += 1
      for (const [day, d] of days) if (day >= w.start && day <= w.end) w.mira += miraOf(d)
    }

    const pages = new Map<string, number>()
    const actions: Partial<Record<UsageAction, number>> = {}
    let mira30 = 0
    for (const day of in30) {
      const d = days.get(day)!
      mira30 += miraOf(d)
      for (const p of d.pages) pages.set(p, (pages.get(p) ?? 0) + 1)
      for (const [k, v] of Object.entries(d.actions)) actions[k as UsageAction] = (actions[k as UsageAction] ?? 0) + (v ?? 0)
    }
    for (const [p, n] of pages) pageDays.set(p, (pageDays.get(p) ?? 0) + n)
    const pageList = [...pages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, days: n }))

    return {
      id: m.id,
      name: m.display_name || m.email || 'Member',
      title: titleOf(m),
      group: adoptionGroup(m.role),
      status: adoptionStatus(days7, everUsed),
      last_seen: everUsed ? new Date(lastSeen).toISOString() : null,
      days7,
      days30: in30.length,
      mira30,
      top_page: pageList[0]?.name ?? null,
      spark: Array.from({ length: 30 }, (_, i) => score(days.get(addDays(since30, i)))),
      days: [...in30].reverse().map((day) => {
        const d = days.get(day)!
        return { day, signed_in: d.signed_in, sessions: d.sessions, pages: [...d.pages].sort(), mira: miraOf(d), actions: d.actions }
      }),
      pages: pageList,
      actions: (Object.keys(USAGE_ACTIONS) as UsageAction[]).filter((k) => (actions[k] ?? 0) > 0).map((k) => ({ key: k, label: USAGE_ACTIONS[k], count: actions[k] ?? 0 })),
    }
  })

  // People who need a nudge first: not started, then slipping, then active (least active first).
  people.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.days7 - b.days7 || a.days30 - b.days30 || a.name.localeCompare(b.name))

  const count = (s: AdoptionStatus) => people.filter((p) => p.status === s).length
  const active = count('active')
  return {
    today,
    total: people.length,
    active,
    slipping: count('slipping'),
    not_started: count('not_started'),
    pct: people.length ? Math.round((active / people.length) * 100) : 0,
    weeks,
    top_pages: [...pageDays.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, value]) => ({ name, value })),
    people,
  }
}

/** "Today", "Yesterday", "Oct 3", "Never": last seen in plain words, by calendar day in `tz`. */
export function lastSeenWords(iso: string | null, today: string, tz = 'UTC'): string {
  if (!iso) return 'Never'
  let day: string
  try {
    day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  } catch {
    day = iso.slice(0, 10)
  }
  if (day >= today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  return day.slice(0, 4) === today.slice(0, 4) ? shortDay(day) : `${shortDay(day)}, ${day.slice(0, 4)}`
}

// ── What Mira may say ───────────────────────────────────────────────────────

/**
 * Adoption for the AI: names, role words and counts only. No emails, no pay,
 * no client names, no page-by-page or day-by-day detail.
 */
export function adoptionForAi(data: AdoptionData, tz = 'UTC') {
  const row = (p: AdoptionPerson) => ({
    name: p.name,
    role: p.title,
    group: GROUP_LABEL[p.group],
    status: STATUS_LABEL[p.status],
    last_seen: lastSeenWords(p.last_seen, data.today, tz),
    days_active_last_7: p.days7,
    days_active_last_30: p.days30,
    mira_questions_last_30: p.mira30,
    most_used_page: p.top_page,
  })
  const last = data.weeks[data.weeks.length - 1]
  const prev = data.weeks[data.weeks.length - 2]
  return {
    as_of: data.today,
    people: data.total,
    active_this_week: data.active,
    adoption_pct: data.pct,
    active_last_week: prev?.active ?? 0,
    slipping: data.slipping,
    not_started: data.not_started,
    mira_questions_this_week: last?.mira ?? 0,
    mira_questions_last_week: prev?.mira ?? 0,
    weekly_active: data.weeks.map((w) => ({ week_of: w.start, active: w.active, mira_questions: w.mira })),
    most_used_pages: data.top_pages.slice(0, 6).map((p) => p.name),
    not_seen_this_week: data.people.filter((p) => p.days7 === 0).map(row),
    everyone: data.people.map(row),
    rules: STATUS_RULES,
  }
}

// ── Demo ────────────────────────────────────────────────────────────────────

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Invented people for /cxo/demo. [name, role, title, weekday chance, first used (days ago), last used (days ago), Mira per active day]. */
const DEMO_PEOPLE: Array<[string, string, string, number, number, number, number]> = [
  ['Michael Carter', 'owner', 'Chief Executive Officer', 0.95, 84, 0, 4],
  ['Priya Raman', 'admin', 'Chief Operating Officer', 0.9, 84, 0, 3],
  ['Tom Okafor', 'admin', 'Chief Financial Officer', 0.7, 70, 0, 2],
  ['Elena Brooks', 'manager', 'VP Sales', 0.8, 56, 0, 2.5],
  ['Grant Holloway', 'manager', 'VP Marketing', 0.55, 63, 9, 1],
  ['Naomi Field', 'manager', 'VP Carrier Relations', 0, 0, 0, 0],
  ['Lena Ortiz', 'assistant', 'Executive assistant', 0.85, 49, 0, 0],
  ['Jordan Ellis', 'rep', 'Licensing coordinator', 0.85, 42, 0, 1.5],
  ['Casey Nguyen', 'rep', 'Agent support', 0.75, 35, 0, 1],
  ['Riley Summers', 'rep', 'Commissions analyst', 0.6, 35, 0, 0.6],
  ['Avery Stone', 'rep', 'Onboarding specialist', 0.7, 28, 0, 1],
  ['Morgan Tate', 'rep', 'Marketing associate', 0.5, 28, 5, 0.4],
  ['Devon Park', 'rep', 'Contracting specialist', 0.45, 21, 12, 0.3],
  ['Harper Quinn', 'rep', 'Agent support', 0, 0, 0, 0],
  ['Sam Whitlock', 'observer', 'Board advisor', 0.25, 40, 3, 0],
]

const DEMO_EXEC_PAGES = ['/dashboard', '/dashboard/revenue', '/dashboard/boards', '/dashboard/meetings', '/dashboard/calendar', '/dashboard/team', '/dashboard/partners', '/dashboard/employees']

/** A made-up org for the public demo, run through the same builder as the real page. No real person or figure. */
export function demoAdoption(today: string): AdoptionData {
  const rand = rng(20261011)
  const members: AdoptionMember[] = []
  const activity: ActivityRow[] = []
  const mira: MiraRow[] = []
  DEMO_PEOPLE.forEach(([name, role, title, chance, first, last, miraRate], i) => {
    const id = `demo-${i}`
    let lastDay: string | null = null
    for (let ago = first; ago >= last && chance > 0; ago--) {
      const day = addDays(today, -ago)
      const dow = new Date(day + 'T12:00:00Z').getUTCDay()
      const weekend = dow === 0 || dow === 6
      // Adoption builds: people use it a little more each week after they start.
      const ramp = Math.min(1, 0.55 + ((first - ago) / Math.max(1, first)) * 0.6)
      if (rand() > (weekend ? chance * 0.12 : chance * ramp)) continue
      lastDay = day
      const at = `${day}T${String(13 + Math.floor(rand() * 8)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00Z`
      const add = (path: string, count = 1) => activity.push({ member_id: id, day, path, count, updated_at: at })
      add(LOGIN_KEY)
      add(SESSION_KEY, 1 + Math.floor(rand() * 3))
      const employee = adoptionGroup(role) === 'employee'
      if (employee) add('/dashboard/me')
      else {
        // Earlier pages in the list are opened more often.
        DEMO_EXEC_PAGES.forEach((path, n) => {
          if (rand() < 0.92 - n * 0.11) add(path)
        })
        if (rand() < 0.55) add(actionKey('card_moved'), 1 + Math.floor(rand() * 4))
        if (rand() < 0.35) add(actionKey('card_created'), 1 + Math.floor(rand() * 2))
        if (rand() < 0.3) add(actionKey('meeting_note_opened'), 1 + Math.floor(rand() * 2))
        if (rand() < 0.2) add(actionKey('praise_given'))
      }
      if (rand() < 0.5) add(actionKey('todo_done'), 1 + Math.floor(rand() * 3))
      if (rand() < 0.3) add(actionKey('message_sent'), 1 + Math.floor(rand() * 2))
      const asked = Math.round(miraRate * (0.4 + rand() * 1.3))
      if (asked > 0) mira.push({ member_id: id, day, requests: asked })
    }
    members.push({ id, display_name: name, email: null, role, last_login_at: lastDay ? `${lastDay}T14:05:00Z` : null, settings: { title } })
  })
  return buildAdoption(members, activity, mira, today)
}
