/**
 * getBusySlots (find_free_time, find_open_slots, find_team_free_time all read
 * it) with Google faked at fetch. The 10-18 bug: Google's freeBusy leaves out
 * events marked "free", and Gmail marks the flights it adds as free, so a
 * Thursday 7:30am-1:27pm flight read as open time. Every calendar's events are
 * now read too and the ones that take up time are added.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tokenRows: Array<Record<string, unknown>> = []
function query(table: string) {
  const filters: Array<[string, unknown]> = []
  const q: Record<string, unknown> = {}
  const rows = () => (table === 'google_tokens' ? tokenRows.filter((r) => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v))) : [])
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push([k, v]), q),
    is: (k: string, v: unknown) => (filters.push([k, v]), q),
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: (v: unknown) => void) => res({ data: rows(), error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
    insert: async (row: Record<string, unknown>) => {
      tokenRows.push({ id: `row-${tokenRows.length + 1}`, created_at: new Date().toISOString(), ...row })
      return { error: null }
    },
  })
  return q
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }))
vi.mock('@/lib/cxoInbox', () => ({ inboxAllowedForRep: async () => true, inboxBlockedRepIds: async () => [] }))

const ENV = { ...process.env }
const tz = 'America/New_York'
const calls: string[] = []

const CALENDARS = [
  { id: 'mike@pinnacle.test', summary: 'Mike', primary: true, accessRole: 'owner', selected: true, timeZone: tz },
  { id: 'team123@group.calendar.google.com', summary: 'Pinnacle team', accessRole: 'writer', selected: true, timeZone: 'America/Chicago' },
]
const EVENTS: Record<string, unknown[]> = {
  'mike@pinnacle.test': [
    { id: 'flight', eventType: 'fromGmail', transparency: 'transparent', start: { dateTime: '2026-10-22T07:30:00-04:00', timeZone: tz }, end: { dateTime: '2026-10-22T13:27:00-04:00', timeZone: tz } },
    { id: 'hold', eventType: 'default', transparency: 'transparent', start: { dateTime: '2026-10-22T15:00:00-04:00' }, end: { dateTime: '2026-10-22T16:00:00-04:00' } },
  ],
  'team123@group.calendar.google.com': [
    { id: 'sync', eventType: 'default', start: { dateTime: '2026-10-22T14:00:00-05:00', timeZone: 'America/Chicago' }, end: { dateTime: '2026-10-22T15:00:00-05:00', timeZone: 'America/Chicago' } },
  ],
}

beforeEach(() => {
  tokenRows.length = 0
  calls.length = 0
  process.env.GOOGLE_CLIENT_ID = 'global-123.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'global-secret'
  process.env.GOOGLE_REDIRECT_URI = 'https://suitecxo.com/api/google/oauth/callback'
  process.env.SESSION_SECRET = 'test-session-secret-for-google-key'
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (url.includes('/calendarList')) return json({ items: CALENDARS })
    // freeBusy, as Google answers it: the opaque team sync only. The flight is missing.
    if (url.includes('/freeBusy')) return json({ calendars: { 'mike@pinnacle.test': { busy: [] }, 'team123@group.calendar.google.com': { busy: [{ start: '2026-10-22T19:00:00Z', end: '2026-10-22T20:00:00Z' }] } } })
    const m = url.match(/\/calendars\/([^/]+)\/events/)
    if (m) return json({ items: EVENTS[decodeURIComponent(m[1])] ?? [] })
    return new Response('{}', { status: 404 })
  })
})
afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
})

describe('getBusySlots', () => {
  it('counts the Gmail flight marked free as busy, keeps freeBusy blocks, ignores a hold marked free', async () => {
    const g = await import('@/lib/google')
    await g.saveTokens({ repId: 'rep_x', memberId: 'm-mike', accessToken: 'tok', refreshToken: 'r', expiresInSec: 3600, email: 'mike@pinnacle.test', consent: true, issuer: { source: 'global', clientId: 'global-123.apps.googleusercontent.com' } })
    const busy = await g.getBusySlots('rep_x', '2026-10-22T04:00:00.000Z', '2026-10-23T04:00:00.000Z', { memberId: 'm-mike', timeZone: tz })
    expect(busy).not.toBeNull()
    const spans = busy!.map((b) => [new Date(b.startIso).toISOString(), new Date(b.endIso).toISOString(), b.calendar])
    expect(spans).toEqual([
      ['2026-10-22T11:30:00.000Z', '2026-10-22T17:27:00.000Z', 'Mike'],
      ['2026-10-22T19:00:00.000Z', '2026-10-22T20:00:00.000Z', 'Pinnacle team'],
    ])
    // Both calendars' events were read, not only primary.
    expect(calls.filter((u) => u.includes('/events?')).map((u) => decodeURIComponent(u.match(/\/calendars\/([^/]+)\/events/)![1])).sort()).toEqual(['mike@pinnacle.test', 'team123@group.calendar.google.com'])
  })
})
