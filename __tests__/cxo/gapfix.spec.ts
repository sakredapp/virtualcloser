import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { memberTitle } from '@/lib/memberTitle'
import { parseMarkdown, inlineText } from '@/lib/markdown'
import Markdown from '@/app/components/cxo/Markdown'
import { syncedAtOf, syncStampLabel } from '@/lib/pinnacle/syncStamp'
import { noteForEvent, noteHref, matchNotesForEvent, notesLinkFor, isConfidentMatch, titleWords } from '@/lib/meetings/noteMatch'
import { cardMiraPrompt } from '@/lib/boardsShared'

describe('rail title (memberTitle)', () => {
  it('uses a stored title first', () => {
    expect(memberTitle({ role: 'owner', settings: { title: '  President ' } })).toBe('President')
  })
  it('falls back to the role in plain words', () => {
    expect(memberTitle({ role: 'owner', settings: {} })).toBe('Owner')
    expect(memberTitle({ role: 'admin', settings: { title: '   ' } })).toBe('Executive')
    expect(memberTitle({ role: 'assistant' })).toBe('Executive assistant')
    expect(memberTitle({ role: 'rep', settings: { title: 42 } })).toBe('Team member')
  })
  it('an assistant working as their exec is still the assistant', () => {
    expect(memberTitle({ role: 'admin', settings: { title: 'CFO' }, acting_assistant: { id: 'x' } })).toBe('Executive assistant')
  })
  it('unknown role and no title = nothing', () => {
    expect(memberTitle({ role: 'weird' })).toBeNull()
  })
})

describe('meeting summary markdown', () => {
  const summary = [
    '> Date & Time: 2026-07-09 15:05:16',
    '## Overview',
    'The **consultation** focuses on onboarding.',
    '### Key points',
    '- First point',
    '  - nested point',
    '* Second with __bold__',
    '---',
    '## To-Do List',
    '- [ ] Draft the call script',
    '- [x] Send the deck',
    '1. one',
    '2. two',
    '| Name | Amount |',
    '|---|---:|',
    '| Jeff | $10M |',
  ].join('\n')

  it('parses headings, lists, checkboxes, quotes, rules and tables', () => {
    const b = parseMarkdown(summary)
    expect(b.map((x) => x.t)).toEqual(['quote', 'heading', 'para', 'heading', 'list', 'rule', 'heading', 'list', 'list', 'table'])
    const todo = b[7]
    expect(todo.t === 'list' && todo.items.map((i) => [inlineText(i.text), i.task])).toEqual([
      ['Draft the call script', 'open'],
      ['Send the deck', 'done'],
    ])
    const bullets = b[4]
    expect(bullets.t === 'list' && bullets.items.map((i) => i.depth)).toEqual([0, 1, 0])
  })

  it('renders no raw markdown markers', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: summary }))
    expect(html).toContain('<strong>consultation</strong>')
    expect(html).toContain('role="heading"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<table>')
    expect(html).not.toMatch(/##|\*\*|\[ \]|\[x\]/)
  })

  it('never injects HTML or unsafe links', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>' }))
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps https links', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: 'See [the deck](https://example.com/d).' }))
    expect(html).toContain('href="https://example.com/d"')
  })
})

describe('one sync timestamp', () => {
  it('reads the last sync, not the cache rebuild', () => {
    expect(syncedAtOf({ lastRun: { started_at: '2026-10-09T05:00:00Z', finished_at: '2026-10-09T05:02:00Z' }, computedAt: '2026-10-09T13:39:00Z' })).toBe('2026-10-09T05:02:00Z')
    expect(syncedAtOf({ lastRun: { started_at: '2026-10-09T05:00:00Z', finished_at: null }, computedAt: null })).toBe('2026-10-09T05:00:00Z')
    expect(syncedAtOf({ lastRun: null, computedAt: '2026-10-09T13:39:00Z' })).toBe('2026-10-09T13:39:00Z')
  })
  it('labels today / yesterday / a date in the given zone', () => {
    const now = new Date('2026-10-09T18:00:00Z')
    expect(syncStampLabel('2026-10-09T10:02:00Z', now, 'America/Chicago')).toBe('Last synced today 5:02am')
    expect(syncStampLabel('2026-10-08T20:00:00Z', now, 'America/Chicago')).toBe('Last synced yesterday 3:00pm')
    expect(syncStampLabel('2026-10-03T14:00:00Z', now, 'America/Chicago')).toBe('Last synced Oct 3 9:00am')
  })
})

describe('calendar event -> meeting note', () => {
  const notes = [
    { id: 'n1', title: 'Weekly exec sync', occurred_at: '2026-10-05T15:04:00Z', calendar_event_id: null },
    { id: 'n2', title: 'Board prep', occurred_at: '2026-10-01T12:00:00Z', calendar_event_id: 'gcal123' },
  ]
  it('matches on the calendar event id first', () => {
    expect(noteForEvent({ eventId: 'gcal123', startIso: '2026-10-09T15:00:00Z', endIso: '2026-10-09T16:00:00Z', title: 'Other' }, notes)?.id).toBe('n2')
  })
  it('matches a note inside the event window', () => {
    expect(noteForEvent({ startIso: '2026-10-05T15:00:00Z', endIso: '2026-10-05T15:30:00Z', title: 'Something else' }, notes)?.id).toBe('n1')
  })
  it('title only matches on the same day, never a recurring meeting weeks later', () => {
    expect(noteForEvent({ startIso: '2026-10-05T19:00:00Z', endIso: '2026-10-05T19:30:00Z', title: 'Weekly exec sync' }, notes)?.id).toBe('n1')
    expect(noteForEvent({ startIso: '2026-10-12T15:00:00Z', endIso: '2026-10-12T15:30:00Z', title: 'Weekly exec sync' }, notes)).toBeNull()
  })
  it('all-day events and empty windows get no notes', () => {
    expect(noteForEvent({ startIso: '2026-10-05', endIso: '2026-10-06', title: 'Holiday', allDay: true }, notes)).toBeNull()
    expect(noteForEvent({ startIso: '2026-10-20T15:00:00Z', endIso: '2026-10-20T16:00:00Z', title: 'Nothing' }, notes)).toBeNull()
  })
  it('links to the note on the Meetings page', () => {
    expect(noteHref('n1')).toBe('/dashboard/meetings?note=n1#note-n1')
  })
})

describe('Ask Mira on a board card', () => {
  it('carries title, list, board, description and checklist', () => {
    const t = cardMiraPrompt({ title: '2027 plan draft', list: 'In progress', board: 'Exec', notes: 'Targets   for the\nworking session', due: '2026-10-15', checklist: [{ text: 'Revenue', done: true }, { text: 'Headcount', done: false }] })
    expect(t).toContain('“2027 plan draft” in “In progress” on the Exec board')
    expect(t).toContain('Description: Targets for the working session')
    expect(t).toContain('Due 2026-10-15.')
    expect(t).toContain('Checklist: 1 of 2 done; still open: Headcount.')
  })
  it('does not say "board board"', () => {
    expect(cardMiraPrompt({ title: 'X', list: 'Doing', board: 'Exec board' })).toContain('on the Exec board.')
  })
  it('skips what the card does not have', () => {
    expect(cardMiraPrompt({ title: 'Call Jeff' })).toBe('About the card “Call Jeff”.\nWhat should happen next on this?')
  })
})

describe('two notes at the same time (Open notes ambiguity)', () => {
  // Same shape as Pinnacle's Jul 9: two notes both stamped 15:05:16.
  const at = '2026-07-09T15:05:16Z'
  const outreach = { id: 'b8e1', title: '07-09 Meeting: Client Outreach and Sales Strategy', occurred_at: at, calendar_event_id: null }
  const alex = { id: 'dce6', title: '07-09 Consultation: Alex Miller Insurance Onboarding, Script Development, and High-Volume Cross-Selling', occurred_at: at, calendar_event_id: null }
  const notes = [outreach, alex]
  const win = { startIso: '2026-07-09T15:00:00Z', endIso: '2026-07-09T16:00:00Z' }

  it('an exact calendar event id wins over time and title', () => {
    const filed = { ...outreach, calendar_event_id: 'gcal-alex' }
    const m = matchNotesForEvent({ ...win, eventId: 'gcal-alex', title: 'Alex Miller onboarding call' }, [filed, alex])
    expect(m).toEqual({ kind: 'one', note: filed, by: 'id' })
  })
  it('a note already filed to another event is not offered for this one', () => {
    const filed = { ...outreach, calendar_event_id: 'gcal-other' }
    const m = matchNotesForEvent({ ...win, eventId: 'gcal-this', title: 'Pipeline review' }, [filed, alex])
    expect(m?.kind === 'one' && m.note.id).toBe('dce6')
  })
  it('two same-start notes are resolved by the event title', () => {
    const m = matchNotesForEvent({ ...win, title: 'Alex Miller onboarding call' }, notes)
    expect(m).toMatchObject({ kind: 'one', by: 'title' })
    expect(m?.kind === 'one' && m.note.id).toBe('dce6')
    expect(notesLinkFor(m, '2026-07-09')).toEqual({ href: '/dashboard/meetings?note=dce6#note-dce6', count: 1 })
    const other = matchNotesForEvent({ ...win, title: 'Sales strategy: client outreach' }, notes)
    expect(other?.kind === 'one' && other.note.id).toBe('b8e1')
  })
  it('date prefixes and filler words are not a title match', () => {
    expect([...titleWords('07-09 Meeting: Client Outreach')]).toEqual(['client', 'outreach'])
    expect(matchNotesForEvent({ ...win, title: '07-09 Meeting' }, notes)?.kind).toBe('many')
  })
  it('then attendee overlap breaks a title tie', () => {
    const a = { ...outreach, attendees: ['jeff@example.com'] }
    const b = { ...alex, attendees: [{ email: 'alex@example.com', name: 'Alex Miller' }] }
    const m = matchNotesForEvent({ ...win, title: 'Team block', attendees: ['alex@example.com'] }, [a, b])
    expect(m).toMatchObject({ kind: 'one', by: 'attendees' })
    expect(m?.kind === 'one' && m.note.id).toBe('dce6')
  })
  it('a true tie lists both notes instead of guessing', () => {
    const m = matchNotesForEvent({ ...win, title: 'Thursday block' }, notes)
    expect(m?.kind).toBe('many')
    expect(m?.kind === 'many' && m.notes.map((n) => n.id)).toEqual(['b8e1', 'dce6'])
    expect(notesLinkFor(m, '2026-07-09')).toEqual({
      href: '/dashboard/meetings?day=2026-07-09&notes=b8e1,dce6#mtg-past',
      count: 2,
    })
    expect(isConfidentMatch(m)).toBe(false)
  })
  it('only confident single matches get the event id filed on the note', () => {
    expect(isConfidentMatch(matchNotesForEvent({ ...win, title: 'Alex Miller onboarding call' }, notes))).toBe(true)
    expect(isConfidentMatch(matchNotesForEvent({ ...win, title: 'x' }, [alex]))).toBe(true)
    // Same-day title guess (outside the time window) is not confident enough.
    expect(isConfidentMatch(matchNotesForEvent({ startIso: '2026-07-09T19:00:00Z', endIso: '2026-07-09T19:30:00Z', title: 'Gandy and Jeff Rau Meeting' }, [{ id: 'g', title: 'Gandy and Jeff Rau Meeting', occurred_at: '2026-07-09T16:00:00Z', calendar_event_id: null }]))).toBe(false)
  })
})
