import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findConflicts,
  inboxGate,
  isAutomatedAddress,
  isAutomatedMessage,
  validRefIds,
  validateSuggestions,
  waitingOnReply,
  type FREvent,
  type FRMessage,
  type FRThread,
} from '@/lib/firstRead/shared'

// "Ciao's first read" (lib/firstRead): the counted parts, the inbox gate and
// the hook in the Google OAuth callback.

const afterCalls: Array<() => unknown> = []
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCalls.push(fn) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in this test') } } }))

const NOW = new Date('2026-10-19T12:00:00Z')
const TZ = 'America/New_York'

function ev(p: Partial<FREvent> & { id: string; start: string; end: string }): FREvent {
  return { title: p.id, allDay: false, own: true, seriesId: null, attendees: [], notBusy: false, ...p }
}

function msg(p: Partial<FRMessage>): FRMessage {
  return {
    at: NOW.getTime() - 3_600_000,
    labelIds: ['INBOX'],
    fromAddress: 'dana@acme.com',
    fromName: 'Dana Ruiz',
    toAddresses: ['mike@pinnacle.com'],
    ccAddresses: [],
    subject: 'Q4 budget',
    listUnsubscribe: false,
    precedence: null,
    autoSubmitted: null,
    ...p,
  }
}
const thread = (id: string, ...messages: FRMessage[]): FRThread => ({ id, messages })
const SELF = ['mike@pinnacle.com']

describe('findConflicts', () => {
  it('finds two meetings that overlap and names the day', () => {
    const out = findConflicts(
      [ev({ id: 'board', title: 'Board prep', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z' }), ev({ id: 'lunch', title: 'Lunch with Sam', start: '2026-10-20T14:30:00Z', end: '2026-10-20T15:30:00Z' })],
      { now: NOW, tz: TZ },
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'c1', day: '2026-10-20', a: { title: 'Board prep' }, b: { title: 'Lunch with Sam' } })
  })

  it('back-to-back is not a conflict', () => {
    expect(findConflicts([ev({ id: 'a', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z' }), ev({ id: 'b', start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z' })], { now: NOW, tz: TZ })).toEqual([])
  })

  it('skips all-day, declined/free, past and other people\'s calendars', () => {
    const base = ev({ id: 'base', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z' })
    const out = findConflicts(
      [
        base,
        ev({ id: 'allday', start: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z', allDay: true }),
        ev({ id: 'declined', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z', notBusy: true }),
        ev({ id: 'colleague', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z', own: false }),
        ev({ id: 'past1', start: '2026-10-18T14:00:00Z', end: '2026-10-18T15:00:00Z' }),
        ev({ id: 'past2', start: '2026-10-18T14:30:00Z', end: '2026-10-18T15:30:00Z' }),
      ],
      { now: NOW, tz: TZ },
    )
    expect(out).toEqual([])
  })

  it('the same meeting on two of their calendars is one meeting, not a conflict', () => {
    const a = ev({ id: 'x1', title: 'Staff', start: '2026-10-21T13:00:00Z', end: '2026-10-21T14:00:00Z' })
    const b = ev({ id: 'x2', title: 'staff', start: '2026-10-21T13:00:00Z', end: '2026-10-21T14:00:00Z' })
    expect(findConflicts([a, b, { ...a }], { now: NOW, tz: TZ })).toEqual([])
  })

  it('ignores meetings past the window', () => {
    expect(findConflicts([ev({ id: 'a', start: '2026-12-20T14:00:00Z', end: '2026-12-20T15:00:00Z' }), ev({ id: 'b', start: '2026-12-20T14:30:00Z', end: '2026-12-20T15:30:00Z' })], { now: NOW, tz: TZ })).toEqual([])
  })
})

describe('waitingOnReply', () => {
  it('a person wrote last and it is still in the inbox: waiting', () => {
    const out = waitingOnReply([thread('t1', msg({ at: NOW.getTime() - 7_200_000, fromAddress: 'mike@pinnacle.com', labelIds: ['SENT'] }), msg({}))], SELF)
    expect(out).toEqual([{ id: 'w1', from: 'Dana Ruiz', email: 'dana@acme.com', subject: 'Q4 budget', at: new Date(NOW.getTime() - 3_600_000).toISOString() }])
  })

  it('they replied last: not waiting', () => {
    expect(waitingOnReply([thread('t1', msg({ at: NOW.getTime() - 7_200_000 }), msg({ fromAddress: 'Mike@Pinnacle.com', labelIds: ['SENT'] }))], SELF)).toEqual([])
  })

  it('archived (not in INBOX): not waiting', () => {
    expect(waitingOnReply([thread('t1', msg({ labelIds: ['IMPORTANT'] }))], SELF)).toEqual([])
  })

  it('newest first, numbered w1..', () => {
    const out = waitingOnReply([thread('old', msg({ at: NOW.getTime() - 86_400_000, subject: 'old' })), thread('new', msg({ subject: 'new' }))], SELF)
    expect(out.map((w) => [w.id, w.subject])).toEqual([['w1', 'new'], ['w2', 'old']])
  })

  it('newsletters and no-reply senders are never "waiting on you"', () => {
    const out = waitingOnReply(
      [
        thread('n1', msg({ fromAddress: 'no-reply@bank.com' })),
        thread('n2', msg({ fromAddress: 'news@morningbrew.com', listUnsubscribe: true })),
        thread('n3', msg({ labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] })),
        thread('n4', msg({ precedence: 'bulk' })),
        thread('n5', msg({ autoSubmitted: 'auto-replied' })),
        thread('n6', msg({ fromAddress: 'notifications@github.com' })),
        thread('real', msg({ subject: 'real one' })),
      ],
      SELF,
    )
    expect(out.map((w) => w.subject)).toEqual(['real one'])
  })
})

describe('automated senders', () => {
  it('spots no-reply style addresses and keeps real people', () => {
    for (const a of ['noreply@x.com', 'no-reply@x.com', 'donotreply@x.com', 'mailer-daemon@x.com', 'notifications@x.com']) expect(isAutomatedAddress(a), a).toBe(true)
    for (const a of ['dana@acme.com', 'sam.lee@pinnacle.com']) expect(isAutomatedAddress(a), a).toBe(false)
  })

  it('Auto-Submitted: no is a person', () => {
    expect(isAutomatedMessage(msg({ autoSubmitted: 'no' }))).toBe(false)
    expect(isAutomatedMessage(msg({}))).toBe(false)
  })
})

describe('inboxGate', () => {
  const GMAIL = 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly'
  it('reads the inbox only with Gmail scope on a tenant that offers it', () => {
    expect(inboxGate({ tenantAllowsInbox: true, calendarOnly: false, scope: GMAIL })).toEqual({ ok: true })
  })
  it('skips the inbox when the grant has no Gmail scope', () => {
    expect(inboxGate({ tenantAllowsInbox: true, calendarOnly: false, scope: 'openid email https://www.googleapis.com/auth/calendar' })).toEqual({ ok: false, reason: 'no_scope' })
    expect(inboxGate({ tenantAllowsInbox: true, calendarOnly: false, scope: null })).toEqual({ ok: false, reason: 'no_scope' })
  })
  it('skips a calendar-only account and a tenant without the inbox', () => {
    expect(inboxGate({ tenantAllowsInbox: true, calendarOnly: true, scope: GMAIL })).toEqual({ ok: false, reason: 'calendar_only' })
    expect(inboxGate({ tenantAllowsInbox: false, calendarOnly: false, scope: GMAIL })).toEqual({ ok: false, reason: 'not_offered' })
  })
})

describe('validateSuggestions', () => {
  const valid = validRefIds({
    people: [{ name: 'Dana', email: 'dana@acme.com', meetings: 3, emails: 2 }],
    recurring: [],
    conflicts: [{ id: 'c1', day: '2026-10-20', a: { title: 'A', start: '', end: '' }, b: { title: 'B', start: '', end: '' } }],
    waiting: [],
  })
  it('keeps offers that point at real items and drops invented ones', () => {
    const out = validateSuggestions(
      {
        suggestions: [
          { text: 'Move one of Tuesday\'s overlapping meetings.', refs: ['c1'] },
          { text: 'Reply to the board chair.', refs: ['w9'] },
          { text: 'Something with no refs.', refs: [] },
          { text: 'Email dana@acme.com for you.', refs: ['p1'] },
          { text: 'See https://evil.example', refs: ['p1'] },
        ],
      },
      valid,
    )
    expect(out).toEqual([{ text: 'Move one of Tuesday\'s overlapping meetings.', refs: ['c1'] }])
  })
  it('garbage in, nothing out', () => {
    expect(validateSuggestions('nope', valid)).toEqual([])
    expect(validateSuggestions(null, valid)).toEqual([])
  })
})

describe('the read is scheduled when Google is connected', () => {
  beforeEach(() => {
    afterCalls.length = 0
  })

  it('scheduleFirstReadAfterConnect hands the read to after() on Suite CXO only', async () => {
    const { scheduleFirstReadAfterConnect } = await import('@/lib/firstRead/run')
    const base = { repId: 'rep_spence', slotMemberId: null, viewerMemberId: 'm1', email: 'mike@pinnacle.com', force: true }
    expect(scheduleFirstReadAfterConnect({ ...base, brand: 'cxo' })).toBe(true)
    expect(afterCalls).toHaveLength(1)
    expect(scheduleFirstReadAfterConnect({ ...base, brand: 'virtualcloser' })).toBe(false)
    expect(scheduleFirstReadAfterConnect({ ...base, brand: null })).toBe(false)
    expect(afterCalls).toHaveLength(1)
  })

  it('the OAuth callback schedules it right after saving the tokens, on both connect paths', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/google/oauth/callback/route.ts'), 'utf8')
    expect(src).toContain("import { scheduleFirstReadAfterConnect } from '@/lib/firstRead/run'")
    const saves = [...src.matchAll(/await saveTokens\(/g)].map((m) => m.index!)
    const schedules = [...src.matchAll(/scheduleFirstReadAfterConnect\(\{/g)].map((m) => m.index!)
    expect(saves).toHaveLength(2)
    expect(schedules).toHaveLength(2)
    // Each save is followed by its schedule before the next save.
    expect(schedules[0]).toBeGreaterThan(saves[0])
    expect(schedules[0]).toBeLessThan(saves[1])
    expect(schedules[1]).toBeGreaterThan(saves[1])
    // Connect Google always reads; sign-in (runs every login) reads only once.
    const call = (at: number) => src.slice(at, src.indexOf('force:', at) + 12)
    const first = call(schedules[0])
    const second = call(schedules[1])
    expect(first).toContain('force: true')
    expect(second).toContain('force: false')
  })
})
