import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/anthropic', () => ({ getAnthropic: () => ({}), hasAnthropicKey: () => false }))
vi.mock('@/lib/boards', () => ({ STARTER_BOARD: 'starter', cardsAssignedTo: async () => [], ensureStarterBoard: async () => true }))

import { placePopover } from '@/app/dashboard/calendar/placePopover'
import { matchOwner, noteItems, ownerSourceKey, type TeamMember } from '@/lib/meetings/sendToOwners'
import { asDue, asItems } from '@/lib/meetingLoop'

const VP = { width: 1280, height: 800 }
const SIZE = { width: 340, height: 420 }

describe('calendar event popover placement', () => {
  it('opens to the right of the event when it fits', () => {
    const p = placePopover({ left: 200, right: 300, top: 120 }, SIZE, VP)
    expect(p.left).toBe(308)
    expect(p.top).toBe(120)
  })

  it('flips to the left of an event near the right edge', () => {
    const p = placePopover({ left: 1100, right: 1260, top: 120 }, SIZE, VP)
    expect(p.left).toBe(1100 - 8 - 340)
    expect(p.left + SIZE.width).toBeLessThanOrEqual(VP.width - 16)
  })

  it('never crosses the right or left edge when neither side fits', () => {
    const p = placePopover({ left: 20, right: 1260, top: 120 }, SIZE, VP)
    expect(p.left).toBeGreaterThanOrEqual(16)
    expect(p.left + SIZE.width).toBeLessThanOrEqual(VP.width - 16)
  })

  it('keeps a tall popover inside the bottom edge', () => {
    const p = placePopover({ left: 200, right: 300, top: 700 }, { width: 340, height: 520 }, VP)
    expect(p.top + 520).toBeLessThanOrEqual(VP.height - 16)
  })

  it('stays inside a narrow viewport', () => {
    const p = placePopover({ left: 300, right: 360, top: 50 }, { width: 340, height: 300 }, { width: 380, height: 700 })
    expect(p.left).toBeGreaterThanOrEqual(16)
  })
})

const TEAM: TeamMember[] = [
  { id: 'm1', display_name: 'Mike Spencer', email: 'mike@pinnacle.test' },
  { id: 'm2', display_name: 'Dana Ruiz', email: 'dana.ruiz@pinnacle.test' },
  { id: 'm3', display_name: 'Dana Cole', email: 'dcole@pinnacle.test' },
  { id: 'm4', display_name: 'Priya Shah', email: 'priya@pinnacle.test' },
]

describe('matchOwner: spoken owner name -> one team member', () => {
  it('matches a full name', () => {
    expect(matchOwner('Mike Spencer', TEAM)).toEqual({ kind: 'member', member: TEAM[0] })
  })
  it('matches a unique first name', () => {
    expect(matchOwner('priya', TEAM)).toEqual({ kind: 'member', member: TEAM[3] })
  })
  it('matches first name + last initial', () => {
    expect(matchOwner('Dana C', TEAM)).toEqual({ kind: 'member', member: TEAM[2] })
  })
  it('refuses to guess between two people with the same first name', () => {
    expect(matchOwner('Dana', TEAM)).toEqual({ kind: 'none', reason: 'ambiguous' })
  })
  it('says when the owner is not on the team', () => {
    expect(matchOwner('Carlos', TEAM)).toEqual({ kind: 'none', reason: 'not-on-team' })
  })
  it('says when nobody was named', () => {
    expect(matchOwner(null, TEAM)).toEqual({ kind: 'none', reason: 'no-owner' })
  })
  it('falls back to the email local part', () => {
    expect(matchOwner('dcole', TEAM)).toEqual({ kind: 'member', member: TEAM[2] })
  })
})

describe('meeting action items keep owner and due date', () => {
  it('cleans the model output', () => {
    expect(
      asItems([
        { text: 'Send the carrier deck to Priya', owner: 'Mike', due: '2026-10-14' },
        { text: 'Book the Q4 offsite', owner: 'null', due: 'Friday' },
        { text: 'x', owner: 'Dana' },
      ]),
    ).toEqual([
      { text: 'Send the carrier deck to Priya', owner: 'Mike', due: '2026-10-14' },
      { text: 'Book the Q4 offsite', owner: null, due: null },
    ])
  })
  it('rejects impossible due dates', () => {
    expect(asDue('2026-02-30')).toBeNull()
    expect(asDue('2026-10-14')).toBe('2026-10-14')
  })
  it("falls back to the note-taker's own list with no owner", () => {
    expect(noteItems(null, ['Call the carrier', { text: 'Draft the memo' }])).toEqual([
      { text: 'Call the carrier', owner: null, due: null },
      { text: 'Draft the memo', owner: null, due: null },
    ])
  })
  it('gives one stable key per meeting + item, so a resend never duplicates', () => {
    const a = ownerSourceKey('n1', 'Send the deck')
    expect(ownerSourceKey('n1', '  send the DECK ')).toBe(a)
    expect(ownerSourceKey('n2', 'Send the deck')).not.toBe(a)
    expect(a.startsWith('note:n1:owner:')).toBe(true)
  })
})

describe('meeting to-do follow-up (in-app only)', async () => {
  const { followState, dueTag, trackLabel, trackSummary, overdueBriefLine, todayIn } = await import('@/lib/meetings/followUp')
  const today = '2026-10-10'

  it('reads done / overdue / due / open from the to-do itself', () => {
    expect(followState({ done_at: '2026-10-09T10:00:00Z', due_date: '2026-10-01' }, today)).toBe('done')
    expect(followState({ done_at: null, due_date: '2026-10-09' }, today)).toBe('overdue')
    expect(followState({ done_at: null, due_date: today }, today)).toBe('due')
    expect(followState({ done_at: null, due_date: null }, today)).toBe('open')
  })

  it('tags rows Overdue / Due today, never done or future ones', () => {
    expect(dueTag('2026-10-08', false, today)).toBe('Overdue')
    expect(dueTag(today, false, today)).toBe('Due today')
    expect(dueTag(today, true, today)).toBeNull()
    expect(dueTag('2026-10-12', false, today)).toBeNull()
  })

  it('labels each sent item and sums up the meeting', () => {
    expect(trackLabel('overdue', 'Mike')).toBe("Overdue · on Mike's Today")
    expect(trackLabel('open', 'Mike')).toBe("On Mike's Today")
    expect(trackLabel('done', 'Mike')).toBe('Done')
    expect(trackSummary(['done', 'overdue', 'open'])).toBe('Mira is tracking 3: 1 done, 1 overdue, 1 open.')
    expect(trackSummary([])).toBeNull()
  })

  it('brief names overdue to-dos, oldest first, and stays quiet when none', () => {
    const line = overdueBriefLine([
      { body: 'Send the carrier deck', done_at: null, due_date: '2026-10-08', meeting_title: 'Board prep' },
      { body: 'Call Dana', done_at: null, due_date: '2026-10-05' },
      { body: 'Done already', done_at: '2026-10-09T00:00:00Z', due_date: '2026-10-01' },
      { body: 'Later', done_at: null, due_date: '2026-10-20' },
    ], today)
    expect(line).toBe('2 to-dos are overdue: "Call Dana", "Send the carrier deck" (from Board prep).')
    expect(overdueBriefLine([{ body: 'x', done_at: null, due_date: '2026-10-20' }], today)).toBeNull()
  })

  it('today is the member’s local date', () => {
    expect(todayIn('America/Los_Angeles', new Date('2026-10-10T05:00:00Z'))).toBe('2026-10-09')
    expect(todayIn('America/New_York', new Date('2026-10-10T05:00:00Z'))).toBe('2026-10-10')
  })
})
