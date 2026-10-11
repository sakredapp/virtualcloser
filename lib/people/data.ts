/**
 * Suite CXO people layer, the server side: load one viewer's hub and run the
 * writes. Every query is scoped by rep_id; who may see or change what is
 * decided by lib/people/shared (assembleHub, assertMay), never by the client.
 *
 * Fail soft: until supabase/cxo_praise_one_on_ones.sql has run, the tables
 * are missing. Reads then return an empty hub with ready:false and writes
 * answer PeopleRefused(…, 409); nothing throws a 500 for a missing table.
 */
import { supabase } from '@/lib/supabase'
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { employeeForMember, loadEmployees } from '@/lib/employees/data'
import { employeeSnapshot, periodLabel } from '@/lib/employees/shared'
import { addTodo, updateTodo } from '@/lib/today'
import {
  EMPTY_RAW,
  GOAL_UNITS,
  ISO_DAY,
  ITEM_KINDS,
  PeopleRefused,
  addDays,
  asCadence,
  assembleHub,
  assertMay,
  companyValues,
  inOneOnOne,
  nextAfter,
  type CardLite,
  type GoalRow,
  type ItemRow,
  type OneOnOneRow,
  type PeopleAction,
  type PeopleHubData,
  type PersonLite,
  type PraiseRow,
  type PraiseView,
  type RawPeople,
  type Viewer,
} from './shared'

type Err = { code?: string; message?: string } | null
export function peopleMissing(err: unknown): boolean {
  const e = err as Err
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}
const NOT_READY = 'Praise and 1:1s are still being switched on for your company. Try again shortly.'
const num = (v: unknown): number => Number(v) || 0
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const nameOf = (m: Pick<Member, 'display_name' | 'email'>) => (m.display_name || '').trim() || m.email || 'A colleague'

export async function viewerFor(tenant: Tenant, member: Member): Promise<Viewer> {
  const emp = await employeeForMember(tenant.id, member.id).catch(() => null)
  return {
    repId: tenant.id,
    memberId: member.id,
    role: String(member.role ?? ''),
    employeeId: emp?.id ?? null,
    employeeOnly: isEmployeeOnlyMember(member, tenant as { id: string; brand?: string | null }),
    assistant: member.role === 'assistant' || !!member.acting_assistant,
  }
}

const PRAISE_COLS = 'id, from_member_id, from_name, to_employee_id, value, body, created_at'
const OO_COLS = 'id, employee_id, manager_member_id, manager_name, cadence, next_date, last_date, calendar_event_id'
const ITEM_COLS = 'id, one_on_one_id, kind, body, author_member_id, author_name, owner_member_id, owner_name, todo_id, done_at, created_at'
const GOAL_COLS = 'id, employee_id, title, unit, target, current, due_date, status'

const toGoal = (g: Record<string, unknown>): GoalRow => ({ id: String(g.id), employee_id: String(g.employee_id), title: String(g.title), unit: (GOAL_UNITS as string[]).includes(String(g.unit)) ? (g.unit as GoalRow['unit']) : 'count', target: num(g.target), current: num(g.current), due_date: (g.due_date as string) ?? null, status: g.status === 'done' ? 'done' : 'active' })

/** Open project cards per member id (Boards), for the given members only. */
async function openCards(repId: string, memberIds: string[]): Promise<Record<string, CardLite[]>> {
  const out: Record<string, CardLite[]> = {}
  if (!memberIds.length) return out
  const { data: links, error } = await supabase.from('cxo_board_card_assignees').select('card_id, member_id').eq('rep_id', repId).in('member_id', memberIds.slice(0, 500)).limit(5000)
  if (error || !links?.length) return out
  const ids = [...new Set((links as Array<{ card_id: string }>).map((l) => l.card_id))].slice(0, 1000)
  const cards = new Map<string, CardLite>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('cxo_board_cards').select('id, title, due_date, cxo_boards(name), cxo_board_lists(title)').eq('rep_id', repId).in('id', ids.slice(i, i + 200)).is('done_at', null)
    type Row = { id: string; title: string; due_date: string | null; cxo_boards: { name: string } | null; cxo_board_lists: { title: string } | null }
    for (const c of (data ?? []) as unknown as Row[]) {
      if (/^done$|^complete/i.test((c.cxo_board_lists?.title ?? '').trim())) continue
      cards.set(c.id, { id: c.id, title: c.title, board: c.cxo_boards?.name ?? 'Board', due_date: c.due_date })
    }
  }
  for (const l of links as Array<{ card_id: string; member_id: string | null }>) {
    const c = cards.get(l.card_id)
    if (c && l.member_id) (out[l.member_id] ??= []).push(c)
  }
  return out
}

/** Everything the viewer may see. Never throws for a missing table. */
export async function loadPeopleHub(tenant: Tenant, member: Member, today: string, viewer?: Viewer): Promise<PeopleHubData> {
  const repId = tenant.id
  const v = viewer ?? (await viewerFor(tenant, member))
  const opts = { today, viewerName: nameOf(member), values: companyValues((tenant as { settings?: unknown }).settings) }
  const base = await loadEmployees(repId, false, today).catch((err) => {
    console.error('[people] employees', err instanceof Error ? err.message : err)
    return null
  })
  if (!base) return assembleHub(v, EMPTY_RAW, { ...opts, ready: false })
  const employees: PersonLite[] = base.employees.map((e) => ({ id: e.id, name: e.name, title: e.title, department: e.department, manager_id: e.manager_id, member_id: e.member_id }))

  const [p, o, g] = await Promise.all([
    supabase.from('cxo_praise').select(PRAISE_COLS).eq('rep_id', repId).order('created_at', { ascending: false }).limit(1000),
    supabase.from('cxo_one_on_ones').select(OO_COLS).eq('rep_id', repId).limit(2000),
    supabase.from('cxo_goals').select(GOAL_COLS).eq('rep_id', repId).limit(5000),
  ])
  const missing = [p, o, g].some((r) => r.error && peopleMissing(r.error))
  for (const r of [p, o, g]) if (r.error && !peopleMissing(r.error)) console.error('[people] load', r.error.message)
  const oneOnOnes = ((o.data ?? []) as OneOnOneRow[]).map((x) => ({ ...x, cadence: asCadence(x.cadence) }))
  const ooByEmp = new Map(oneOnOnes.map((x) => [x.employee_id, x]))
  const visible = employees.filter((e) => inOneOnOne(v, e, ooByEmp.get(e.id) ?? null))
  const visibleIds = new Set(visible.map((e) => e.id))
  const ooIds = oneOnOnes.filter((x) => visibleIds.has(x.employee_id)).map((x) => x.id)

  const [items, cards] = await Promise.all([
    ooIds.length
      ? supabase.from('cxo_one_on_one_items').select(ITEM_COLS).eq('rep_id', repId).in('one_on_one_id', ooIds.slice(0, 500)).order('created_at', { ascending: true }).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    openCards(repId, visible.map((e) => e.member_id).filter((x): x is string => !!x)).catch(() => ({}) as Record<string, CardLite[]>),
  ])

  const kpis: RawPeople['kpis'] = {}
  for (const e of visible) {
    const snap = employeeSnapshot(e, { kpis: base.kpis, actuals: base.actuals, tiers: [] }, today)
    kpis[e.id] = {
      att: snap.att,
      goals: snap.quotas.map((q) => ({ id: q.kpi.id, title: q.kpi.name, unit: q.kpi.unit, target: q.kpi.target, current: q.actual, att: q.att, period: periodLabel(q.periodKey), pace: q.pace })),
    }
  }
  const raw: RawPeople = {
    employees,
    kpis,
    goals: ((g.data ?? []) as Array<Record<string, unknown>>).map(toGoal).filter((x) => visibleIds.has(x.employee_id)),
    oneOnOnes: oneOnOnes.filter((x) => visibleIds.has(x.employee_id)),
    items: ((items.data ?? []) as Array<ItemRow & { todo_id?: unknown }>).map(({ todo_id: _t, ...rest }) => rest),
    praise: (p.data ?? []) as PraiseRow[],
    cards,
  }
  let calendarReady = false
  if (!v.employeeOnly && visible.some((e) => e.id !== v.employeeId)) {
    const { calendarWriteReady } = await import('@/lib/cxoCalendar')
    calendarReady = await calendarWriteReady(repId).then((r) => r.canWrite).catch(() => false)
  }
  return assembleHub(v, raw, { ...opts, ready: !missing, calendarReady })
}

/** The org praise feed, newest first (Today card, Mira). Empty when the table is not there. */
export async function listPraise(repId: string, limit = 5): Promise<PraiseView[]> {
  const { data, error } = await supabase.from('cxo_praise').select(PRAISE_COLS).eq('rep_id', repId).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 60))
  if (error || !data?.length) return []
  const rows = data as PraiseRow[]
  const { data: emps } = await supabase.from('cxo_employees').select('id, name').eq('rep_id', repId).in('id', [...new Set(rows.map((r) => r.to_employee_id))])
  const names = new Map(((emps ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]))
  return rows.map((r) => ({ id: r.id, from_name: r.from_name, to_employee_id: r.to_employee_id, to_name: names.get(r.to_employee_id) ?? 'A colleague', value: r.value, body: r.body, created_at: r.created_at }))
}

async function personIn(repId: string, employeeId: string): Promise<(PersonLite & { email: string | null }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return null
  const { data } = await supabase.from('cxo_employees').select('id, name, title, department, manager_id, member_id, email').eq('rep_id', repId).eq('id', employeeId).eq('active', true).maybeSingle()
  return (data as (PersonLite & { email: string | null }) | null) ?? null
}
async function oneOnOneOf(repId: string, employeeId: string): Promise<OneOnOneRow | null> {
  const { data, error } = await supabase.from('cxo_one_on_ones').select(OO_COLS).eq('rep_id', repId).eq('employee_id', employeeId).maybeSingle()
  if (error) {
    if (peopleMissing(error)) throw new PeopleRefused(NOT_READY, 409)
    throw new Error(error.message)
  }
  return data ? { ...(data as OneOnOneRow), cadence: asCadence((data as OneOnOneRow).cadence) } : null
}
function must(error: Err): void {
  if (!error) return
  if (peopleMissing(error)) throw new PeopleRefused(NOT_READY, 409)
  throw new Error(error.message ?? 'Could not save that.')
}

/** Tell the praised person in-app (their Messages card / their page). No email, no text. */
async function praiseNotice(repId: string, memberId: string, praiseId: string, fromName: string, body: string, value: string | null): Promise<void> {
  // An employee login can only open its own page, which carries the feed too.
  const { data: to } = await supabase.from('members').select('role').eq('rep_id', repId).eq('id', memberId).maybeSingle()
  const role = String((to as { role?: string } | null)?.role ?? '')
  const href = role === 'rep' || role === 'observer' ? '/dashboard/me' : '/dashboard/employees?tab=praise'
  const { error } = await supabase.from('cxo_followup_notices').insert({
    rep_id: repId,
    member_id: memberId,
    key: `praise:${praiseId}`,
    kind: 'praise',
    item_kind: 'praise',
    item_id: praiseId,
    title: `${fromName} praised you${value ? ` for ${value}` : ''}`,
    body,
    href,
  })
  if (error) console.error('[people] praise notice', error.message)
}

type Who = { viewer: Viewer; name: string; tz: string }

/** Run one write. Throws PeopleRefused (403/404/400/409) when it may not happen. */
export async function runPeopleAction(who: Who, a: PeopleAction): Promise<{ note?: string; id?: string }> {
  const v = who.viewer
  const repId = v.repId
  const targetId = a.action === 'praise' ? a.to_employee_id : a.employee_id
  const person = await personIn(repId, String(targetId ?? ''))
  const needsOo = a.action !== 'praise' && !a.action.startsWith('goal_')
  const oo = person && needsOo ? await oneOnOneOf(repId, person.id) : null

  let item: (ItemRow & { todo_id?: string | null }) | null = null
  if (person && (a.action === 'item_toggle' || a.action === 'item_remove')) {
    if (!oo) throw new PeopleRefused('That 1:1 is not set up yet.', 404)
    const { data, error } = await supabase.from('cxo_one_on_one_items').select(ITEM_COLS).eq('rep_id', repId).eq('one_on_one_id', oo.id).eq('id', String(a.id)).maybeSingle()
    must(error)
    if (!data) throw new PeopleRefused('That item is gone.', 404)
    item = data as ItemRow & { todo_id?: string | null }
  }
  assertMay(v, a, person, oo, item)
  const p = person!

  switch (a.action) {
    case 'praise': {
      const body = clean(a.body, 600)
      if (!body) throw new PeopleRefused('Write a short note first.', 400)
      const value = clean(a.value, 60) || null
      const { data, error } = await supabase.from('cxo_praise').insert({ rep_id: repId, from_member_id: v.memberId, from_name: who.name, to_employee_id: p.id, value, body }).select('id').single()
      must(error)
      const id = String((data as { id: string }).id)
      if (p.member_id && p.member_id !== v.memberId) await praiseNotice(repId, p.member_id, id, who.name, body, value)
      return { id, note: `Praise posted for ${p.name}.` }
    }
    case 'oo_save': {
      const next = a.next_date && ISO_DAY.test(a.next_date) ? a.next_date : null
      const row = { rep_id: repId, employee_id: p.id, cadence: asCadence(a.cadence), next_date: next, updated_at: new Date().toISOString() }
      let id = oo?.id ?? null
      const moved = !oo || oo.next_date !== next
      if (oo) must((await supabase.from('cxo_one_on_ones').update({ ...row, ...(moved ? { calendar_event_id: null } : {}) }).eq('rep_id', repId).eq('id', oo.id)).error)
      else {
        const { data, error } = await supabase.from('cxo_one_on_ones').insert({ ...row, manager_member_id: v.memberId, manager_name: who.name }).select('id').single()
        must(error)
        id = String((data as { id: string }).id)
      }
      if (!a.calendar || !next || !id) return { id: id ?? undefined }
      try {
        const { createEventWithInvites } = await import('@/lib/cxoCalendar')
        const { zonedToUtc } = await import('@/lib/ics')
        const [hh, mi] = /^\d{2}:\d{2}$/.test(String(a.time ?? '')) ? String(a.time).split(':').map(Number) : [10, 0]
        const [y, m, d] = next.split('-').map(Number)
        const start = zonedToUtc({ y, m, d, hh, mi, ss: 0 }, who.tz)
        const ev = await createEventWithInvites(repId, v.memberId, {
          title: `1:1: ${p.name} and ${who.name}`,
          description: 'Agenda and notes are in Suite CXO.',
          startIso: new Date(start).toISOString(),
          endIso: new Date(start + 30 * 60_000).toISOString(),
          tz: who.tz,
          attendees: p.email ? [{ email: p.email, displayName: p.name }] : [],
          addMeet: false,
          allowConflict: true,
        })
        await supabase.from('cxo_one_on_ones').update({ calendar_event_id: ev.id }).eq('rep_id', repId).eq('id', id)
        return { id, note: 'Saved and put on your calendar.' }
      } catch (err) {
        return { id, note: `Saved. The calendar event could not be made${err instanceof Error && err.message ? `: ${err.message}` : '.'}` }
      }
    }
    case 'oo_done': {
      if (!oo) throw new PeopleRefused('That 1:1 is not set up yet.', 404)
      const today = todayIn(who.tz)
      const next = nextAfter(oo.next_date && oo.next_date > today ? oo.next_date : today, oo.cadence)
      must((await supabase.from('cxo_one_on_ones').update({ last_date: today, next_date: next, calendar_event_id: null, updated_at: new Date().toISOString() }).eq('rep_id', repId).eq('id', oo.id)).error)
      return { note: `Done. Next 1:1 is ${next}.` }
    }
    case 'item_add': {
      if (!oo) throw new PeopleRefused('Set up the 1:1 first.', 400)
      if (!(ITEM_KINDS as string[]).includes(a.kind)) throw new PeopleRefused('Unknown item.', 400)
      const body = clean(a.body, 2000)
      if (!body) throw new PeopleRefused('Write it first.', 400)
      let owner: { id: string | null; name: string | null } = { id: null, name: null }
      let todoId: string | null = null
      let note: string | undefined
      if (a.kind === 'action') {
        owner = a.owner === 'manager' ? { id: oo.manager_member_id, name: oo.manager_name } : { id: p.member_id, name: p.name }
        if (owner.id) {
          const withWhom = owner.id === p.member_id ? oo.manager_name ?? 'your manager' : p.name
          const todo = await addTodo(repId, owner.id, body, { source: 'manual', source_label: `1:1 with ${withWhom}` }).catch((err) => {
            console.error('[people] todo', err instanceof Error ? err.message : err)
            return null
          })
          todoId = todo?.id ?? null
          note = todo ? `Added to ${owner.id === v.memberId ? 'your' : `${(owner.name ?? 'their').split(' ')[0]}'s`} to-dos.` : undefined
        } else note = `${owner.name ?? 'They'} has no login yet, so this stays on the 1:1.`
      }
      const { data, error } = await supabase
        .from('cxo_one_on_one_items')
        .insert({ rep_id: repId, one_on_one_id: oo.id, kind: a.kind, body, author_member_id: v.memberId, author_name: who.name, owner_member_id: owner.id, owner_name: owner.name, todo_id: todoId })
        .select('id')
        .single()
      must(error)
      return { id: String((data as { id: string }).id), note }
    }
    case 'item_toggle': {
      must((await supabase.from('cxo_one_on_one_items').update({ done_at: a.done ? new Date().toISOString() : null }).eq('rep_id', repId).eq('id', item!.id)).error)
      if (item!.todo_id && item!.owner_member_id) await updateTodo(repId, item!.owner_member_id, item!.todo_id, { done: !!a.done }).catch(() => null)
      return {}
    }
    case 'item_remove': {
      must((await supabase.from('cxo_one_on_one_items').delete().eq('rep_id', repId).eq('id', item!.id)).error)
      return {}
    }
    case 'goal_save': {
      const title = clean(a.title, 200)
      const target = Number(a.target)
      if (!title) throw new PeopleRefused('Name the goal first.', 400)
      if (!Number.isFinite(target) || target <= 0) throw new PeopleRefused('The target needs to be a number above zero.', 400)
      const current = Number.isFinite(Number(a.current)) ? Number(a.current) : 0
      const row = { title, unit: (GOAL_UNITS as string[]).includes(a.unit) ? a.unit : 'count', target, current, due_date: a.due_date && ISO_DAY.test(a.due_date) ? a.due_date : null, status: current >= target ? 'done' : 'active', updated_at: new Date().toISOString() }
      if (a.id) must((await supabase.from('cxo_goals').update(row).eq('rep_id', repId).eq('employee_id', p.id).eq('id', String(a.id))).error)
      else must((await supabase.from('cxo_goals').insert({ ...row, rep_id: repId, employee_id: p.id, created_by: v.memberId })).error)
      return {}
    }
    case 'goal_progress': {
      const current = Number(a.current)
      if (!Number.isFinite(current)) throw new PeopleRefused('That needs to be a number.', 400)
      const { data, error } = await supabase.from('cxo_goals').select('id, target').eq('rep_id', repId).eq('employee_id', p.id).eq('id', String(a.id)).maybeSingle()
      must(error)
      if (!data) throw new PeopleRefused('That goal is gone.', 404)
      must((await supabase.from('cxo_goals').update({ current, status: current >= num((data as { target: unknown }).target) ? 'done' : 'active', updated_at: new Date().toISOString() }).eq('rep_id', repId).eq('id', String(a.id))).error)
      return {}
    }
    case 'goal_remove': {
      must((await supabase.from('cxo_goals').delete().eq('rep_id', repId).eq('employee_id', p.id).eq('id', String(a.id))).error)
      return {}
    }
  }
}

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export { addDays }
