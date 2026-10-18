/**
 * leadership_agenda without a calendar series (QA X-meeting_prep-01/02,
 * 2026-10-18): no Google, or the meeting is not on a connected calendar, so
 * Ciao drafts it from overdue to-dos, blockers and open asks instead of
 * giving up. Shown, never saved, never on an invite. Database mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; op: string; filters: Array<[string, ...unknown[]]> }
const db = { blockers: [] as Array<{ name: string; blockers: string[] }>, calls: [] as Call[], rows: {} as Record<string, unknown[]>, series: { picks: [] as unknown[], all: [] as unknown[] } }

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const c: Call = { table, op: 'select', filters: [] }
    db.calls.push(c)
    const q: Record<string, unknown> = {}
    for (const k of ['eq', 'neq', 'in', 'is', 'lte', 'lt', 'gte', 'order', 'limit', 'not', 'like', 'ilike']) q[k] = (...a: unknown[]) => (c.filters.push([k, ...a]), q)
    q.select = () => q
    q.update = () => ((c.op = 'update'), q)
    q.insert = () => ((c.op = 'insert'), q)
    q.upsert = () => ((c.op = 'upsert'), q)
    q.maybeSingle = async () => ({ data: null, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: c.op === 'select' ? db.rows[table] ?? [] : [], error: null }))
    return q
  }
  return { supabase: { from } }
})
vi.mock('@/lib/pinnacle/access', () => ({ pinnacleAllowed: () => false }))
vi.mock('@/lib/status/weekly', () => ({
  weekRollupPeople: async () => db.blockers,
}))
vi.mock('@/lib/meetings/agenda', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  upcomingSeries: async () => db.series,
}))

import { draftAgendaWithoutCalendar } from '@/lib/meetings/agenda'
import { CXO_AGENDA_TOOL_HANDLERS } from '@/lib/agent/cxoAgendaTool'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const NOW = new Date('2026-10-19T07:00:00-04:00')
const MEMBERS = [
  { id: 'm-dana', rep_id: 'rep-acme', email: 'dana@acme.test', display_name: 'Dana Exec', role: 'owner', timezone: tz, is_active: true },
  { id: 'm-sam', rep_id: 'rep-acme', email: 'sam@acme.test', display_name: 'Sam Lee', role: 'admin', timezone: tz, is_active: true },
  { id: 'm-erin', rep_id: 'rep-acme', email: 'erin@acme.test', display_name: 'Erin Staff', role: 'rep', timezone: tz, is_active: true },
]
const TODOS = [
  { member_id: 'm-sam', body: 'Send the Q4 hiring plan', due_date: '2026-10-14', meeting_title: null },
  { member_id: 'm-dana', body: 'Sign the vendor renewal', due_date: '2026-10-16', meeting_title: 'Ops sync' },
]
const MSGS = [
  { from_member_id: 'm-erin', body: 'Can we raise this at the leadership meeting: the CRM migration date', kind: 'message', created_at: '2026-10-15T15:00:00Z' },
  { from_member_id: 'm-erin', body: 'Do we have budget for a second SDR?', kind: 'question', created_at: '2026-10-16T15:00:00Z' },
  { from_member_id: 'm-erin', body: 'thanks!', kind: 'message', created_at: '2026-10-17T15:00:00Z' },
]

const TENANT = { id: 'rep-acme', slug: 'acme', brand: 'cxo', timezone: tz, settings: {} } as unknown as Tenant
const ctxFor = (role: string, extra: Partial<AgentContext> = {}): AgentContext => ({
  tenant: TENANT,
  caller: { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role, timezone: tz } as unknown as Member,
  timezone: tz,
  todayIso: '2026-10-19',
  ownerMemberId: 'm-dana',
  ...extra,
})
const call = async (ctx: AgentContext, args: Record<string, unknown>) => JSON.parse((await CXO_AGENDA_TOOL_HANDLERS.leadership_agenda(ctx, args)).text)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  db.calls = []
  db.rows = { members: MEMBERS, cxo_todos: TODOS, member_messages: MSGS, cxo_meeting_series: [] }
  db.series = { picks: [], all: [] }
  db.blockers = [{ name: 'Sam Lee', blockers: ['Waiting on legal for the Acme contract'] }]
})
afterEach(() => vi.useRealTimers())

describe('draftAgendaWithoutCalendar', () => {
  it('overdue to-dos by owner, blockers, open asks to the leaders; nothing saved', async () => {
    const d = await draftAgendaWithoutCalendar({ id: 'rep-acme', timezone: tz }, MEMBERS, NOW)
    expect(d.leaders).toBe(2)
    expect(d.sections.overdue.map((o) => o.owner)).toEqual(['Sam Lee', 'Dana Exec'])
    expect(d.sections.blockers).toEqual(['Sam Lee: Waiting on legal for the Acme contract'])
    expect(d.sections.raised).toEqual([
      'Erin Staff: Can we raise this at the leadership meeting: the CRM migration date',
      'Erin Staff: Do we have budget for a second SDR?',
    ])
    expect(d.body).toMatch(/Send the Q4 hiring plan/)
    // To-dos of the leaders only, every read scoped to the company, no writes at all.
    const todos = db.calls.find((c) => c.table === 'cxo_todos')!
    expect(todos.filters).toContainEqual(['eq', 'rep_id', 'rep-acme'])
    expect(todos.filters).toContainEqual(['in', 'member_id', ['m-dana', 'm-sam']])
    expect(db.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
    expect(db.calls.some((c) => c.table === 'cxo_meeting_agendas')).toBe(false)
  })
})

describe('leadership_agenda draft with no series', () => {
  it('drafts from rows instead of giving up', async () => {
    const r = await call(ctxFor('owner'), { action: 'draft' })
    expect(r).toMatchObject({ ok: true, from_calendar: false, saved: false })
    expect(r.agenda).toMatch(/Send the Q4 hiring plan/)
    expect(r.agenda).toMatch(/Waiting on legal/)
    expect(r.not_found).toBeUndefined()
    expect(r.rule).toMatch(/not on a connected calendar/)
    expect(db.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('with nothing to say, says so plainly', async () => {
    db.rows = { members: MEMBERS, cxo_todos: [], member_messages: [], cxo_meeting_series: [] }
    db.blockers = []
    const r = await call(ctxFor('owner'), { action: 'draft' })
    expect(r).toMatchObject({ ok: true, agenda: '' })
    expect(r.say).toMatch(/nothing to put on an agenda yet/)
  })

  it('recurring meetings it can see are offered to tie it to', async () => {
    db.series = { picks: [], all: [{ seriesId: 's1', eventId: 'e1', title: 'Weekly sync', start: '2026-10-20T14:00:00Z', attendeeEmails: ['a@x', 'b@x'], marked: false, titleMatch: false }] }
    const r = await call(ctxFor('owner'), { action: 'draft', meeting: 'board meeting' })
    expect(r.ok).toBe(true)
    expect(r.recurring).toHaveLength(1)
    expect(r.ask).toMatch(/Which of these is your leadership meeting/)
  })

  it('raise and mark still need a meeting', async () => {
    const r = await call(ctxFor('owner'), { action: 'raise', item: 'Budget' })
    expect(r).toMatchObject({ ok: false, not_found: true })
  })

  it('employees and reps still cannot draft it', async () => {
    const r = await call(ctxFor('rep'), { action: 'draft' })
    expect(r.ok).toBe(false)
    const e = await call(ctxFor('owner', { selfOnly: true }), { action: 'draft' })
    expect(e.ok).toBe(false)
  })
})
