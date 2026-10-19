/**
 * Ciao QA 2026-10-19 (real account): "set up a weekly 1:1 with my team every
 * Monday at a time that's still ahead today or tomorrow".
 *  - Ciao offered open times checked as free 30-minute slots (today 10:00).
 *  - The person picked 10:00 and the proposal booked 10:00-11:00, over the
 *    10:30 meeting, which Ciao then flagged as a clash.
 * The slot search and the booking now use one length: 30 minutes unless the
 * person names one. The repeat line no longer says "no end date".
 * Google and the database are mocked; no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'update', 'insert', 'like', 'gte', 'lt', 'lte', 'not', 'ilike', 'upsert']) q[k] = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.single = async () => ({ data: null, error: null })
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: [], error: null }))
  return { supabase: { from: () => q } }
})

type Ev = { startIso: string; endIso: string; title?: string }
const g = { events: [] as Ev[] }
vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listConnectedGoogleAccounts: async () => [{ accountId: 'acc-dana', memberId: 'm-dana', email: 'dana@acme.test', label: 'Dana', isShared: false }],
  getBusySlots: async (_rep: string, from: string, to: string, opts: { windows?: Array<{ fromIso: string; toIso: string }> } = {}) => {
    const spans = opts.windows?.length ? opts.windows : [{ fromIso: from, toIso: to }]
    return g.events
      .filter((e) => spans.some((w) => Date.parse(e.startIso) < Date.parse(w.toIso) && Date.parse(e.endIso) > Date.parse(w.fromIso)))
      .map((e) => ({ startIso: e.startIso, endIso: e.endIso, calendar: 'Work', ...(e.title ? { title: e.title } : {}) }))
  },
}))
vi.mock('@/lib/cxoCalendar', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  chooseCalendar: async () => ({ calendar: { accountId: 'acc-dana', memberId: 'm-dana', accountEmail: 'dana@acme.test', accountLabel: 'Dana', calendarId: 'primary', name: 'Work', primary: true }, choices: [], ambiguous: false }),
}))

import { CXO_TOOL_HANDLERS, describeCxoCall } from '@/lib/agent/cxoTools'
import { bookedEndIso, DEFAULT_MEETING_MIN, meetingMinutes, namesLength } from '@/lib/cxoMeetingTime'
import { parseRecurrence } from '@/lib/cxoRecurrence'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const et = (local: string) => new Date(`${local}-04:00`).toISOString()
const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: tz, settings: {} } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role: 'owner', timezone: tz, settings: {} } as unknown as Member
const ctx = (userText: string): AgentContext => ({ tenant: TENANT, caller: DANA, timezone: tz, todayIso: '2026-10-19', ownerMemberId: DANA.id, channel: 'app', userText })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Monday Oct 19, 2026, 7:55 AM EDT.
  vi.setSystemTime(new Date(et('2026-10-19T07:55:00')))
  g.events = [
    { startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), title: 'Standup' },
    { startIso: et('2026-10-19T10:30:00'), endIso: et('2026-10-19T11:00:00'), title: 'Agency check-in' },
  ]
})
afterEach(() => vi.useRealTimers())

const propose = async (userText: string, args: Record<string, unknown>) => {
  const d = await describeCxoCall(ctx(userText), 'create_calendar_event', args)
  if (!d || !d.ok) throw new Error(`no proposal: ${d && !d.ok ? d.result.text : 'null'}`)
  return d
}

const WEEKLY_MON = 'RRULE:FREQ=WEEKLY;BYDAY=MO'

describe('a picked open slot is booked at the length it was checked at', () => {
  it('find_open_slots offers today 10:00 as a 30-minute slot and says the length', async () => {
    const r = JSON.parse((await CXO_TOOL_HANDLERS.find_open_slots(ctx('set up a weekly 1:1 with my team every Monday'), { from: et('2026-10-19T08:00:00'), to: et('2026-10-19T17:00:00'), count: 3 })).text)
    expect(r.ok).toBe(true)
    expect(r.duration_min).toBe(30)
    expect(r.slots[0]).toMatchObject({ start: et('2026-10-19T10:00:00'), end: et('2026-10-19T10:30:00') })
    expect(r.say).toMatch(/^Open 30-minute times:/)
    expect(r.book_note).toMatch(/books 30 minutes/)
  })

  it('the QA case: picked 10:00 with a model-sent 60-minute end books 10:00-10:30, no clash', async () => {
    const d = await propose('10:00 works', { title: 'Weekly 1:1', start: '2026-10-19T10:00', end: '2026-10-19T11:00', recurrence: WEEKLY_MON })
    const text = d.lines.join('\n')
    expect(text).toContain('First one: today, Mon, Oct 19, 10:00 AM')
    expect(text).toContain('10:00 AM EDT to 10:30 AM EDT')
    expect(text).not.toMatch(/11:00 AM/)
    expect(text).not.toMatch(/Agency check-in/)
    expect(text).toContain('No clashes in the first')
    // The yes books exactly what was shown.
    expect(d.args).toMatchObject({ start: et('2026-10-19T10:00:00'), end: et('2026-10-19T10:30:00'), length_named: true })
  })

  it('a model-sent duration_min the person never said is ignored too', async () => {
    const d = await propose('the 10', { title: 'Weekly 1:1', start: '2026-10-19T10:00', duration_min: 60, recurrence: WEEKLY_MON })
    expect(d.args.end).toBe(et('2026-10-19T10:30:00'))
  })

  it('a length the person named this turn is used', async () => {
    const d = await propose('10:00, make it 45 minutes', { title: 'Weekly 1:1', start: '2026-10-19T10:00', duration_min: 45, recurrence: WEEKLY_MON })
    expect(d.args.end).toBe(et('2026-10-19T10:45:00'))
    expect(d.lines.join('\n')).toMatch(/Agency check-in/)
  })

  it('a length named in an earlier turn rides on length_named', async () => {
    const d = await propose('10:00', { title: 'Weekly 1:1', start: '2026-10-19T10:00', duration_min: 15, length_named: true, recurrence: WEEKLY_MON })
    expect(d.args.end).toBe(et('2026-10-19T10:15:00'))
  })

  it('a named length is the one the slot search checks', async () => {
    const r = JSON.parse((await CXO_TOOL_HANDLERS.find_open_slots(ctx('find me an hour for a 1:1 today'), { from: et('2026-10-19T08:00:00'), to: et('2026-10-19T17:00:00'), duration_min: 60, count: 3 })).text)
    expect(r.duration_min).toBe(60)
    expect(r.slots[0].start).not.toBe(et('2026-10-19T10:00:00'))
    expect(r.book_note).toMatch(/duration_min: 60 and length_named: true/)
  })
})

describe('meeting length helpers', () => {
  it('one default for search and booking', () => {
    expect(DEFAULT_MEETING_MIN).toBe(30)
    expect(meetingMinutes(undefined)).toBe(30)
    expect(meetingMinutes('45')).toBe(45)
    expect(meetingMinutes(2)).toBe(5)
    expect(meetingMinutes(10_000)).toBe(480)
  })

  it('namesLength: lengths and end times count, bare times and "1:1" do not', () => {
    for (const t of ['45 minutes', 'make it an hour', '1.5h', 'half an hour', '30 min please', 'until 3pm', 'from 2-4pm', '10:00-10:45', 'all day']) expect(namesLength(t), t).toBe(true)
    for (const t of ['10:00 works', 'the 10', 'set up a weekly 1:1 with my team every Monday at a time that\'s still ahead today or tomorrow', 'yes', 'Monday at 9']) expect(namesLength(t), t).toBe(false)
  })

  it('bookedEndIso: replay keeps the shown end; unknown text keeps the args', () => {
    const start = et('2026-10-19T10:00:00')
    const end = et('2026-10-19T11:00:00')
    expect(bookedEndIso(start, { end }, { userText: 'yes' })).toBe(et('2026-10-19T10:30:00'))
    expect(bookedEndIso(start, { end }, { userText: 'yes', replay: true })).toBe(end)
    expect(bookedEndIso(start, { end }, {})).toBe(end)
  })
})

describe('repeat line without an end the person never gave', () => {
  it('weekly with no count or until: "every Monday", never "no end date"', async () => {
    const rec = parseRecurrence(WEEKLY_MON)
    expect(rec?.ok && rec.recurrence.label).toBe('every Monday')
    const d = await propose('10:00', { title: 'Weekly 1:1', start: '2026-10-19T10:00', recurrence: WEEKLY_MON })
    const text = d.lines.join('\n')
    expect(text).not.toMatch(/no end date/i)
    expect(text).toContain('Repeats: every Monday (one repeating event)')
  })

  it('an end the person gave is still said', () => {
    const c = parseRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10')
    expect(c?.ok && c.recurrence.label).toBe('every Monday, 10 times')
    const u = parseRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231')
    expect(u?.ok && u.recurrence.label).toBe('every Monday, until 2026-12-31')
  })
})
