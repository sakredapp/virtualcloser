/**
 * Praise, 1:1s and goals (owner 10-11). These pin who may see and change what:
 *   - an employee gets their own page and the praise feed, never a colleague's
 *     page, 1:1 or private feedback;
 *   - a manager gets their direct reports and nobody else;
 *   - an owner/admin gets everyone; an assistant never gets private feedback;
 *   - nothing crosses orgs: a person in another org is "not in your company";
 *   - the Mira tools follow the same rules and never return what was said.
 * Everything is mocked: no database, no Google, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const todos: Array<{ repId: string; memberId: string; text: string }> = []
let idSeq = 0

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Row | Row[] | null = null
  let lim = Infinity
  let single = false
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: `id${++idSeq}`, created_at: new Date(Date.UTC(2026, 9, 10, 12, 0, idSeq)).toISOString(), ...p }))
      rows().push(...list)
      return { data: single ? list[0] : list, error: null }
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      for (const r of hit) Object.assign(r, payload)
      return { data: hit, error: null }
    }
    if (op === 'delete') {
      db[table] = rows().filter((r) => !hit.includes(r))
      return { data: hit, error: null }
    }
    const out = hit.slice(0, lim)
    return { data: single ? out[0] ?? null : out, error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
    update: (p: Row) => { op = 'update'; payload = p; return b },
    delete: () => { op = 'delete'; return b },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b },
    order: () => b,
    limit: (n: number) => { lim = n; return b },
    single: () => { single = true; return b },
    maybeSingle: () => { single = true; return b },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/lib/today', () => ({
  addTodo: async (repId: string, memberId: string, text: string) => {
    todos.push({ repId, memberId, text })
    return { id: `todo${todos.length}` }
  },
  updateTodo: async () => null,
}))
vi.mock('@/lib/employees/data', () => ({
  loadEmployees: async (repId: string) => ({ employees: (db.cxo_employees ?? []).filter((e) => e.rep_id === repId && e.active), kpis: [], actuals: [], tiers: [], reviews: [], timeOff: [] }),
  employeeForMember: async (repId: string, memberId: string) => (db.cxo_employees ?? []).find((e) => e.rep_id === repId && e.member_id === memberId && e.active) ?? null,
}))
vi.mock('@/lib/cxoCalendar', () => ({ calendarWriteReady: async () => ({ canWrite: false }), createEventWithInvites: async () => ({ ok: false }) }))

import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { EMPLOYEE_TOOLS, canCallTool, isEmployeeCaller } from '@/lib/agent/access'
import { TOOL_HANDLERS, type AgentContext } from '@/lib/agent/tools'
import { employeePathAllowed } from '@/lib/employees/access'
import { runPeopleAction } from '@/lib/people/data'
import { assembleHub, assertMay, canSeeFeedback, isOverdue, nextAfter, PeopleRefused, visiblePeople, type ItemRow, type OneOnOneRow, type PeopleAction, type PersonLite, type RawPeople, type Viewer } from '@/lib/people/shared'

const TODAY = '2026-10-10'
const ACME = 'rep-acme'
const OTHER = 'rep-other'

// Olivia owns the org. Mona manages Erin and Carl. Dee is in another team.
const PEOPLE: PersonLite[] = [
  { id: '00000000-0000-4000-8000-00000000000a', name: 'Mona Reed', title: 'Head of Sales', department: 'Sales', manager_id: null, member_id: 'm-mona' },
  { id: '00000000-0000-4000-8000-00000000000b', name: 'Erin Vale', title: 'Account Manager', department: 'Sales', manager_id: '00000000-0000-4000-8000-00000000000a', member_id: 'm-erin' },
  { id: '00000000-0000-4000-8000-00000000000c', name: 'Carl Hobbs', title: 'Account Manager', department: 'Sales', manager_id: '00000000-0000-4000-8000-00000000000a', member_id: 'm-carl' },
  { id: '00000000-0000-4000-8000-00000000000d', name: 'Dee Lang', title: 'Analyst', department: 'Operations', manager_id: null, member_id: 'm-dee' },
]
const OOS: OneOnOneRow[] = [
  { id: 'oo-erin', employee_id: '00000000-0000-4000-8000-00000000000b', manager_member_id: 'm-mona', manager_name: 'Mona Reed', cadence: 'weekly', next_date: '2026-10-12', last_date: '2026-10-05', calendar_event_id: null },
  { id: 'oo-carl', employee_id: '00000000-0000-4000-8000-00000000000c', manager_member_id: 'm-mona', manager_name: 'Mona Reed', cadence: 'biweekly', next_date: '2026-10-06', last_date: '2026-09-22', calendar_event_id: null },
  { id: 'oo-dee', employee_id: '00000000-0000-4000-8000-00000000000d', manager_member_id: 'm-olivia', manager_name: 'Olivia', cadence: 'monthly', next_date: '2026-10-20', last_date: null, calendar_event_id: null },
]
const it0 = (id: string, oo: string, kind: ItemRow['kind'], body: string, author: string): ItemRow => ({ id, one_on_one_id: oo, kind, body, author_member_id: author, author_name: author, owner_member_id: null, owner_name: null, done_at: null, created_at: '2026-10-08T12:00:00.000Z' })
const ITEMS: ItemRow[] = [
  it0('i1', 'oo-erin', 'agenda', 'ERIN-AGENDA', 'm-erin'),
  it0('i2', 'oo-erin', 'feedback', 'ERIN-PRIVATE', 'm-mona'),
  it0('i3', 'oo-carl', 'feedback', 'CARL-PRIVATE', 'm-mona'),
  it0('i4', 'oo-dee', 'feedback', 'DEE-PRIVATE', 'm-olivia'),
]
const RAW = (): RawPeople => ({
  employees: PEOPLE,
  kpis: {},
  goals: [{ id: 'g1', employee_id: '00000000-0000-4000-8000-00000000000c', title: 'CARL-GOAL', unit: 'count', target: 10, current: 4, due_date: '2026-11-01', status: 'active' }],
  oneOnOnes: OOS,
  items: ITEMS,
  praise: [{ id: 'p1', from_member_id: 'm-mona', from_name: 'Mona Reed', to_employee_id: '00000000-0000-4000-8000-00000000000c', value: 'Teamwork', body: 'Great save', created_at: '2026-10-09T12:00:00.000Z' }],
  cards: { 'm-carl': [{ id: 'c1', title: 'CARL-CARD', board: 'Q4', due_date: null }] },
})

const viewer = (memberId: string, role: string, employeeId: string | null, employeeOnly: boolean, extra: Partial<Viewer> = {}): Viewer => ({ repId: ACME, memberId, role, employeeId, employeeOnly, ...extra })
const OLIVIA = viewer('m-olivia', 'owner', null, false)
const ADMIN = viewer('m-ada', 'admin', null, false)
const MONA = viewer('m-mona', 'manager', '00000000-0000-4000-8000-00000000000a', false)
const ERIN = viewer('m-erin', 'rep', '00000000-0000-4000-8000-00000000000b', true)
const CARL = viewer('m-carl', 'rep', '00000000-0000-4000-8000-00000000000c', true)
const ASSISTANT = viewer('m-olivia', 'owner', null, false, { assistant: true })
const hubFor = (v: Viewer) => assembleHub(v, RAW(), { today: TODAY, viewerName: 'x' })
const names = (v: Viewer) => hubFor(v).people.map((p) => p.name).sort()
const refusal = (fn: () => void): number | null => {
  try {
    fn()
    return null
  } catch (e) {
    if (e instanceof PeopleRefused) return e.status
    throw e
  }
}
const person = (id: string) => PEOPLE.find((p) => p.id === id)!
const ooOf = (id: string) => OOS.find((o) => o.employee_id === id) ?? null

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  todos.length = 0
  idSeq = 0
  db.cxo_employees = [
    ...PEOPLE.map((p) => ({ ...p, rep_id: ACME, active: true })),
    { id: '00000000-0000-4000-8000-00000000000e', name: 'Zed Other', title: null, department: 'Sales', manager_id: null, member_id: 'm-zed', rep_id: OTHER, active: true },
  ]
  db.cxo_one_on_ones = [
    ...OOS.map((o) => ({ ...o, rep_id: ACME })),
    { id: 'oo-zed', employee_id: '00000000-0000-4000-8000-00000000000e', manager_member_id: 'm-zboss', manager_name: 'Z Boss', cadence: 'weekly', next_date: '2026-10-12', last_date: null, calendar_event_id: null, rep_id: OTHER },
  ]
  db.cxo_one_on_one_items = [...ITEMS.map((i) => ({ ...i, rep_id: ACME })), { ...it0('iz', 'oo-zed', 'feedback', 'ZED-PRIVATE', 'm-zboss'), rep_id: OTHER }]
  db.cxo_goals = [{ id: 'g1', rep_id: ACME, employee_id: '00000000-0000-4000-8000-00000000000c', title: 'CARL-GOAL', unit: 'count', target: 10, current: 4, due_date: '2026-11-01', status: 'active' }]
  db.cxo_praise = []
  db.cxo_followup_notices = []
})

describe('who sees whom', () => {
  it('an employee sees only their own page', () => {
    expect(names(ERIN)).toEqual(['Erin Vale'])
    expect(visiblePeople(ERIN, PEOPLE).map((p) => p.id)).toEqual(['00000000-0000-4000-8000-00000000000b'])
    const text = JSON.stringify(hubFor(ERIN).people)
    for (const leak of ['CARL-GOAL', 'CARL-CARD', 'CARL-PRIVATE', 'DEE-PRIVATE']) expect(text).not.toContain(leak)
  })
  it('an employee still gets the org praise feed and the name list to praise from', () => {
    const hub = hubFor(ERIN)
    expect(hub.praise.map((p) => p.to_name)).toEqual(['Carl Hobbs'])
    expect(hub.directory.map((d) => d.name)).toContain('Dee Lang')
    expect(Object.keys(hub.directory[0]).sort()).toEqual(['department', 'id', 'name', 'title'])
  })
  it('a manager sees themself and their direct reports, nobody else', () => {
    expect(names(MONA)).toEqual(['Carl Hobbs', 'Erin Vale', 'Mona Reed'])
    expect(JSON.stringify(hubFor(MONA).people)).not.toContain('DEE-PRIVATE')
  })
  it('a manager login that is not linked to an employee record sees nobody', () => {
    expect(names(viewer('m-ghost', 'manager', null, false))).toEqual([])
  })
  it('owner and admin see everyone', () => {
    expect(names(OLIVIA)).toHaveLength(4)
    expect(names(ADMIN)).toHaveLength(4)
  })
  it('a rep-role login is never treated as an admin, whatever its role says', () => {
    expect(names(viewer('m-erin', 'owner', '00000000-0000-4000-8000-00000000000b', true))).toEqual(['Erin Vale'])
  })
})

describe('private feedback', () => {
  const bodies = (v: Viewer) => hubFor(v).people.flatMap((p) => p.one_on_one?.items ?? []).filter((i) => i.kind === 'feedback').map((i) => i.body).sort()
  it('the employee sees their own and nobody else’s', () => {
    expect(bodies(ERIN)).toEqual(['ERIN-PRIVATE'])
    expect(bodies(CARL)).toEqual(['CARL-PRIVATE'])
  })
  it('the manager who runs the 1:1 sees it; owner and admin see all', () => {
    expect(bodies(MONA)).toEqual(['CARL-PRIVATE', 'ERIN-PRIVATE'])
    expect(bodies(OLIVIA)).toEqual(['CARL-PRIVATE', 'DEE-PRIVATE', 'ERIN-PRIVATE'])
    expect(bodies(ADMIN)).toEqual(['CARL-PRIVATE', 'DEE-PRIVATE', 'ERIN-PRIVATE'])
  })
  it('an assistant working an exec’s seat never sees it', () => {
    expect(bodies(ASSISTANT)).toEqual([])
    expect(canSeeFeedback(ASSISTANT, person('00000000-0000-4000-8000-00000000000b'), ooOf('00000000-0000-4000-8000-00000000000b'))).toBe(false)
  })
  it('a manager who takes over the reporting line does not inherit feedback from a 1:1 they do not run', () => {
    const newBoss = viewer('m-new', 'manager', '00000000-0000-4000-8000-00000000000a', false)
    expect(canSeeFeedback(newBoss, person('00000000-0000-4000-8000-00000000000b'), ooOf('00000000-0000-4000-8000-00000000000b'))).toBe(false)
  })
})

describe('what each may change', () => {
  const add = (employee_id: string, kind: ItemRow['kind']): PeopleAction => ({ action: 'item_add', employee_id, kind, body: 'x' })
  it('an employee cannot touch a colleague’s 1:1, goals or feedback', () => {
    expect(refusal(() => assertMay(ERIN, add('00000000-0000-4000-8000-00000000000c', 'agenda'), person('00000000-0000-4000-8000-00000000000c'), ooOf('00000000-0000-4000-8000-00000000000c')))).toBe(403)
    expect(refusal(() => assertMay(ERIN, add('00000000-0000-4000-8000-00000000000c', 'feedback'), person('00000000-0000-4000-8000-00000000000c'), ooOf('00000000-0000-4000-8000-00000000000c')))).toBe(403)
    expect(refusal(() => assertMay(ERIN, { action: 'goal_progress', employee_id: '00000000-0000-4000-8000-00000000000c', id: 'g1', current: 9 }, person('00000000-0000-4000-8000-00000000000c'), null))).toBe(403)
    expect(refusal(() => assertMay(ERIN, { action: 'item_toggle', employee_id: '00000000-0000-4000-8000-00000000000c', id: 'i3', done: true }, person('00000000-0000-4000-8000-00000000000c'), ooOf('00000000-0000-4000-8000-00000000000c'), ITEMS[2]))).toBe(403)
  })
  it('an employee adds to their own 1:1 but cannot set it up or set their own goals', () => {
    expect(refusal(() => assertMay(ERIN, add('00000000-0000-4000-8000-00000000000b', 'agenda'), person('00000000-0000-4000-8000-00000000000b'), ooOf('00000000-0000-4000-8000-00000000000b')))).toBeNull()
    expect(refusal(() => assertMay(ERIN, add('00000000-0000-4000-8000-00000000000b', 'feedback'), person('00000000-0000-4000-8000-00000000000b'), ooOf('00000000-0000-4000-8000-00000000000b')))).toBeNull()
    expect(refusal(() => assertMay(ERIN, { action: 'oo_save', employee_id: '00000000-0000-4000-8000-00000000000b', cadence: 'weekly', next_date: null }, person('00000000-0000-4000-8000-00000000000b'), ooOf('00000000-0000-4000-8000-00000000000b')))).toBe(403)
    expect(refusal(() => assertMay(ERIN, { action: 'goal_save', employee_id: '00000000-0000-4000-8000-00000000000b', title: 't', unit: 'count', target: 1, current: 0, due_date: null }, person('00000000-0000-4000-8000-00000000000b'), null))).toBe(403)
  })
  it('a manager runs their reports’ 1:1s and goals, not another team’s', () => {
    expect(refusal(() => assertMay(MONA, { action: 'oo_save', employee_id: '00000000-0000-4000-8000-00000000000c', cadence: 'weekly', next_date: null }, person('00000000-0000-4000-8000-00000000000c'), ooOf('00000000-0000-4000-8000-00000000000c')))).toBeNull()
    expect(refusal(() => assertMay(MONA, { action: 'oo_save', employee_id: '00000000-0000-4000-8000-00000000000d', cadence: 'weekly', next_date: null }, person('00000000-0000-4000-8000-00000000000d'), ooOf('00000000-0000-4000-8000-00000000000d')))).toBe(403)
    expect(refusal(() => assertMay(MONA, add('00000000-0000-4000-8000-00000000000d', 'note'), person('00000000-0000-4000-8000-00000000000d'), ooOf('00000000-0000-4000-8000-00000000000d')))).toBe(403)
  })
  it('anyone may praise a colleague, nobody may praise themself', () => {
    expect(refusal(() => assertMay(ERIN, { action: 'praise', to_employee_id: '00000000-0000-4000-8000-00000000000d', body: 'x' }, person('00000000-0000-4000-8000-00000000000d'), null))).toBeNull()
    expect(refusal(() => assertMay(ERIN, { action: 'praise', to_employee_id: '00000000-0000-4000-8000-00000000000b', body: 'x' }, person('00000000-0000-4000-8000-00000000000b'), null))).toBe(400)
  })
  it('a person who is not in the org is refused before any rule runs', () => {
    expect(refusal(() => assertMay(OLIVIA, { action: 'praise', to_employee_id: '00000000-0000-4000-8000-00000000000e', body: 'x' }, null, null))).toBe(404)
  })
})

describe('dates', () => {
  it('overdue means the next date has passed', () => {
    expect(isOverdue({ next_date: '2026-10-09' }, TODAY)).toBe(true)
    expect(isOverdue({ next_date: TODAY }, TODAY)).toBe(false)
    expect(isOverdue({ next_date: null }, TODAY)).toBe(false)
    expect(hubFor(MONA).people.find((p) => p.id === '00000000-0000-4000-8000-00000000000c')!.one_on_one!.overdue).toBe(true)
  })
  it('the next 1:1 follows the cadence', () => {
    expect(nextAfter('2026-10-10', 'weekly')).toBe('2026-10-17')
    expect(nextAfter('2026-10-10', 'biweekly')).toBe('2026-10-24')
    expect(nextAfter('2026-10-10', 'monthly') > '2026-11-01').toBe(true)
  })
})

describe('the server runs the same rules against the database', () => {
  const who = (v: Viewer, name = 'Someone') => ({ viewer: v, name, tz: 'America/New_York' })
  const status = async (p: Promise<unknown>): Promise<number | null> => {
    try {
      await p
      return null
    } catch (e) {
      if (e instanceof PeopleRefused) return e.status
      throw e
    }
  }

  it('praise posts for a colleague and raises one notice for them', async () => {
    expect(await status(runPeopleAction(who(ERIN, 'Erin Vale'), { action: 'praise', to_employee_id: '00000000-0000-4000-8000-00000000000c', body: 'Great save', value: 'Teamwork' }))).toBeNull()
    expect(db.cxo_praise).toHaveLength(1)
    expect(db.cxo_praise[0]).toMatchObject({ rep_id: ACME, from_member_id: 'm-erin', to_employee_id: '00000000-0000-4000-8000-00000000000c' })
    expect(db.cxo_followup_notices).toHaveLength(1)
    expect(db.cxo_followup_notices[0]).toMatchObject({ rep_id: ACME, member_id: 'm-carl', kind: 'praise' })
  })
  it('cross-org is refused: another org’s person does not exist for you', async () => {
    expect(await status(runPeopleAction(who(OLIVIA), { action: 'praise', to_employee_id: '00000000-0000-4000-8000-00000000000e', body: 'hi' }))).toBe(404)
    expect(await status(runPeopleAction(who(OLIVIA), { action: 'item_add', employee_id: '00000000-0000-4000-8000-00000000000e', kind: 'feedback', body: 'hi' }))).toBe(404)
    expect(await status(runPeopleAction(who(OLIVIA), { action: 'item_remove', employee_id: '00000000-0000-4000-8000-00000000000e', id: 'iz' }))).toBe(404)
    expect(await status(runPeopleAction(who(OLIVIA), { action: 'goal_save', employee_id: '00000000-0000-4000-8000-00000000000e', title: 't', unit: 'count', target: 1, current: 0, due_date: null }))).toBe(404)
    expect(db.cxo_praise).toHaveLength(0)
    expect(db.cxo_one_on_one_items.filter((i) => i.rep_id === OTHER)).toHaveLength(1)
    expect(db.cxo_goals).toHaveLength(1)
  })
  it('an item id from someone else’s 1:1 cannot be reached through your own', async () => {
    // Erin names her own 1:1 but Carl's private feedback item.
    expect(await status(runPeopleAction(who(ERIN), { action: 'item_remove', employee_id: '00000000-0000-4000-8000-00000000000b', id: 'i3' }))).toBe(404)
    expect(await status(runPeopleAction(who(ERIN), { action: 'item_toggle', employee_id: '00000000-0000-4000-8000-00000000000b', id: 'i3', done: true }))).toBe(404)
    expect(db.cxo_one_on_one_items.find((i) => i.id === 'i3')).toMatchObject({ body: 'CARL-PRIVATE', done_at: null })
  })
  it('an employee cannot write into a colleague’s 1:1 or change their goal', async () => {
    expect(await status(runPeopleAction(who(ERIN), { action: 'item_add', employee_id: '00000000-0000-4000-8000-00000000000c', kind: 'feedback', body: 'x' }))).toBe(403)
    expect(await status(runPeopleAction(who(ERIN), { action: 'goal_progress', employee_id: '00000000-0000-4000-8000-00000000000c', id: 'g1', current: 10 }))).toBe(403)
    expect(await status(runPeopleAction(who(ERIN), { action: 'goal_remove', employee_id: '00000000-0000-4000-8000-00000000000c', id: 'g1' }))).toBe(403)
    expect(db.cxo_one_on_one_items).toHaveLength(5)
    expect(db.cxo_goals[0]).toMatchObject({ current: 4 })
  })
  it('an action item with an owner lands in that person’s to-dos, in their org', async () => {
    expect(await status(runPeopleAction(who(MONA, 'Mona Reed'), { action: 'item_add', employee_id: '00000000-0000-4000-8000-00000000000b', kind: 'action', body: 'Send the plan', owner: 'employee' }))).toBeNull()
    expect(todos).toEqual([{ repId: ACME, memberId: 'm-erin', text: 'Send the plan' }])
    expect(db.cxo_one_on_one_items.at(-1)).toMatchObject({ kind: 'action', owner_member_id: 'm-erin', todo_id: 'todo1', rep_id: ACME })
  })
  it('a talking point or a note raises no to-do', async () => {
    await runPeopleAction(who(ERIN, 'Erin Vale'), { action: 'item_add', employee_id: '00000000-0000-4000-8000-00000000000b', kind: 'agenda', body: 'Travel budget' })
    expect(todos).toHaveLength(0)
  })
  it('marking a 1:1 done moves the next date on by the cadence', async () => {
    expect(await status(runPeopleAction(who(ERIN), { action: 'oo_done', employee_id: '00000000-0000-4000-8000-00000000000b' }))).toBe(403)
    expect(await status(runPeopleAction(who(MONA), { action: 'oo_done', employee_id: '00000000-0000-4000-8000-00000000000c' }))).toBeNull()
    const oo = db.cxo_one_on_ones.find((o) => o.id === 'oo-carl')!
    expect(oo.last_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(oo.next_date).toBe(nextAfter(String(oo.last_date), 'biweekly'))
  })
})

describe('Mira tools', () => {
  const TENANT = { id: ACME, slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: 'America/New_York', settings: {} } as unknown as Tenant
  const member = (id: string, role: string, name: string) => ({ id, rep_id: ACME, role, display_name: name, email: `${id}@acme.test`, timezone: 'America/New_York', is_active: true, settings: {} }) as unknown as Member
  const ctxFor = (caller: Member): AgentContext => ({ tenant: TENANT, caller, timezone: 'America/New_York', todayIso: TODAY, ownerMemberId: caller.id, selfOnly: isEmployeeCaller(caller, TENANT) }) as AgentContext
  const call = async (name: string, caller: Member, args: Row) => JSON.parse((await TOOL_HANDLERS[name](ctxFor(caller), args)).text) as Row & { one_on_ones?: Row[] }
  const M_ERIN = member('m-erin', 'rep', 'Erin Vale')
  const M_MONA = member('m-mona', 'manager', 'Mona Reed')

  it('the three tools exist and an employee login may call them', () => {
    for (const name of ['give_praise', 'list_one_on_ones', 'add_talking_point']) {
      expect(TOOL_HANDLERS[name], name).toBeTypeOf('function')
      expect(EMPLOYEE_TOOLS.has(name), name).toBe(true)
      expect(canCallTool(name, true), name).toBe(true)
    }
  })
  it('the people API is on the employee allow-list; nothing next to it is', () => {
    expect(employeePathAllowed('/api/people')).toBe(true)
    expect(employeePathAllowed('/api/peoplex')).toBe(false)
    expect(employeePathAllowed('/dashboard/employees')).toBe(false)
  })
  it('list_one_on_ones: an employee gets only their own, and never what was said', async () => {
    const out = await call('list_one_on_ones', M_ERIN, {})
    expect(out.one_on_ones!.map((r) => r.person)).toEqual(['Erin Vale'])
    const text = JSON.stringify(out)
    for (const leak of ['ERIN-PRIVATE', 'ERIN-AGENDA', 'CARL', 'Carl', 'Dee']) expect(text).not.toContain(leak)
  })
  it('list_one_on_ones: a manager sees their reports and who is overdue', async () => {
    const out = await call('list_one_on_ones', M_MONA, { overdue_only: true })
    expect(out.one_on_ones!.map((r) => r.person)).toEqual(['Carl Hobbs'])
    expect(JSON.stringify(out)).not.toContain('PRIVATE')
  })
  it('give_praise posts through the same rules', async () => {
    const ok = await call('give_praise', M_ERIN, { person: 'Carl', note: 'Great save' })
    expect(ok).toMatchObject({ ok: true, praised: 'Carl Hobbs' })
    expect(db.cxo_praise).toHaveLength(1)
    const self = await call('give_praise', M_ERIN, { person: 'Erin Vale', note: 'I am great' })
    expect(self.ok).toBe(false)
    const other = await call('give_praise', M_ERIN, { person: 'Zed Other', note: 'hi' })
    expect(other.ok).toBe(false)
    expect(db.cxo_praise).toHaveLength(1)
  })
  it('add_talking_point: own 1:1 by default; a colleague’s is out of reach', async () => {
    const mine = await call('add_talking_point', M_ERIN, { point: 'Travel budget' })
    expect(mine.ok).toBe(true)
    expect(db.cxo_one_on_one_items.at(-1)).toMatchObject({ one_on_one_id: 'oo-erin', kind: 'agenda', body: 'Travel budget', author_member_id: 'm-erin' })
    const before = db.cxo_one_on_one_items.length
    const theirs = await call('add_talking_point', M_ERIN, { point: 'Sneaky', person: 'Carl Hobbs' })
    expect(theirs.ok).toBe(false)
    expect(db.cxo_one_on_one_items).toHaveLength(before)
  })
})
