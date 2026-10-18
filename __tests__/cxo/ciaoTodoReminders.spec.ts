/**
 * Timed to-do reminders (QA X-reminders-01 / M-reminders-01, 2026-10-18):
 * "remind me at 2:30 to call Dana" sets remind_at, and the worker tick pings
 * them through the notice path at that minute. Database mocked; no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, ...unknown[]]> }
const db = {
  calls: [] as Call[],
  rows: {} as Record<string, unknown[]>,
  single: {} as Record<string, unknown>,
  inserted: [] as Array<Record<string, unknown>>,
  emailed: 0,
}

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const c: Call = { table, op: 'select', filters: [] }
    db.calls.push(c)
    const q: Record<string, unknown> = {}
    for (const k of ['eq', 'neq', 'in', 'is', 'lte', 'lt', 'gte', 'order', 'limit', 'not', 'like']) q[k] = (...a: unknown[]) => (c.filters.push([k, ...a]), q)
    q.select = () => q
    q.update = (p: unknown) => ((c.op = 'update'), (c.payload = p), q)
    q.insert = (p: unknown) => ((c.op = 'insert'), (c.payload = p), q)
    q.maybeSingle = async () => ({ data: db.single[table] ?? null, error: null })
    q.single = async () => ({ data: { id: 't-new', ...(c.payload as object) }, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: c.op === 'select' ? db.rows[table] ?? [] : [], error: null }))
    return q
  }
  return { supabase: { from } }
})

vi.mock('@/lib/followups/engine', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  insertNotices: async (rows: Array<Record<string, unknown>>) => (db.inserted.push(...rows), rows),
  emailNotices: async (_t: unknown, _m: unknown, rows: unknown[]) => ((db.emailed += rows.length), rows.length),
}))

import { nextRemindAt, parseRemindAt, remindKey, remindLabel, asRemindRule } from '@/lib/todoReminderShared'
import { ALWAYS_SHOWN_PREFIXES, TODO_REMIND_PREFIX } from '@/lib/followups/noticeActionsShared'
import { runTodoReminderTick } from '@/lib/followups/todoReminders'
import { SELF_TOOL_HANDLERS } from '@/lib/agent/selfTools'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const NOW = new Date('2026-10-19T07:00:00-04:00') // Monday
const TENANT = { id: 'rep-acme', slug: 'acme', brand: 'cxo', timezone: tz, settings: {} } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana', email: 'dana@acme.test', role: 'owner', timezone: tz } as unknown as Member
const ctx: AgentContext = { tenant: TENANT, caller: DANA, timezone: tz, todayIso: '2026-10-19', ownerMemberId: DANA.id }
const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await SELF_TOOL_HANDLERS[name](ctx, args)).text)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  db.calls = []
  db.rows = {}
  db.single = {}
  db.inserted = []
  db.emailed = 0
})
afterEach(() => vi.useRealTimers())

describe('parseRemindAt / nextRemindAt (pure)', () => {
  it('local wall time is read in their timezone; an offset is honoured', () => {
    expect(parseRemindAt('2026-10-19T14:30', tz, NOW.getTime())).toEqual({ iso: '2026-10-19T18:30:00.000Z' })
    expect(parseRemindAt('2026-10-19 14:30:00', 'America/Los_Angeles', NOW.getTime())).toEqual({ iso: '2026-10-19T21:30:00.000Z' })
    expect(parseRemindAt('2026-10-19T14:30:00-05:00', tz, NOW.getTime())).toEqual({ iso: '2026-10-19T19:30:00.000Z' })
    expect(parseRemindAt('2026-10-19T14:30:00Z', tz, NOW.getTime())).toEqual({ iso: '2026-10-19T14:30:00.000Z' })
  })

  it('refuses the past, junk, and gives null for nothing', () => {
    expect(parseRemindAt('2026-10-19T06:00', tz, NOW.getTime())).toEqual({ error: 'that time has already passed' })
    expect(parseRemindAt('tomorrow at 9', tz, NOW.getTime())).toMatchObject({ error: expect.stringMatching(/date and time/) })
    expect(parseRemindAt('', tz, NOW.getTime())).toBeNull()
    expect(parseRemindAt(undefined, tz, NOW.getTime())).toBeNull()
    // A minute late (the model is slow) still counts.
    expect(parseRemindAt('2026-10-19T06:59', tz, NOW.getTime())).toEqual({ iso: '2026-10-19T10:59:00.000Z' })
  })

  it('a repeat keeps the wall clock across the clock change (Nov 1, 2026)', () => {
    // Fri Oct 30 9:00 EDT → Mon Nov 2 9:00 EST (weekdays skips the weekend).
    expect(nextRemindAt('2026-10-30T13:00:00.000Z', 'weekdays', tz, Date.parse('2026-10-30T13:00:00Z'))).toBe('2026-11-02T14:00:00.000Z')
    expect(nextRemindAt('2026-10-31T13:00:00.000Z', 'daily', tz, Date.parse('2026-10-31T13:00:00Z'))).toBe('2026-11-01T14:00:00.000Z')
    expect(nextRemindAt('2026-10-26T13:00:00.000Z', 'weekly', tz, Date.parse('2026-10-26T13:00:00Z'))).toBe('2026-11-02T14:00:00.000Z')
  })

  it('a repeat that fell behind (worker down) jumps to the next future time, not a burst', () => {
    const now = Date.parse('2026-10-22T15:00:00Z') // Thu 11:00 EDT
    expect(nextRemindAt('2026-10-19T13:00:00.000Z', 'daily', tz, now)).toBe('2026-10-23T13:00:00.000Z')
  })

  it('keys, labels, rules, and the always-shown list', () => {
    expect(remindKey('t1', '2026-10-19T18:30:00.000Z')).toBe('todoremind-t1-2026-10-19T18:30')
    expect(ALWAYS_SHOWN_PREFIXES).toContain(TODO_REMIND_PREFIX)
    expect(remindLabel('2026-10-19T13:00:00.000Z', tz, 'weekly')).toMatch(/^every Monday at 9:00\sAM, starting Mon, Oct 19/)
    expect(asRemindRule('Weekdays')).toBe('weekdays')
    expect(asRemindRule('hourly')).toBeNull()
  })
})

describe('add_my_todo with a time', () => {
  it('sets remind_at (UTC) and the due day, and says the time back', async () => {
    const r = await call('add_my_todo', { body: 'Call Dana', remind_at: '2026-10-19T14:30' })
    expect(r.ok).toBe(true)
    const ins = db.calls.find((c) => c.table === 'cxo_todos' && c.op === 'insert')!
    expect(ins.payload).toMatchObject({ rep_id: 'rep-acme', member_id: 'm-dana', body: 'Call Dana', remind_at: '2026-10-19T18:30:00.000Z', remind_rule: null, due_date: '2026-10-19' })
    expect(r.say).toMatch(/I'll remind you on Mon, Oct 19, 2:30\sPM with a notice in the app/)
  })

  it('a weekly repeat', async () => {
    const r = await call('add_my_todo', { body: 'Send the numbers', remind_at: '2026-10-26T09:00', repeat: 'weekly' })
    expect(r).toMatchObject({ ok: true, repeat: 'weekly', remind_at: '2026-10-26T13:00:00.000Z' })
    expect(r.say).toMatch(/every Monday at 9:00\sAM/)
  })

  it('refuses a past time, a bad repeat, or a repeat without a time, and writes nothing', async () => {
    expect(await call('add_my_todo', { body: 'x', remind_at: '2026-10-18T09:00' })).toMatchObject({ ok: false, error: 'bad_remind_at' })
    expect(await call('add_my_todo', { body: 'x', remind_at: '2026-10-19T09:00', repeat: 'hourly' })).toMatchObject({ ok: false, error: 'bad_repeat' })
    expect(await call('add_my_todo', { body: 'x', repeat: 'daily' })).toMatchObject({ ok: false })
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('no time → a plain to-do, no reminder fields', async () => {
    await call('add_my_todo', { body: 'Plain one' })
    const ins = db.calls.find((c) => c.op === 'insert')!
    expect(ins.payload).not.toHaveProperty('remind_at')
  })
})

describe('runTodoReminderTick', () => {
  const MEMBERS = [
    { id: 'm-dana', rep_id: 'rep-acme', role: 'owner', is_active: true, timezone: tz, display_name: 'Dana', email: 'dana@acme.test', settings: {} },
    { id: 'm-erin', rep_id: 'rep-acme', role: 'rep', is_active: true, timezone: tz, display_name: 'Erin', email: 'erin@acme.test', settings: {} },
  ]

  it('one notice per due to-do; one-offs marked reminded, repeats move on', async () => {
    db.rows.cxo_todos = [
      { id: 't1', rep_id: 'rep-acme', member_id: 'm-dana', body: 'Call Dana', remind_at: '2026-10-19T10:59:00.000Z', remind_rule: null, done_at: null, due_date: '2026-10-19' },
      { id: 't2', rep_id: 'rep-acme', member_id: 'm-dana', body: 'Send the numbers', remind_at: '2026-10-19T10:00:00.000Z', remind_rule: 'weekly', done_at: '2026-10-12T15:00:00Z', due_date: '2026-10-19' },
      { id: 't3', rep_id: 'rep-acme', member_id: 'm-erin', body: 'Already done', remind_at: '2026-10-19T10:30:00.000Z', remind_rule: null, done_at: '2026-10-19T09:00:00Z', due_date: null },
    ]
    db.rows.members = MEMBERS
    db.single.reps = { id: 'rep-acme', slug: 'acme', brand: 'cxo', settings: {}, timezone: tz }

    const out = await runTodoReminderTick(NOW)
    expect(out).toEqual({ due: 2, delivered: 2, emailed: 2, errors: 0 })
    expect(db.inserted.map((n) => [n.key, n.member_id, n.title, n.kind])).toEqual([
      ['todoremind-t1-2026-10-19T10:59', 'm-dana', 'Reminder: Call Dana', 'report'],
      ['todoremind-t2-2026-10-19T10:00', 'm-dana', 'Reminder: Send the numbers', 'report'],
    ])
    const updates = db.calls.filter((c) => c.table === 'cxo_todos' && c.op === 'update')
    // The ticked one-off: marked, no notice.
    expect(updates[0]).toMatchObject({ payload: { reminded_at: NOW.toISOString() }, filters: [['in', 'id', ['t3']]] })
    expect(updates.find((u) => u.filters.some((f) => f[0] === 'eq' && f[2] === 't1'))!.payload).toEqual({ reminded_at: NOW.toISOString() })
    // The repeat: next Monday 6:00 EDT wall time, and back on the list.
    expect(updates.find((u) => u.filters.some((f) => f[0] === 'eq' && f[2] === 't2'))!.payload).toEqual({ remind_at: '2026-10-26T10:00:00.000Z', done_at: null })
    // Every write is scoped to the company.
    for (const u of updates.slice(1)) expect(u.filters).toContainEqual(['eq', 'rep_id', 'rep-acme'])
  })

  it('never fires for a company that is not Suite CXO', async () => {
    db.rows.cxo_todos = [{ id: 't1', rep_id: 'rep-x', member_id: 'm-dana', body: 'x', remind_at: '2026-10-19T10:00:00.000Z', remind_rule: null, done_at: null, due_date: null }]
    db.rows.members = MEMBERS
    db.single.reps = { id: 'rep-x', brand: 'vc' }
    const out = await runTodoReminderTick(NOW)
    expect(out.delivered).toBe(0)
    expect(db.inserted).toHaveLength(0)
  })

  it('nothing due → no writes', async () => {
    const out = await runTodoReminderTick(NOW)
    expect(out).toEqual({ due: 0, delivered: 0, emailed: 0, errors: 0 })
    expect(db.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
})
