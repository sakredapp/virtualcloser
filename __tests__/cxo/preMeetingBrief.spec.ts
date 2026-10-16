/**
 * Brief Before Every Meeting: the pure rules. Which meetings get a brief
 * (30 to 90 minutes out, timed, not briefed yet), the key shared with the
 * daily queue so a meeting is briefed once, which earlier note is "last
 * time", the brief's words, and "nothing useful → no brief".
 * Invented names only.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_LINES,
  MAX_PER_CHECK,
  attendeeLine,
  briefKey,
  composeBrief,
  inBriefWindow,
  lastNoteFor,
  noteDecisions,
  pickMeetings,
  resolveAttendees,
  seriesId,
  todoMentions,
  type BriefEvent,
  type BriefInput,
} from '@/lib/mira/preMeetingBriefShared'

const NOW = Date.parse('2026-10-16T14:00:00Z')
const at = (min: number) => new Date(NOW + min * 60_000).toISOString()
const ev = (id: string, min: number, extra: Partial<BriefEvent> = {}): BriefEvent => ({ id, title: `Meeting ${id}`, start: at(min), end: at(min + 30), attendees: [], ...extra })
const dayOf = (iso: string) => iso.slice(0, 10)

describe('window selection', () => {
  it('takes meetings 30 to 90 minutes out, inclusive', () => {
    expect(inBriefWindow(at(29), NOW)).toBe(false)
    expect(inBriefWindow(at(30), NOW)).toBe(true)
    expect(inBriefWindow(at(60), NOW)).toBe(true)
    expect(inBriefWindow(at(90), NOW)).toBe(true)
    expect(inBriefWindow(at(91), NOW)).toBe(false)
    expect(inBriefWindow(at(-10), NOW)).toBe(false)
    expect(inBriefWindow('not a date', NOW)).toBe(false)
  })

  it('a meeting is inside the window on several 10-minute checks, so a missed check never loses it', () => {
    const start = at(75)
    const hits = [0, 10, 20, 30, 40, 50].filter((m) => inBriefWindow(start, NOW + m * 60_000))
    expect(hits.length).toBeGreaterThanOrEqual(5)
  })

  it('skips all-day events, out-of-window ones and ones already briefed; soonest first; capped', () => {
    const events = [
      ev('late', 80),
      ev('soon', 35),
      ev('allday', 60, { allDay: true }),
      { ...ev('dateonly', 60), start: '2026-10-16' },
      ev('far', 200),
      ev('done', 45),
    ]
    const have = new Set([briefKey('done', '2026-10-16')])
    const got = pickMeetings(events, NOW, dayOf, have)
    expect(got.map((e) => e.id)).toEqual(['soon', 'late'])
    expect(got[0].key).toBe('mtg:soon:2026-10-16')
    const many = Array.from({ length: 12 }, (_, i) => ev(`m${i}`, 31 + i))
    expect(pickMeetings(many, NOW, dayOf, new Set())).toHaveLength(MAX_PER_CHECK)
  })

  it('the same event listed twice (two calendars) is picked once', () => {
    const got = pickMeetings([ev('dup', 40), ev('dup', 40)], NOW, dayOf, new Set())
    expect(got).toHaveLength(1)
  })
})

describe('idempotency key', () => {
  it('is the daily queue key for the same meeting, so either writer blocks the other', () => {
    expect(briefKey('abc123', '2026-10-16')).toBe('mtg:abc123:2026-10-16')
  })
  it('fits the 200-char source_key column', () => {
    expect(briefKey('x'.repeat(400), '2026-10-16').length).toBe(200)
  })
  it('a second check after the brief was kept picks nothing', () => {
    const events = [ev('a1', 50)]
    const first = pickMeetings(events, NOW, dayOf, new Set())
    expect(first).toHaveLength(1)
    const kept = new Set(first.map((e) => e.key))
    expect(pickMeetings(events, NOW + 10 * 60_000, dayOf, kept)).toHaveLength(0)
  })
})

describe('who is coming', () => {
  const members = [{ id: 'm1', email: 'dana.reyes@acme-example.com', display_name: 'Dana Reyes' }]
  const partners = [{ id: 'p1', name: 'Sam Ortiz', org: 'Northfield Partners', email: 'Sam@Northfield-example.com' }]
  const event = {
    attendees: [
      { email: 'me@acme-example.com', name: 'Me' },
      { email: 'dana.reyes@acme-example.com', name: null },
      { email: 'sam@northfield-example.com', name: 'Sam' },
      { email: 'guest1@elsewhere-example.com', name: null },
      { email: 'guest2@elsewhere-example.com', name: null },
    ],
  }
  it('drops the person themselves and resolves team members and partners by email', () => {
    const people = resolveAttendees(event, ['ME@acme-example.com'], members, partners)
    expect(people.map((p) => p.kind)).toEqual(['member', 'partner', 'guest', 'guest'])
    expect(attendeeLine(people)).toBe('With Dana Reyes, Sam Ortiz (Northfield Partners) and 2 more.')
  })
  it('head count when nobody is known, and just you when alone', () => {
    expect(attendeeLine(resolveAttendees({ attendees: [{ email: 'a@x-example.com', name: null }, { email: 'b@x-example.com', name: null }] }, [], [], []))).toBe('With 2 guests.')
    expect(attendeeLine([])).toBe('Just you on the invite.')
  })
})

describe('last time', () => {
  const notes = [
    { id: 'n-old', title: 'Carrier review with Northfield', occurred_at: '2026-09-01T15:00:00Z', mira_digest: { decisions: ['Old decision'] } },
    { id: 'n-new', title: 'Carrier review with Northfield', occurred_at: '2026-10-02T15:00:00Z', mira_digest: { decisions: ['Two-carrier pilot agreed', 'Training moves to November', 'Third'] } },
    { id: 'n-other', title: 'Budget planning', occurred_at: '2026-10-10T15:00:00Z', attendees: [{ email: 'lee@x-example.com' }] },
    { id: 'n-now', title: 'Carrier review with Northfield', occurred_at: at(55) },
  ]
  const event = { id: 'e1', title: 'Northfield carrier review', start: at(60) }

  it('picks the most recent earlier note with a similar title, never this meeting itself', () => {
    expect(lastNoteFor(event, [], notes)?.id).toBe('n-new')
  })
  it('matches by the same guests when the title differs', () => {
    const e = { id: 'e2', title: 'Quick catch-up', start: at(60) }
    expect(lastNoteFor(e, ['lee@x-example.com'], notes)?.id).toBe('n-other')
    expect(lastNoteFor(e, ['nobody@x-example.com'], notes)).toBeNull()
  })
  it('matches an earlier instance of the same recurring event', () => {
    expect(seriesId('abc123_20261009T150000Z')).toBe('abc123')
    expect(seriesId('abc123')).toBeNull()
    const e = { id: 'abc123_20261016T150000Z', title: 'Weekly', start: at(60) }
    const n = [{ id: 'n-w', title: 'Untitled recording', occurred_at: '2026-10-09T15:05:00Z', calendar_event_id: 'abc123_20261009T150000Z' }]
    expect(lastNoteFor(e, [], n)?.id).toBe('n-w')
  })
  it('reads decisions as short strings', () => {
    expect(noteDecisions(notes[1])).toHaveLength(3)
    expect(noteDecisions(null)).toEqual([])
  })
})

describe('brief composition', () => {
  const people = resolveAttendees(
    { attendees: [{ email: 'sam@northfield-example.com', name: null }, { email: 'g@x-example.com', name: null }] },
    [],
    [],
    [{ id: 'p1', name: 'Sam Ortiz', org: 'Northfield Partners', email: 'sam@northfield-example.com' }],
  )
  const base: BriefInput = { title: 'Northfield carrier review', time: '3:00pm', people, last: null, stillOpen: [], todos: [], cards: [], lastEmail: null }

  it('nothing useful beyond the title and head count → no brief', () => {
    expect(composeBrief(base)).toBeNull()
    // An earlier note with no decisions and nothing open is not worth a line either.
    expect(composeBrief({ ...base, last: { date: '2026-10-02T15:00:00Z', title: 'x', decisions: [] } })).toBeNull()
  })

  it('writes short lines: who, last time, still open, to-dos, cards, last email', () => {
    const b = composeBrief({
      ...base,
      last: { date: '2026-10-02T15:00:00Z', title: 'Carrier review with Northfield', decisions: ['Two-carrier pilot agreed', 'Training moves to November', 'Third'] },
      stillOpen: ['Send the activation checklist'],
      todos: ['Send the activation checklist', 'Call Sam Ortiz about the pilot'],
      cards: ['Pilot rollout (Q4 plan)'],
      lastEmail: { from: 'Sam', subject: 'Pilot numbers', date: '2026-10-14T09:00:00Z' },
    })
    expect(b).not.toBeNull()
    expect(b!.title).toBe('Northfield carrier review · 3:00pm')
    const lines = b!.body.split('\n')
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(lines[0]).toBe('With Sam Ortiz (Northfield Partners) and 1 more.')
    expect(lines[1]).toBe('Last time (Oct 2, Carrier review with Northfield): Two-carrier pilot agreed; Training moves to November (+1 more).')
    expect(lines[2]).toBe('Still open from it: Send the activation checklist.')
    // A to-do already listed as still open is not repeated.
    expect(lines[3]).toBe('Your open to-dos with them: Call Sam Ortiz about the pilot.')
    expect(lines[4]).toBe('On the boards: Pilot rollout (Q4 plan).')
    expect(lines[5]).toBe('Last email from Sam: "Pilot numbers" (Oct 14).')
  })

  it('one useful fact is enough', () => {
    const b = composeBrief({ ...base, cards: ['Renewal deck (Ops)'] })
    expect(b?.body).toBe('With Sam Ortiz (Northfield Partners) and 1 more.\nOn the boards: Renewal deck (Ops).')
  })

  it('long text is cut, never spills', () => {
    const b = composeBrief({ ...base, title: 'T'.repeat(400), todos: ['x'.repeat(1000)] })
    expect(b!.title.length).toBeLessThanOrEqual(140)
    for (const l of b!.body.split('\n')) expect(l.length).toBeLessThanOrEqual(240)
  })
})

describe('which to-dos are about these people', () => {
  const people = resolveAttendees({ attendees: [{ email: 'sam@northfield-example.com', name: null }] }, [], [], [{ id: 'p1', name: 'Sam Ortiz', org: null, email: 'sam@northfield-example.com' }])
  it('a link to the partner, or their full name in the text', () => {
    expect(todoMentions({ body: 'Anything', partner_id: 'p1' }, people)).toBe(true)
    expect(todoMentions({ body: 'Anything', link_id: 'p1' }, people)).toBe(true)
    expect(todoMentions({ body: 'Call sam ortiz back' }, people)).toBe(true)
    expect(todoMentions({ body: 'Call Sam back' }, people)).toBe(false)
    expect(todoMentions({ body: 'Unrelated' }, people)).toBe(false)
  })
  it('guests never match by name', () => {
    const guests = resolveAttendees({ attendees: [{ email: 'g@x-example.com', name: 'Pat Lee' }] }, [], [], [])
    expect(todoMentions({ body: 'Email Pat Lee' }, guests)).toBe(false)
  })
})
