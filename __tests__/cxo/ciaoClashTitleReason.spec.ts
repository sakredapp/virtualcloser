/**
 * Ciao QA 2026-10-19 (second pass):
 *  1. A one-off booked over a clash names the meeting and its start and end,
 *     the same detail as the repeating path; never "overlaps something already
 *     on your calendar", never "booking it anyway".
 *  2. "Book 30 min at the start of my busiest meeting": the title matches the
 *     real timing (never "before" a meeting it sits on), the proposal is in
 *     the future tense, and a reason Ciao picked the meeting is shown.
 *  3. Speed: a repeating event's clash check reads only its first dates, not
 *     the weeks between them; find_open_slots lists the accounts once.
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
const g = {
  events: [] as Ev[],
  reads: [] as Array<{ from: string; to: string; windows?: Array<{ fromIso: string; toIso: string }> }>,
  listings: 0,
  fail: false,
}
vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listConnectedGoogleAccounts: async () => {
    g.listings++
    return [{ accountId: 'acc-dana', memberId: 'm-dana', email: 'dana@acme.test', label: 'Dana', isShared: false }]
  },
  getBusySlots: async (_rep: string, from: string, to: string, opts: { windows?: Array<{ fromIso: string; toIso: string }> } = {}) => {
    g.reads.push({ from, to, ...(opts.windows ? { windows: opts.windows } : {}) })
    if (g.fail) throw new Error('google down')
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

import { BUSY_READ_PAD_MS, findOpenSlots, paddedReadWindows } from '@/lib/cxoCalendar'
import { describeCxoCall, REPEAT_CHECK_DATES, titleForTiming } from '@/lib/agent/cxoTools'
import { proposalText } from '@/lib/agent/confirmGateShared'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const et = (local: string) => new Date(`${local}-04:00`).toISOString()
const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: tz, settings: {} } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role: 'owner', timezone: tz, settings: {} } as unknown as Member
const ctx = (): AgentContext => ({ tenant: TENANT, caller: DANA, timezone: tz, todayIso: '2026-10-19', ownerMemberId: DANA.id, channel: 'app' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(et('2026-10-19T07:55:00')))
  g.events = [
    { startIso: et('2026-10-20T11:00:00'), endIso: et('2026-10-20T12:30:00'), title: 'Board prep' },
    { startIso: et('2026-10-20T13:00:00'), endIso: et('2026-10-20T13:30:00'), title: 'Agency check-in' },
  ]
  g.reads = []
  g.listings = 0
  g.fail = false
})
afterEach(() => vi.useRealTimers())

const propose = async (args: Record<string, unknown>) => {
  const d = await describeCxoCall(ctx(), 'create_calendar_event', args)
  if (!d || !d.ok) throw new Error(`no proposal: ${d && !d.ok ? d.result.text : 'null'}`)
  return d
}

describe('one-off clash booked anyway names the meeting', () => {
  it('names the meeting with its own start and end, in the future tense', async () => {
    const d = await propose({ title: 'Pipeline prep', start: '2026-10-20T13:00', duration_min: 30, allow_conflict: true })
    const text = d.lines.join('\n')
    expect(text).toContain('Clashes with "Agency check-in" (Tue, Oct 20, 1:00 PM EDT to Tue, Oct 20, 1:30 PM EDT). I\'ll book it anyway when you say yes.')
    expect(text).not.toMatch(/something already on your calendar/)
    expect(text).not.toMatch(/booking it anyway/i)
    expect(d.lines[0]).toBe('I\'ll create the event "Pipeline prep"')
    // The person sees it under the "Nothing is done yet" header.
    expect(proposalText([{ summary: d.lines.join('\n') }] as never)).toMatch(/Nothing is done yet/)
  })

  it('same clash detail as the repeating path', async () => {
    const one = await propose({ title: 'Prep', start: '2026-10-20T11:30', duration_min: 30, allow_conflict: true })
    const rep = await propose({ title: 'Prep', start: '2026-10-20T11:30', duration_min: 30, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4' })
    const detail = '"Board prep" (Tue, Oct 20, 11:00 AM EDT to Tue, Oct 20, 12:30 PM EDT)'
    expect(one.lines.join('\n')).toContain(`Clashes with ${detail}`)
    expect(rep.lines.join('\n')).toContain(detail)
  })

  it('no clash: no clash line; calendar unreadable: says it could not check', async () => {
    const clear = await propose({ title: 'Focus', start: '2026-10-20T15:00', duration_min: 30, allow_conflict: true })
    expect(clear.lines.join('\n')).not.toMatch(/Clashes with|could not read/)
    g.fail = true
    const blind = await propose({ title: 'Focus', start: '2026-10-20T15:00', duration_min: 30, allow_conflict: true })
    expect(blind.lines.join('\n')).toContain('I could not read your calendar to check for clashes.')
  })
})

describe('title matches the real timing; reason shown', () => {
  it('"Hold before Board prep" at Board prep\'s start becomes "at the start of"', async () => {
    const d = await propose({ title: 'Hold before Board prep', start: '2026-10-20T11:00', duration_min: 30, allow_conflict: true, reason: 'most attendees (8)' })
    expect(d.lines[0]).toBe('I\'ll create the event "Hold at the start of Board prep"')
    expect(d.args.title).toBe('Hold at the start of Board prep')
    expect(d.lines).toContain('Why this time: most attendees (8).')
  })

  it('titleForTiming: inside is "during", a real before is kept, unrelated titles untouched', () => {
    const busy = [{ title: 'Board prep', startIso: et('2026-10-20T11:00:00'), endIso: et('2026-10-20T12:30:00') }]
    expect(titleForTiming('Prep ahead of Board prep', et('2026-10-20T11:30:00'), et('2026-10-20T12:00:00'), busy)).toBe('Prep during Board prep')
    expect(titleForTiming('Hold before Board prep', et('2026-10-20T10:30:00'), et('2026-10-20T11:00:00'), busy)).toBe('Hold before Board prep')
    expect(titleForTiming('Before lunch walk', et('2026-10-20T11:00:00'), et('2026-10-20T11:30:00'), busy)).toBe('Before lunch walk')
  })

  it('a hold named after the meeting it sits on does not ask who to invite', async () => {
    const d = await propose({ title: 'At the start of Agency check-in', start: '2026-10-20T13:00', duration_min: 30, allow_conflict: true })
    expect(d.lines.join('\n')).not.toMatch(/Who should I invite/)
    const real = await propose({ title: 'Weekly check-in', start: '2026-10-20T15:00', duration_min: 30 })
    expect(real.lines.join('\n')).toMatch(/Who should I invite/)
  })

  it('no reason passed: no reason line', async () => {
    const d = await propose({ title: 'Focus', start: '2026-10-20T15:00', duration_min: 30 })
    expect(d.lines.join('\n')).not.toMatch(/Why this time/)
  })
})

describe('speed: narrow reads', () => {
  it('a weekly event reads padded windows around its first dates, not three weeks', async () => {
    await propose({ title: 'Weekly 1:1', start: '2026-10-19T09:00', duration_min: 30, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10' })
    expect(g.reads).toHaveLength(1)
    const w = g.reads[0].windows
    expect(w).toHaveLength(REPEAT_CHECK_DATES)
    for (const x of w!) expect(Date.parse(x.toIso) - Date.parse(x.fromIso)).toBe(2 * BUSY_READ_PAD_MS + 30 * 60_000)
  })

  it('paddedReadWindows merges stretches whose padding overlaps', () => {
    const out = paddedReadWindows([
      { fromIso: et('2026-10-19T09:00:00'), toIso: et('2026-10-19T09:30:00') },
      { fromIso: et('2026-10-20T09:00:00'), toIso: et('2026-10-20T09:30:00') },
      { fromIso: et('2026-10-26T09:00:00'), toIso: et('2026-10-26T09:30:00') },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ fromIso: new Date(Date.parse(et('2026-10-19T09:00:00')) - BUSY_READ_PAD_MS).toISOString(), toIso: new Date(Date.parse(et('2026-10-20T09:30:00')) + BUSY_READ_PAD_MS).toISOString() })
  })

  it('find_open_slots lists the connected accounts once', async () => {
    await findOpenSlots('rep-acme', { fromIso: et('2026-10-19T08:00:00'), toIso: et('2026-10-21T00:00:00'), durationMin: 30, tz }, { memberId: 'm-dana' })
    expect(g.listings).toBe(1)
  })
})
