/**
 * Ciao calendar reads (owner 10-18, Pinnacle release blocker), all mocked:
 *  - the Thursday 7:30am-1:27pm flight Gmail added (fromGmail, marked free)
 *    shows in the day/week view and blocks free time;
 *  - every overlapping pair in a range is reported, on every day;
 *  - "this week" / "next week" are fixed Mon-Fri dates (Sunday rule);
 *  - chat sessions roll over after 2h idle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const g = vi.hoisted(() => ({
  calendars: [] as Array<Record<string, unknown>>,
  events: {} as Record<string, Array<Record<string, unknown>>>,
  reads: [] as Array<{ calendarId: string; fromIso: string; toIso: string }>,
}))

vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: { email: 'mike@pinnacle.test', role: 'owner', is_active: true }, error: null }),
  })
  return { supabase: { from: () => q } }
})
vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  googleOauthConfigured: () => true,
  listConnectedGoogleAccounts: async () => [{ accountId: 'acc-1', memberId: 'm-mike', email: 'mike@pinnacle.test', label: 'Mike', isShared: false }],
  listCalendars: async () => g.calendars,
  listUpcomingEvents: async (_rep: string, o: { calendarId: string; fromIso: string; toIso: string }) => {
    g.reads.push({ calendarId: o.calendarId, fromIso: o.fromIso, toIso: o.toIso })
    return (g.events[o.calendarId] ?? []).filter((e) => Date.parse(String(e.end).length === 10 ? `${e.end}T00:00:00Z` : String(e.end)) > Date.parse(o.fromIso) && Date.parse(String(e.start).length === 10 ? `${e.start}T00:00:00Z` : String(e.start)) < Date.parse(o.toIso))
  },
}))

import { busyFromEvents, flatten, isBusyEvent, overlappingPairs, unionBusy } from '@/lib/calendarBusy'
import { isOwnTimeCalendar, todaysMeetings } from '@/lib/today'
import { daysIn, weekRanges, weekRuleLine } from '@/lib/weekRanges'
import { detectIssues, type CalEvent } from '@/lib/mira/calendarConflictsShared'
import { CIAO_IDLE_MS, historyFilter, pickConversation } from '@/lib/agent/chatSessions'
import { TOOL_HANDLERS, type AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const et = (local: string) => new Date(`${local}-04:00`).toISOString()

/** The flight exactly as Google returns a Gmail-added event: primary calendar, marked free, NY timezone. */
const FLIGHT = {
  id: 'flight-1',
  summary: 'Flight',
  eventType: 'fromGmail',
  transparency: 'transparent',
  start: '2026-10-22T07:30:00-04:00',
  end: '2026-10-22T13:27:00-04:00',
  startTimeZone: tz,
}

beforeEach(() => {
  g.calendars = [
    { id: 'mike@pinnacle.test', summary: 'Mike', primary: true, accessRole: 'owner', selected: true, timeZone: tz },
    { id: 'team123@group.calendar.google.com', summary: 'Pinnacle team', primary: false, accessRole: 'writer', selected: true, timeZone: 'America/Chicago' },
    { id: 'dana@pinnacle.test', summary: 'Dana', primary: false, accessRole: 'reader', selected: true, timeZone: 'America/Los_Angeles' },
  ]
  g.events = {}
  g.reads = []
})

describe('isBusyEvent', () => {
  const ev = (o: Record<string, unknown>) => ({ start: '2026-10-22T09:00:00-04:00', end: '2026-10-22T10:00:00-04:00', ...o })
  it('a Gmail-added flight marked free still takes up time', () => expect(isBusyEvent(ev({ eventType: 'fromGmail', transparency: 'transparent' }))).toBe(true))
  it('a normal meeting is busy; one marked free is not', () => {
    expect(isBusyEvent(ev({}))).toBe(true)
    expect(isBusyEvent(ev({ transparency: 'transparent' }))).toBe(false)
  })
  it('out of office is busy, even all day', () => {
    expect(isBusyEvent({ start: '2026-10-22', end: '2026-10-23', eventType: 'outOfOffice' })).toBe(true)
  })
  it('all-day reminders, working location, birthdays, cancelled and declined are not busy', () => {
    expect(isBusyEvent({ start: '2026-10-22', end: '2026-10-23' })).toBe(false)
    expect(isBusyEvent(ev({ eventType: 'workingLocation' }))).toBe(false)
    expect(isBusyEvent(ev({ eventType: 'birthday' }))).toBe(false)
    expect(isBusyEvent(ev({ status: 'cancelled' }))).toBe(false)
    expect(isBusyEvent(ev({ attendees: [{ self: true, responseStatus: 'declined' }] }))).toBe(false)
  })
})

describe('busyFromEvents / unionBusy', () => {
  it('the flight becomes a 7:30am-1:27pm ET busy block (raw Google shape)', () => {
    const raw = { eventType: 'fromGmail', transparency: 'transparent', start: { dateTime: '2026-10-22T07:30:00-04:00', timeZone: tz }, end: { dateTime: '2026-10-22T13:27:00-04:00', timeZone: tz } }
    const busy = busyFromEvents([flatten(raw)], tz, et('2026-10-22T00:00:00'), et('2026-10-23T00:00:00'), 'Mike')
    expect(busy).toEqual([{ startIso: '2026-10-22T11:30:00.000Z', endIso: '2026-10-22T17:27:00.000Z', calendar: 'Mike' }])
  })
  it('clips to the window and reads an all-day out-of-office in the calendar timezone', () => {
    const busy = busyFromEvents([{ start: '2026-10-22', end: '2026-10-23', eventType: 'outOfOffice' }], 'America/Chicago', et('2026-10-22T12:00:00'), et('2026-10-24T00:00:00'))
    expect(busy).toEqual([{ startIso: '2026-10-22T16:00:00.000Z', endIso: '2026-10-23T05:00:00.000Z' }])
  })
  it('unions freeBusy and event blocks, drops exact duplicates, sorts', () => {
    const a = { startIso: '2026-10-22T15:00:00Z', endIso: '2026-10-22T16:00:00Z' }
    const b = { startIso: '2026-10-22T11:30:00Z', endIso: '2026-10-22T17:27:00Z' }
    expect(unionBusy([a], [b, { ...a, startIso: '2026-10-22T15:00:00.000Z' }])).toEqual([b, a])
  })
})

describe('overlappingPairs', () => {
  it('finds every overlapping pair, including chains and on separate days', () => {
    const h = (d: number, s: number, e: number) => ({ s: Date.UTC(2026, 9, d, s), e: Date.UTC(2026, 9, d, e) })
    // Day 22: A 9-12 overlaps B 10-11 and C 11:30-13 (C starts inside A); B and C do not. Day 23: D and E overlap.
    const spans = [h(22, 9, 12), h(22, 10, 11), { s: Date.UTC(2026, 9, 22, 11, 30), e: Date.UTC(2026, 9, 22, 13) }, h(23, 14, 15), h(23, 14, 16), h(23, 17, 18)]
    expect(overlappingPairs(spans)).toEqual([[0, 1], [0, 2], [3, 4]])
  })
  it('back-to-back is not an overlap', () => expect(overlappingPairs([{ s: 0, e: 10 }, { s: 10, e: 20 }])).toEqual([]))
})

describe('isOwnTimeCalendar', () => {
  it('primary, owned, and a switched-on team calendar they can edit count; a colleague\'s calendar does not', () => {
    expect(isOwnTimeCalendar({ id: 'me@x.test', primary: true })).toBe(true)
    expect(isOwnTimeCalendar({ id: 'side@group.calendar.google.com', accessRole: 'owner' })).toBe(true)
    expect(isOwnTimeCalendar({ id: 'team@group.calendar.google.com', accessRole: 'writer', selected: true })).toBe(true)
    expect(isOwnTimeCalendar({ id: 'team@group.calendar.google.com', accessRole: 'writer', selected: false })).toBe(false)
    expect(isOwnTimeCalendar({ id: 'dana@x.test', accessRole: 'writer', selected: true })).toBe(false)
    expect(isOwnTimeCalendar({ id: 'dana@x.test', accessRole: 'reader', selected: true })).toBe(false)
  })
})

describe('todaysMeetings (the day and week view)', () => {
  it('shows the Gmail flight, reads every selected calendar, and marks free-time entries', async () => {
    g.events['mike@pinnacle.test'] = [FLIGHT, { id: 'wl', summary: 'Home', eventType: 'workingLocation', start: '2026-10-22', end: '2026-10-23' }]
    g.events['team123@group.calendar.google.com'] = [{ id: 'standup', summary: 'Standup', eventType: 'default', start: '2026-10-22T09:00:00-05:00', end: '2026-10-22T09:30:00-05:00' }]
    const out = await todaysMeetings('rep_x', 'm-mike', tz, 1, { fromDay: '2026-10-22' })
    expect(new Set(g.reads.map((r) => r.calendarId))).toEqual(new Set(['mike@pinnacle.test', 'team123@group.calendar.google.com', 'dana@pinnacle.test']))
    // The window is local midnight to midnight in New York.
    expect(g.reads[0]).toMatchObject({ fromIso: '2026-10-22T04:00:00.000Z', toIso: '2026-10-23T04:00:00.000Z' })
    const flight = out!.find((m) => m.id === 'flight-1')
    expect(flight).toMatchObject({ allDay: false, notBusy: false })
    expect(out!.find((m) => m.id === 'wl')).toBeUndefined()
    expect(out!.map((m) => m.id)).toEqual(['flight-1', 'standup'])
  })
  it('ownCalendarsOnly keeps primary and the team calendar, skips a colleague\'s', async () => {
    await todaysMeetings('rep_x', 'm-mike', tz, 5, { fromDay: '2026-10-19', ownCalendarsOnly: true })
    expect(new Set(g.reads.map((r) => r.calendarId))).toEqual(new Set(['mike@pinnacle.test', 'team123@group.calendar.google.com']))
  })
})

describe('list_calendar_events: overlaps across the range', () => {
  const TENANT = { id: 'rep_x', brand: 'cxo', timezone: tz, settings: {} } as unknown as Tenant
  const MIKE = { id: 'm-mike', rep_id: 'rep_x', role: 'owner', timezone: tz, email: 'mike@pinnacle.test' } as unknown as Member
  const ctx: AgentContext = { tenant: TENANT, caller: MIKE, timezone: tz, todayIso: '2026-10-18', ownerMemberId: MIKE.id, channel: 'app' }

  it('next week from Sunday Oct 18 reads Oct 26-30 and names every pair on every day, the flight included', async () => {
    g.events['mike@pinnacle.test'] = [
      { ...FLIGHT, id: 'f', start: '2026-10-29T07:30:00-04:00', end: '2026-10-29T13:27:00-04:00' },
      { id: 'a', summary: 'Board prep', eventType: 'default', start: '2026-10-29T09:00:00-04:00', end: '2026-10-29T10:00:00-04:00' },
      { id: 'b', summary: 'Lunch', eventType: 'default', start: '2026-10-29T12:00:00-04:00', end: '2026-10-29T13:00:00-04:00' },
      { id: 'c', summary: 'Pipeline', eventType: 'default', start: '2026-10-26T14:00:00-04:00', end: '2026-10-26T15:00:00-04:00' },
      { id: 'free', summary: 'Hold', eventType: 'default', transparency: 'transparent', start: '2026-10-26T14:30:00-04:00', end: '2026-10-26T15:30:00-04:00' },
    ]
    g.events['team123@group.calendar.google.com'] = [{ id: 'd', summary: 'Team sync', eventType: 'default', start: '2026-10-26T13:30:00-05:00', end: '2026-10-26T14:30:00-05:00' }]
    const j = JSON.parse((await TOOL_HANDLERS.list_calendar_events(ctx, { window: 'next_week' })).text)
    expect(j).toMatchObject({ from: '2026-10-26', days: 5 })
    expect(g.reads[0]).toMatchObject({ fromIso: '2026-10-26T04:00:00.000Z', toIso: '2026-10-31T04:00:00.000Z' })
    const pairs = (j.overlaps as Array<{ first: { id: string }; second: { id: string } }>).map((p) => [p.first.id, p.second.id].sort().join('+')).sort()
    // Mon: Pipeline 2-3 ET vs Team sync 2:30-3:30 ET (Chicago). Thu: flight vs Board prep and vs Lunch. The free hold is no clash.
    expect(pairs).toEqual(['a+f', 'b+f', 'c+d'])
    expect(j.overlaps_rule).toMatch(/3 overlapping pairs/)
    expect(j.items.find((i: { id: string }) => i.id === 'free').shows_as_free).toBe(true)
  })
})

describe('detectIssues with untilMs', () => {
  const ev = (id: string, s: string, e: string): CalEvent => ({ id, title: id, start: et(s), end: et(e), allDay: false, attendees: [] })
  it('flags every double-booking through the end of next week, not only 7 days', () => {
    const events = [ev('a', '2026-10-20T09:00:00', '2026-10-20T10:00:00'), ev('b', '2026-10-20T09:30:00', '2026-10-20T10:30:00'), ev('c', '2026-10-29T09:00:00', '2026-10-29T10:00:00'), ev('d', '2026-10-29T09:15:00', '2026-10-29T09:45:00')]
    const now = new Date(et('2026-10-18T12:00:00'))
    const base = { events, tz, now, selfEmails: [], memberId: 'm' }
    expect(detectIssues(base).filter((i) => i.kind === 'double')).toHaveLength(1)
    const later = detectIssues({ ...base, untilMs: Date.parse(et('2026-10-31T00:00:00')) }).filter((i) => i.kind === 'double')
    expect(later.map((i) => i.eventIds.join('+'))).toEqual(['a+b', 'c+d'])
  })
})

describe('week words', () => {
  it('Sunday Oct 18 2026: this week is Oct 19-23, next week Oct 26-30', () => {
    expect(weekRanges('2026-10-18')).toMatchObject({ weekday: 0, thisWeek: { from: '2026-10-19', to: '2026-10-23' }, nextWeek: { from: '2026-10-26', to: '2026-10-30' } })
  })
  it('a Wednesday and a Saturday', () => {
    expect(weekRanges('2026-10-21')).toMatchObject({ thisWeek: { from: '2026-10-19', to: '2026-10-23' }, nextWeek: { from: '2026-10-26', to: '2026-10-30' } })
    expect(weekRanges('2026-10-24')).toMatchObject({ thisWeek: { from: '2026-10-19', to: '2026-10-23' }, nextWeek: { from: '2026-10-26', to: '2026-10-30' } })
  })
  it('across a month end', () => expect(weekRanges('2026-10-30').nextWeek).toEqual({ from: '2026-11-02', to: '2026-11-06' }))
  it('daysIn counts the work week as 5', () => expect(daysIn({ from: '2026-10-26', to: '2026-10-30' })).toBe(5))
  it('the prompt line carries the real dates and the Sunday rule', () => {
    const line = weekRuleLine('2026-10-18')
    expect(line).toContain('"this week" = Mon, Oct 19 to Fri, Oct 23')
    expect(line).toContain('"next week" = Mon, Oct 26 to Fri, Oct 30 (2026-10-26 to 2026-10-30)')
    expect(line).toMatch(/Today is Sunday/)
  })
})

describe('chat sessions', () => {
  const now = Date.parse('2026-10-18T18:00:00Z')
  it('reuses a conversation inside 2h, starts fresh after, or when asked', () => {
    expect(CIAO_IDLE_MS).toBe(2 * 3_600_000)
    expect(pickConversation(null, now)).toBe('new')
    expect(pickConversation({ last_at: new Date(now - 30 * 60_000).toISOString() }, now)).toBe('reuse')
    expect(pickConversation({ last_at: new Date(now - CIAO_IDLE_MS - 1).toISOString() }, now)).toBe('new')
    expect(pickConversation({ last_at: new Date(now - 60_000).toISOString() }, now, true)).toBe('new')
  })
  it('the history filter is the conversation plus older untagged turns since it started', () => {
    expect(historyFilter({ id: 'c1', started_at: '2026-10-18T16:00:00.000Z' })).toBe('conversation_id.eq.c1,and(conversation_id.is.null,created_at.gte.2026-10-18T16:00:00.000Z)')
    expect(historyFilter({ id: '', started_at: '2026-10-18T16:00:00.000Z' })).toBe('and(conversation_id.is.null,created_at.gte.2026-10-18T16:00:00.000Z)')
  })
})
