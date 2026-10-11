/**
 * Suite CXO people layer (owner 10-11): praise, 1:1s and per-person goals.
 * Pure: no database, no next/headers. The server loader, the demo and the
 * tests all go through assembleHub and the can* rules below, so "who sees
 * what" has exactly one answer.
 *
 * Who sees what:
 *   - owner / admin (an exec login): every employee.
 *   - anyone else (manager role, or an employee login): their own page and
 *     the people who report to them (cxo_employees.manager_id).
 *   - the praise feed and a minimal directory (name, title, department) are
 *     org-wide: anyone can praise anyone.
 *   - private feedback inside a 1:1: the employee, the person who runs the
 *     1:1, and the org owner/admin. Nobody else, direct manager included
 *     when someone else runs the 1:1.
 *
 * This is day-to-day management, not HR records: no SSN, date of birth, home
 * address, bank or tax data exists anywhere in this layer.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly'
export const CADENCES: Cadence[] = ['weekly', 'biweekly', 'monthly']
export const CADENCE_WORDS: Record<Cadence, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' }
export const asCadence = (v: unknown): Cadence => ((CADENCES as string[]).includes(String(v)) ? (v as Cadence) : 'biweekly')

export type ItemKind = 'agenda' | 'note' | 'action' | 'feedback'
export const ITEM_KINDS: ItemKind[] = ['agenda', 'note', 'action', 'feedback']

export type GoalUnit = 'count' | 'usd' | 'pct'
export const GOAL_UNITS: GoalUnit[] = ['count', 'usd', 'pct']

/** Default company values for the praise tag; an org may set reps.settings.cxo_values. */
export const DEFAULT_VALUES = ['Ownership', 'Teamwork', 'Client first', 'Integrity', 'Growth']
export function companyValues(settings: unknown): string[] {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).cxo_values : null
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 40)) : []
  return list.length ? list.slice(0, 12) : DEFAULT_VALUES
}

// ── Dates (YYYY-MM-DD) ──────────────────────────────────────────────────────

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function nextAfter(day: string, cadence: Cadence): string {
  if (cadence === 'weekly') return addDays(day, 7)
  if (cadence === 'biweekly') return addDays(day, 14)
  const d = new Date(`${day}T00:00:00Z`)
  const dom = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(dom, last))
  return d.toISOString().slice(0, 10)
}
export function dayWords(day: string | null | undefined): string {
  if (!day || !ISO_DAY.test(day)) return 'Not set'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00Z`))
}
/** A 1:1 is overdue when its next date has passed. */
export function isOverdue(oo: { next_date: string | null } | null | undefined, today: string): boolean {
  return !!oo && !!oo.next_date && oo.next_date < today
}

// ── Rows (what the tables hold) ─────────────────────────────────────────────

export type PersonLite = { id: string; name: string; title: string | null; department: string; manager_id: string | null; member_id: string | null }
export type GoalRow = { id: string; employee_id: string; title: string; unit: GoalUnit; target: number; current: number; due_date: string | null; status: 'active' | 'done' }
export type OneOnOneRow = { id: string; employee_id: string; manager_member_id: string | null; manager_name: string | null; cadence: Cadence; next_date: string | null; last_date: string | null; calendar_event_id: string | null }
export type ItemRow = { id: string; one_on_one_id: string; kind: ItemKind; body: string; author_member_id: string | null; author_name: string | null; owner_member_id: string | null; owner_name: string | null; done_at: string | null; created_at: string }
export type PraiseRow = { id: string; from_member_id: string | null; from_name: string; to_employee_id: string; value: string | null; body: string; created_at: string }
export type CardLite = { id: string; title: string; board: string; due_date: string | null }

/** A quota the person already has, shown as a goal. */
export type KpiGoal = { id: string; title: string; unit: 'count' | 'usd' | 'pct' | 'days' | 'hours'; target: number; current: number | null; att: number | null; period: string; pace: 'met' | 'on_pace' | 'behind' | 'no_data' }

export type RawPeople = {
  employees: PersonLite[]
  /** Quotas per employee id, and the weighted % to quota. */
  kpis: Record<string, { att: number | null; goals: KpiGoal[] }>
  goals: GoalRow[]
  oneOnOnes: OneOnOneRow[]
  items: ItemRow[]
  praise: PraiseRow[]
  /** Open project cards by member id (Boards). */
  cards: Record<string, CardLite[]>
}

// ── Access ──────────────────────────────────────────────────────────────────

export type Viewer = {
  repId: string
  memberId: string
  role: string
  /** Their own cxo_employees row, when their login is linked to one. */
  employeeId: string | null
  /** An employee login (rep / observer on an exec org). */
  employeeOnly: boolean
  /** An assistant working an exec's seat: never sees private feedback. */
  assistant?: boolean
}

/** Owner or admin on an exec login: sees every employee. */
export function seesEveryone(v: Viewer): boolean {
  return !v.employeeOnly && (v.role === 'owner' || v.role === 'admin')
}
const isSelf = (v: Viewer, p: Pick<PersonLite, 'id' | 'member_id'>) => (!!v.employeeId && p.id === v.employeeId) || (!!p.member_id && p.member_id === v.memberId)
/** Runs this person's work: an owner/admin, or their direct manager. */
export function canManagePerson(v: Viewer, p: Pick<PersonLite, 'id' | 'member_id' | 'manager_id'>): boolean {
  return seesEveryone(v) || (!!v.employeeId && p.manager_id === v.employeeId)
}
/** May open this person's page (goals, 1:1, cards). */
export function canViewPerson(v: Viewer, p: Pick<PersonLite, 'id' | 'member_id' | 'manager_id'>): boolean {
  return isSelf(v, p) || canManagePerson(v, p)
}
export function visiblePeople<T extends Pick<PersonLite, 'id' | 'member_id' | 'manager_id'>>(v: Viewer, employees: T[]): T[] {
  return employees.filter((p) => canViewPerson(v, p))
}
/** One of the two people in the 1:1 (or an owner/admin): may read and add to it. */
export function inOneOnOne(v: Viewer, p: Pick<PersonLite, 'id' | 'member_id' | 'manager_id'>, oo: Pick<OneOnOneRow, 'manager_member_id'> | null): boolean {
  return canViewPerson(v, p) || (!!oo?.manager_member_id && oo.manager_member_id === v.memberId)
}
/** Private feedback: the employee, whoever runs the 1:1, and the org owner/admin. */
export function canSeeFeedback(v: Viewer, p: Pick<PersonLite, 'id' | 'member_id'>, oo: Pick<OneOnOneRow, 'manager_member_id'> | null): boolean {
  if (v.assistant) return false
  if (seesEveryone(v)) return true
  if (isSelf(v, p)) return true
  return !!oo?.manager_member_id && oo.manager_member_id === v.memberId
}

// ── The hub (what a viewer gets) ────────────────────────────────────────────

export type GoalView = {
  id: string
  source: 'quota' | 'goal'
  title: string
  unit: KpiGoal['unit']
  target: number
  current: number | null
  /** 1 = 100%. */
  att: number | null
  /** A due date, or the quota's period ("Oct 2026"). */
  due: string | null
  due_date: string | null
  status: 'done' | 'on_track' | 'behind' | 'overdue' | 'no_data'
}
export const GOAL_STATUS_WORDS: Record<GoalView['status'], string> = { done: 'Done', on_track: 'On track', behind: 'Behind', overdue: 'Past due', no_data: 'No numbers yet' }

export type ItemView = Omit<ItemRow, 'one_on_one_id'>
export type OneOnOneView = Omit<OneOnOneRow, 'calendar_event_id'> & { on_calendar: boolean; overdue: boolean; items: ItemView[]; sees_feedback: boolean }
export type PraiseView = { id: string; from_name: string; to_employee_id: string; to_name: string; value: string | null; body: string; created_at: string }
export type DirectoryRow = { id: string; name: string; title: string | null; department: string }

export type PersonView = DirectoryRow & {
  manager_name: string | null
  is_self: boolean
  can_manage: boolean
  has_login: boolean
  /** Weighted % to quota across their goals (1 = 100%); null with no numbers. */
  att: number | null
  goals: GoalView[]
  one_on_one: OneOnOneView | null
  praise_30: number
  open_cards: number
  cards: CardLite[]
}

export type PeopleHubData = {
  /** False until the tables exist: every view shows its empty state. */
  ready: boolean
  today: string
  viewer: { member_id: string; employee_id: string | null; name: string; sees_everyone: boolean; employee_only: boolean }
  directory: DirectoryRow[]
  people: PersonView[]
  praise: PraiseView[]
  values: string[]
  calendar_ready: boolean
}

export function goalView(g: GoalRow, today: string): GoalView {
  const att = g.target > 0 ? g.current / g.target : null
  const done = g.status === 'done' || (att != null && att >= 1 - 1e-9)
  const status: GoalView['status'] = done ? 'done' : g.due_date && g.due_date < today ? 'overdue' : 'on_track'
  return { id: g.id, source: 'goal', title: g.title, unit: g.unit, target: g.target, current: g.current, att, due: g.due_date ? dayWords(g.due_date) : null, due_date: g.due_date, status }
}
export function kpiGoalView(k: KpiGoal): GoalView {
  const status: GoalView['status'] = k.pace === 'met' ? 'done' : k.pace === 'on_pace' ? 'on_track' : k.pace === 'behind' ? 'behind' : 'no_data'
  return { id: `quota:${k.id}`, source: 'quota', title: k.title, unit: k.unit, target: k.target, current: k.current, att: k.att, due: k.period, due_date: null, status }
}

/** One number for a person: quota attainment, or the average of their own goals when they have no quota. */
export function overallAtt(kpiAtt: number | null, goals: GoalView[]): number | null {
  if (kpiAtt != null) return kpiAtt
  const own = goals.filter((g) => g.source === 'goal' && g.att != null)
  if (!own.length) return null
  return own.reduce((s, g) => s + Math.min(1, g.att ?? 0), 0) / own.length
}

/**
 * Everything one viewer may see, and nothing else. Raw rows for people the
 * viewer cannot open never leave this function; feedback items are dropped
 * unless the viewer is one of the two people or an owner/admin.
 */
export function assembleHub(v: Viewer, raw: RawPeople, opts: { today: string; viewerName: string; values?: string[]; calendarReady?: boolean; ready?: boolean }): PeopleHubData {
  const today = opts.today
  const byId = new Map(raw.employees.map((e) => [e.id, e]))
  const ooByEmp = new Map(raw.oneOnOnes.map((o) => [o.employee_id, o]))
  const since = addDays(today, -30)
  const praiseCount = new Map<string, number>()
  for (const p of raw.praise) if (p.created_at.slice(0, 10) >= since) praiseCount.set(p.to_employee_id, (praiseCount.get(p.to_employee_id) ?? 0) + 1)

  const people: PersonView[] = raw.employees
    .filter((p) => {
      const oo = ooByEmp.get(p.id) ?? null
      return inOneOnOne(v, p, oo)
    })
    .map((p) => {
      const oo = ooByEmp.get(p.id) ?? null
      const feedback = canSeeFeedback(v, p, oo)
      const goals = [...(raw.kpis[p.id]?.goals ?? []).map(kpiGoalView), ...raw.goals.filter((g) => g.employee_id === p.id).map((g) => goalView(g, today))]
      const cards = p.member_id ? raw.cards[p.member_id] ?? [] : []
      return {
        id: p.id,
        name: p.name,
        title: p.title,
        department: p.department,
        manager_name: p.manager_id ? byId.get(p.manager_id)?.name ?? null : null,
        is_self: isSelf(v, p),
        can_manage: canManagePerson(v, p),
        has_login: !!p.member_id,
        att: overallAtt(raw.kpis[p.id]?.att ?? null, goals),
        goals,
        one_on_one: oo
          ? {
              id: oo.id,
              employee_id: oo.employee_id,
              manager_member_id: oo.manager_member_id,
              manager_name: oo.manager_name,
              cadence: oo.cadence,
              next_date: oo.next_date,
              last_date: oo.last_date,
              on_calendar: !!oo.calendar_event_id,
              overdue: isOverdue(oo, today),
              sees_feedback: feedback,
              items: raw.items
                .filter((i) => i.one_on_one_id === oo.id && (i.kind !== 'feedback' || feedback))
                .map(({ one_on_one_id: _drop, ...rest }) => rest),
            }
          : null,
        praise_30: praiseCount.get(p.id) ?? 0,
        open_cards: cards.length,
        cards: cards.slice(0, 12),
      }
    })
    .sort((a, b) => Number(b.is_self) - Number(a.is_self) || a.name.localeCompare(b.name))

  return {
    ready: opts.ready ?? true,
    today,
    viewer: { member_id: v.memberId, employee_id: v.employeeId, name: opts.viewerName, sees_everyone: seesEveryone(v), employee_only: v.employeeOnly },
    directory: raw.employees.map((e) => ({ id: e.id, name: e.name, title: e.title, department: e.department })).sort((a, b) => a.name.localeCompare(b.name)),
    people,
    praise: raw.praise
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 60)
      .map((p) => ({ id: p.id, from_name: p.from_name, to_employee_id: p.to_employee_id, to_name: byId.get(p.to_employee_id)?.name ?? 'A colleague', value: p.value, body: p.body, created_at: p.created_at })),
    values: opts.values ?? DEFAULT_VALUES,
    calendar_ready: !!opts.calendarReady,
  }
}

export const EMPTY_RAW: RawPeople = { employees: [], kpis: {}, goals: [], oneOnOnes: [], items: [], praise: [], cards: {} }

/** The actions the people API takes; the demo runs the same ones in memory. */
export type PeopleAction =
  | { action: 'praise'; to_employee_id: string; body: string; value?: string | null }
  | { action: 'oo_save'; employee_id: string; cadence: Cadence; next_date: string | null; time?: string | null; calendar?: boolean }
  | { action: 'oo_done'; employee_id: string }
  | { action: 'item_add'; employee_id: string; kind: ItemKind; body: string; owner?: 'employee' | 'manager' | null }
  | { action: 'item_toggle'; employee_id: string; id: string; done: boolean }
  | { action: 'item_remove'; employee_id: string; id: string }
  | { action: 'goal_save'; employee_id: string; id?: string | null; title: string; unit: GoalUnit; target: number; current: number; due_date: string | null }
  | { action: 'goal_progress'; employee_id: string; id: string; current: number }
  | { action: 'goal_remove'; employee_id: string; id: string }

export type PeopleApi = {
  load: () => Promise<PeopleHubData>
  act: (a: PeopleAction) => Promise<{ note?: string }>
}

export class PeopleRefused extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

/**
 * The one rule table for writes. Returns nothing when allowed and throws
 * PeopleRefused otherwise. `person` is the target employee in the viewer's
 * own org (the caller looks it up by rep_id first; unknown = refused).
 */
export function assertMay(v: Viewer, a: PeopleAction, person: PersonLite | null, oo: OneOnOneRow | null, item?: Pick<ItemRow, 'kind' | 'author_member_id'> | null): void {
  if (!person) throw new PeopleRefused('That person is not in your company.', 404)
  switch (a.action) {
    case 'praise':
      if (isSelf(v, person)) throw new PeopleRefused('Praise is for a colleague, not yourself.', 400)
      return
    case 'oo_save':
    case 'goal_save':
    case 'goal_remove':
      if (!canManagePerson(v, person)) throw new PeopleRefused('Only their manager or an admin can change that.')
      return
    case 'oo_done':
      if (!canManagePerson(v, person) && !(!!oo?.manager_member_id && oo.manager_member_id === v.memberId)) throw new PeopleRefused('Only their manager or an admin can change that.')
      return
    case 'goal_progress':
      if (!canViewPerson(v, person)) throw new PeopleRefused('You can only update your own goals or your team’s.')
      return
    case 'item_add':
      if (!inOneOnOne(v, person, oo)) throw new PeopleRefused('That 1:1 is not yours.')
      if (a.kind === 'feedback' && !canSeeFeedback(v, person, oo)) throw new PeopleRefused('Private feedback is between the two people in the 1:1.')
      return
    case 'item_toggle':
    case 'item_remove':
      if (!inOneOnOne(v, person, oo)) throw new PeopleRefused('That 1:1 is not yours.')
      if (item?.kind === 'feedback' && !canSeeFeedback(v, person, oo)) throw new PeopleRefused('Private feedback is between the two people in the 1:1.')
      if (a.action === 'item_remove' && item && item.author_member_id !== v.memberId && !canManagePerson(v, person)) throw new PeopleRefused('Only the person who wrote it can remove it.')
      return
  }
}

export function fmtGoalValue(unit: GoalView['unit'], v: number | null | undefined): string {
  if (v == null) return '—'
  if (unit === 'usd') return `$${Math.round(v).toLocaleString('en-US')}`
  if (unit === 'pct') return `${Number(v.toFixed(1))}%`
  const n = Number(v.toFixed(1)).toLocaleString('en-US')
  return unit === 'days' ? `${n} days` : unit === 'hours' ? `${n} hrs` : n
}
