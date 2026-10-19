/**
 * QA 2026-10-18 (X-calendar-07, X-calendar-08): a repeating meeting is ONE
 * event with an RRULE, more than two calendar writes in a turn needs a yes,
 * and find_team_free_time returns coworkers' busy blocks only. Google and
 * the database are mocked; no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'update', 'insert', 'like', 'gte', 'lt', 'lte', 'not', 'ilike']) q[k] = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.single = async () => ({ data: null, error: null })
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: [], error: null }))
  return { supabase: { from: () => q } }
})

type Account = { accountId: string; memberId: string | null; email: string | null; label: string; isShared: boolean }
type Tok = { id: string; member_id: string | null; scope: string | null; needs_reconnect?: boolean }
const g = {
  accounts: [] as Account[],
  tokens: {} as Record<string, Tok>,
  busy: {} as Record<string, Array<{ startIso: string; endIso: string; calendar?: string }> | null>,
  busyCalls: [] as Array<{ memberId: string | null | undefined; accountId: string | null | undefined }>,
  members: [] as Array<{ id: string; display_name: string | null; email: string | null; timezone: string | null }>,
  created: [] as Array<Record<string, unknown>>,
  updated: 0,
}

vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listConnectedGoogleAccounts: async () => g.accounts,
  getTokensFor: async (_rep: string, _memberId?: string | null, accountId?: string | null) => (accountId ? g.tokens[accountId] ?? null : null),
  getBusySlots: async (_rep: string, _from: string, _to: string, opts: { memberId?: string | null; accountId?: string | null }) => {
    g.busyCalls.push({ memberId: opts.memberId, accountId: opts.accountId })
    const v = g.busy[opts.accountId ?? '']
    if (v === null) throw new Error('google down')
    return v ?? []
  },
}))
vi.mock('@/lib/memberMessages', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  orgMembers: async () => g.members,
}))
vi.mock('@/lib/cxoCalendar', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createEventWithInvites: async (_rep: string, _member: string | null, input: Record<string, unknown>) => {
    g.created.push(input)
    return { id: `ev-${g.created.length}`, htmlLink: 'https://calendar.google.com/e/1', meetLink: null, startIso: input.startIso, endIso: input.endIso, calendar: { name: 'Work', accountEmail: 'dana@acme.test', accountLabel: 'Dana' } }
  },
  updateEventWithNotice: async () => {
    g.updated++
    return { id: 'ev-u', htmlLink: 'https://calendar.google.com/e/u', calendar: { name: 'Work' } }
  },
}))

import { parseRecurrence, RECURRENCE_MAX_COUNT } from '@/lib/cxoRecurrence'
import { busyOnly, pickMembers } from '@/lib/cxoTeamFreeTime'
import { calendarWriteGate, noteCalendarBatch } from '@/lib/agent/calendarWriteGuard'
import { CXO_TOOL_DEFS, CXO_TOOL_HANDLERS } from '@/lib/agent/cxoTools'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { routingHintsFor } from '@/lib/agent/cxoCatalog'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const et = (local: string) => new Date(`${local}-04:00`).toISOString()
const FULL_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy openid email'
const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: tz, settings: {} } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role: 'owner', timezone: tz } as unknown as Member
const ERIN = { id: 'm-erin', rep_id: 'rep-acme', display_name: 'Erin Staff', email: 'erin@acme.test', role: 'rep', timezone: tz } as unknown as Member
const ctxFor = (caller: Member, extra: Partial<AgentContext> = {}): AgentContext => ({ tenant: TENANT, caller, timezone: tz, todayIso: '2026-10-19', ownerMemberId: caller.id, ...extra })
const call = async (name: string, ctx: AgentContext, args: Record<string, unknown>) => JSON.parse((await CXO_TOOL_HANDLERS[name](ctx, args)).text)
const NOW = new Date('2026-10-19T07:00:00-04:00')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  g.accounts = []
  g.tokens = {}
  g.busy = {}
  g.busyCalls = []
  g.members = []
  g.created = []
  g.updated = 0
})
afterEach(() => vi.useRealTimers())

// ── parseRecurrence ─────────────────────────────────────────────────────────

describe('parseRecurrence', () => {
  it('no repeat → null', () => {
    for (const v of [undefined, null, '', false]) expect(parseRecurrence(v)).toBeNull()
  })

  it('RRULE strings, with or without the prefix', () => {
    const a = parseRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10')
    expect(a).toEqual({ ok: true, recurrence: expect.objectContaining({ rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10', label: 'every Monday, 10 times' }) })
    const b = parseRecurrence('freq=weekly;interval=2;byday=tu,th;until=2026-12-31')
    expect(b?.ok && b.recurrence.rrule).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231')
    expect(b?.ok && b.recurrence.label).toBe('every 2 weeks on Tuesday and Thursday, until 2026-12-31')
  })

  it('object form, weekday shorthand, plain daily', () => {
    const w = parseRecurrence({ freq: 'weekly', by_day: ['mon', 'tue', 'wed', 'thu', 'fri'], count: 20 })
    expect(w?.ok && w.recurrence).toMatchObject({ rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=20', label: 'every weekday, 20 times' })
    const d = parseRecurrence({ freq: 'daily' })
    expect(d?.ok && d.recurrence).toMatchObject({ rrule: 'RRULE:FREQ=DAILY', label: 'every day' })
    const m = parseRecurrence({ freq: 'monthly', until: '2027-06-30T17:00:00Z' })
    expect(m?.ok && m.recurrence.rrule).toBe('RRULE:FREQ=MONTHLY;UNTIL=20270630T170000Z')
  })

  it('refuses what it cannot vouch for', () => {
    const bad = (v: unknown) => {
      const r = parseRecurrence(v)
      return r && !r.ok ? r.error : null
    }
    expect(bad('FREQ=HOURLY')).toMatch(/FREQ/)
    expect(bad('FREQ=WEEKLY;BYSETPOS=1')).toMatch(/not supported/)
    expect(bad('FREQ=WEEKLY;COUNT=3;UNTIL=20261231')).toMatch(/not both/)
    expect(bad('FREQ=WEEKLY;BYDAY=XX')).toMatch(/not a day/)
    expect(bad({ freq: 'monthly', by_day: ['mo'] })).toMatch(/daily or weekly/)
    expect(bad({ freq: 'weekly', count: RECURRENCE_MAX_COUNT + 1 })).toMatch(/capped/)
    expect(bad({ freq: 'weekly', interval: 0 })).toMatch(/interval/)
    expect(bad({ freq: 'weekly', until: 'next year' })).toMatch(/until/)
    expect(bad(['FREQ=WEEKLY'])).toMatch(/RRULE string/)
  })
})

// ── The write guard ─────────────────────────────────────────────────────────

describe('calendar write guard', () => {
  it('two writes pass; the third in a turn is held', () => {
    const ctx = ctxFor(DANA)
    expect(calendarWriteGate(ctx, {}, 'a')).toBeNull()
    expect(calendarWriteGate(ctx, {}, 'b')).toBeNull()
    const held = JSON.parse(calendarWriteGate(ctx, {}, 'c')!.text)
    expect(held).toMatchObject({ ok: false, needs_confirmation: true, calendar_writes_this_turn: 3 })
    expect(held.say).toMatch(/ONE event with a recurrence/)
    expect(calendarWriteGate(ctx, { confirmed: true }, 'c')).toBeNull()
    expect(ctx.calendarWrites).toBe(3)
  })

  it('a batch of ten is held as a whole, before the first write', () => {
    const ctx = ctxFor(DANA)
    noteCalendarBatch(ctx, [...Array(10).fill('create_calendar_event'), 'list_my_todos'])
    expect(ctx.calendarWritesProjected).toBe(10)
    const first = JSON.parse(calendarWriteGate(ctx, {}, 'week 1')!.text)
    expect(first).toMatchObject({ needs_confirmation: true, calendar_writes_this_turn: 10 })
    expect(ctx.calendarWrites ?? 0).toBe(0)
  })

  it('a batch of two still goes through; reads do not count', () => {
    const ctx = ctxFor(DANA)
    noteCalendarBatch(ctx, ['create_calendar_event', 'find_free_time', 'cancel_calendar_event'])
    expect(calendarWriteGate(ctx, {}, 'a')).toBeNull()
    expect(calendarWriteGate(ctx, {}, 'b')).toBeNull()
    noteCalendarBatch(ctx, ['find_free_time'])
    expect(ctx.calendarWritesProjected).toBe(2)
  })

  it('ten create_calendar_event calls in one batch write nothing; one recurring event writes once', async () => {
    const ctx = ctxFor(DANA)
    noteCalendarBatch(ctx, Array(10).fill('create_calendar_event'))
    for (let i = 0; i < 10; i++) {
      const r = await call('create_calendar_event', ctx, { title: 'Pipeline review', start: new Date(Date.parse('2026-10-19T13:00:00Z') + i * 7 * 86_400_000).toISOString() })
      expect(r.needs_confirmation).toBe(true)
    }
    expect(g.created).toHaveLength(0)

    const ctx2 = ctxFor(DANA)
    noteCalendarBatch(ctx2, ['create_calendar_event'])
    const one = await call('create_calendar_event', ctx2, { title: 'Pipeline review', start: '2026-10-19T09:00:00', duration_min: 60, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10' })
    expect(one.ok).toBe(true)
    expect(g.created).toHaveLength(1)
    expect(g.created[0].recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10')
    expect(one.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10')
    expect(one.readback).toMatch(/repeating every Monday, 10 times \(one repeating event\)/)
  })

  it('a bad repeat rule is refused before anything is written', async () => {
    const r = await call('create_calendar_event', ctxFor(DANA), { title: 'X', start: '2026-10-19T09:00:00', recurrence: 'FREQ=HOURLY' })
    expect(r).toMatchObject({ ok: false, error: 'bad_recurrence' })
    expect(g.created).toHaveLength(0)
  })

  it('update and cancel share the same count', async () => {
    const ctx = ctxFor(DANA)
    noteCalendarBatch(ctx, ['update_calendar_event', 'update_calendar_event', 'update_calendar_event'])
    const r = await call('update_calendar_event', ctx, { event_id: 'e1', title: 'New' })
    expect(r.needs_confirmation).toBe(true)
    const ok = await call('update_calendar_event', ctx, { event_id: 'e1', title: 'New', confirmed: true })
    expect(ok.ok).toBe(true)
    expect(g.updated).toBe(1)
  })

  it('the tool defs offer recurrence and confirmed', () => {
    const def = CXO_TOOL_DEFS.find((d) => d.name === 'create_calendar_event') as { input_schema: { properties: Record<string, unknown> } }
    expect(Object.keys(def.input_schema.properties)).toEqual(expect.arrayContaining(['recurrence', 'confirmed']))
  })
})

// ── find_team_free_time ─────────────────────────────────────────────────────

describe('pickMembers / busyOnly (pure)', () => {
  const all = [
    { id: '1', display_name: 'Sam Lee', email: 'sam@acme.test' },
    { id: '2', display_name: 'Sam Ortiz', email: 'sortiz@acme.test' },
    { id: '3', display_name: 'Priya Shah', email: 'priya@acme.test' },
  ]
  it('one person per name, ambiguity asks, unknown asks', () => {
    expect(pickMembers(all, ['priya']).members.map((m) => m.id)).toEqual(['3'])
    expect(pickMembers(all, ['Sam Ortiz', 'priya@acme.test']).members.map((m) => m.id)).toEqual(['2', '3'])
    expect(pickMembers(all, ['sam']).ask).toMatch(/Which sam: Sam Lee, Sam Ortiz/)
    expect(pickMembers(all, ['bob']).ask).toMatch(/don't see anyone called "bob"/)
  })
  it('busy blocks are start and end only, merged', () => {
    const out = busyOnly([
      { startIso: et('2026-10-19T10:00:00'), endIso: et('2026-10-19T11:00:00'), calendar: 'Therapy' } as never,
      { startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), calendar: 'Kids' } as never,
      { startIso: et('2026-10-19T13:00:00'), endIso: et('2026-10-19T12:00:00') },
    ])
    expect(out).toEqual([{ startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T11:00:00') }])
  })
})

describe('find_team_free_time', () => {
  const team = () => {
    g.members = [
      { id: DANA.id, display_name: 'Dana Exec', email: 'dana@acme.test', timezone: tz },
      { id: 'm-sam', display_name: 'Sam Lee', email: 'sam@acme.test', timezone: tz },
      { id: 'm-priya', display_name: 'Priya Shah', email: 'priya@acme.test', timezone: tz },
      { id: 'm-joe', display_name: 'Joe King', email: 'joe@acme.test', timezone: tz },
    ]
    g.accounts = [
      { accountId: 'a-dana', memberId: DANA.id, email: 'dana@acme.test', label: 'Dana', isShared: false },
      { accountId: 'a-sam', memberId: 'm-sam', email: 'sam@acme.test', label: 'Sam', isShared: false },
      { accountId: 'a-priya', memberId: 'm-priya', email: 'priya@acme.test', label: 'Priya', isShared: false },
      { accountId: 'a-shared', memberId: null, email: 'ops@acme.test', label: 'Ops', isShared: true },
    ]
    g.tokens = {
      'a-dana': { id: 'a-dana', member_id: DANA.id, scope: FULL_SCOPE },
      'a-sam': { id: 'a-sam', member_id: 'm-sam', scope: FULL_SCOPE },
      'a-priya': { id: 'a-priya', member_id: 'm-priya', scope: 'openid email' },
    }
    g.busy = {
      'a-dana': [{ startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T12:00:00'), calendar: 'Board prep' }],
      'a-sam': [
        { startIso: et('2026-10-19T13:00:00'), endIso: et('2026-10-19T14:00:00'), calendar: 'Therapy' },
        { startIso: et('2026-10-19T14:00:00'), endIso: et('2026-10-19T17:00:00'), calendar: 'Kids pickup' },
      ],
    }
  }

  it('returns busy blocks only, merges everyone, lists who could not be checked', async () => {
    team()
    const r = await call('find_team_free_time', ctxFor(DANA), { people: ['Sam', 'Priya', 'Joe'], from: '2026-10-19', to: '2026-10-19', duration_min: 30 })
    expect(r.ok).toBe(true)
    expect(r.people_checked.map((p: { name: string }) => p.name)).toEqual(['you', 'Sam'])
    expect(r.people_checked[1].busy).toEqual([{ start: et('2026-10-19T13:00:00'), end: et('2026-10-19T17:00:00') }])
    expect(r.people_not_checked).toEqual([
      { name: 'Priya', reason: 'reconnect_needed' },
      { name: 'Joe', reason: 'not_connected' },
    ])
    expect(r.free).toEqual([expect.objectContaining({ start: et('2026-10-19T12:00:00'), end: et('2026-10-19T13:00:00') })])
    const text = JSON.stringify(r)
    for (const secret of ['Therapy', 'Kids', 'Board prep', 'calendar"']) expect(text).not.toContain(secret)
    expect(r.say).toMatch(/couldn't check Priya \(needs to reconnect Google\), Joe \(has not connected Google\)/)
    // Never reads another person's calendar through someone else's account or the shared one.
    expect(g.busyCalls).toEqual([
      { memberId: DANA.id, accountId: 'a-dana' },
      { memberId: 'm-sam', accountId: 'a-sam' },
    ])
  })

  it('an unknown or ambiguous name asks instead of guessing', async () => {
    team()
    const r = await call('find_team_free_time', ctxFor(DANA), { people: 'Bob' })
    expect(r).toMatchObject({ ok: false, ask: expect.stringMatching(/Bob/) })
    expect(g.busyCalls).toHaveLength(0)
  })

  it('no people passed → tells the model to retry with the names, never loops on an ask', async () => {
    team()
    const r = await call('find_team_free_time', ctxFor(DANA), { duration_min: 45 })
    expect(r).toMatchObject({ ok: false, error: 'people_required' })
    expect(r.say).toMatch(/people: \[/)
    const def = CXO_TOOL_DEFS.find((d) => d.name === 'find_team_free_time') as { input_schema: { required?: string[] } }
    expect(def.input_schema.required).toEqual(['people'])
    const s = await call('find_team_free_time', ctxFor(DANA), { people: 'Sam and Priya', from: '2026-10-19', to: '2026-10-19' })
    expect(s.people_checked.map((p: { name: string }) => p.name)).toEqual(['you', 'Sam'])
  })

  it('nobody connected → a plain answer, no invented times', async () => {
    team()
    g.accounts = []
    const r = await call('find_team_free_time', ctxFor(DANA), { people: ['Sam'] })
    expect(r).toMatchObject({ ok: false, error: 'nobody_checked' })
    expect(r.free).toBeUndefined()
  })

  it('a Google error for one person is reported, not hidden', async () => {
    team()
    g.busy['a-sam'] = null
    const r = await call('find_team_free_time', ctxFor(DANA), { people: ['Sam'], from: '2026-10-19', to: '2026-10-19' })
    expect(r.people_not_checked).toEqual([{ name: 'Sam', reason: 'google_error' }])
  })

  it('employees are refused, and the tool is exec-only on the access wall', async () => {
    team()
    const r = await call('find_team_free_time', ctxFor(ERIN, { selfOnly: true }), { people: ['Sam'] })
    expect(r).toMatchObject({ ok: false, error: 'not_allowed' })
    expect(g.busyCalls).toHaveLength(0)
    expect(EMPLOYEE_TOOLS.has('find_team_free_time')).toBe(false)
  })

  it('is registered and in the calendar capability', () => {
    expect(CXO_TOOL_DEFS.some((d) => d.name === 'find_team_free_time')).toBe(true)
    expect(routingHintsFor(['find_team_free_time']).join('\n')).toMatch(/find_team_free_time/)
    expect(routingHintsFor(['create_calendar_event']).join('\n')).toMatch(/recurrence/)
  })
})
