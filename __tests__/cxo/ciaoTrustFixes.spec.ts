/**
 * Ciao QA 2026-10-18 (second pass, real Pinnacle account): a new chat that
 * invented an earlier conversation, "Mira" in to-do sources, precise slipping
 * counts, computed leader comparisons, invite clash checks, clash labels by
 * meeting title, and board wins that name their period.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in tests') } } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))

import { claimsPastConversation, conversationStateLine, NEW_CHAT_FALLBACK } from '@/lib/agent/conversationState'
import { framedMemoryBlock, MEMORY_FRAME } from '@/lib/agent/runAgent'
import { CXO_HONESTY_RULES } from '@/lib/agent/cxoPrompt'
import { displaySourceKey, todoSourceLabel } from '@/lib/todoSource'
import { leaderComparison } from '@/lib/book/production'
import { busyLabel, isOwnAccount } from '@/lib/cxoCalendar'
import { unionBusy } from '@/lib/calendarBusy'
import { checkParsedInvite, inviteClashes, inviteForEmail, inviteFromSubject } from '@/lib/agent/inviteClashes'
import { ATTENTION_NOTE, ATTENTION_NOTE_WITH_ITEMS, shapeAttention } from '@/lib/agent/businessAttention'
import { composeSections, type BoardFacts } from '@/lib/boardUpdate/shared'
import { labelEarlierQuarter, quarterSpan } from '@/lib/boardUpdate/data'
import type { TodayMeeting } from '@/lib/today'

const NY = 'America/New_York'

describe('1. a new chat never claims an earlier conversation', () => {
  it('the state line says plainly there are no earlier turns', () => {
    const line = conversationStateLine(0)
    expect(line).toContain('brand-new chat with no earlier turns')
    expect(line).toContain('never things you discussed')
    expect(conversationStateLine(4)).toContain('exactly the 4 messages above. Nothing else was said')
    expect(conversationStateLine(1)).toContain('exactly the 1 message above')
  })
  it('spots a reply that describes a past talk', () => {
    for (const t of [
      'Earlier today we discussed the Q4 recruiting pipeline for the Southeast region.',
      'We just talked about your Q4 recruiting pipeline.',
      "We've covered the board update.",
      'In our earlier conversation you wanted the Southeast numbers.',
      'As we discussed, the pipeline is behind.',
      'You asked me earlier about hiring.',
    ]) expect(claimsPastConversation(t), t).toBe(true)
  })
  it('does not flag negations or the fallback', () => {
    for (const t of [
      NEW_CHAT_FALLBACK,
      "We haven't talked about anything yet; this chat just started.",
      'Nothing so far. What can I help with?',
      'Premium is up 12% on last month.',
    ]) expect(claimsPastConversation(t), t).toBe(false)
  })
  it('saved memory is framed as facts, never as a past conversation', () => {
    expect(framedMemoryBlock('')).toBe('')
    const b = framedMemoryBlock('\n- prefers short answers')
    expect(b.startsWith(MEMORY_FRAME)).toBe(true)
    expect(MEMORY_FRAME).toContain('THINGS YOU KNOW ABOUT THEM')
    expect(MEMORY_FRAME).toContain('never describe them as something you talked about')
  })
  it('the honesty rules forbid invented conversations and uncomputed ratios', () => {
    expect(CXO_HONESTY_RULES.join(' ')).toMatch(/earlier conversation/i)
    expect(CXO_HONESTY_RULES.join(' ')).toMatch(/ratio/i)
  })
})

describe('2. to-do sources show the assistant name, never Mira', () => {
  it('maps the internal mira key at render time', () => {
    expect(todoSourceLabel({ source: 'mira' })).toBe('Ciao')
    expect(todoSourceLabel({ source: 'mira' }, 'Ava')).toBe('Ava')
    expect(todoSourceLabel({ source: 'Mira' }, 'Ava')).toBe('Ava')
    expect(todoSourceLabel({ source: 'meeting', meeting_title: 'Ops sync' })).toBe('meeting: Ops sync')
    expect(todoSourceLabel({ source: 'manual' })).toBe('you')
    expect(todoSourceLabel({ source: null })).toBe('you')
    expect(displaySourceKey('mira', 'Ciao')).toBe('Ciao')
    expect(displaySourceKey('email', 'Ciao')).toBe('email')
  })
})

describe('4. leader comparisons are computed, not guessed', () => {
  it('12x the #2 and below the rest combined', () => {
    const rows = [
      { name: 'Big Agency', value: 1_200_000 },
      { name: 'Second', value: 100_000 },
      { name: 'Third', value: 90_000 },
    ]
    const c = leaderComparison(rows, 3_000_000)!
    expect(c.leader).toBe('Big Agency')
    expect(c.multiple_of_next).toBe(12)
    expect(c.share_of_total_pct).toBe(40)
    expect(c.rest_combined).toBe(1_800_000)
    expect(c.vs_rest_combined).toBe('less than')
    expect(c.line).toContain('12x the #2 (Second')
    expect(c.line).toContain('less than everyone else combined')
  })
  it('null when nothing has a value', () => {
    expect(leaderComparison([{ name: 'A', value: 0 }], 0)).toBeNull()
  })
})

describe('5. follow-ups: invites checked against the calendar, drifting always given', () => {
  const m = (id: string, title: string, start: string, end: string, extra: Partial<TodayMeeting> = {}): TodayMeeting => ({ id, title, start, end, allDay: false, link: null, htmlLink: null, attendees: [], ...extra })
  it('flags a clash with the meeting title and passes a free invite', () => {
    const meetings = [
      m('a', 'Carrier call', '2026-10-19T18:00:00Z', '2026-10-19T19:00:00Z', { awaitingReply: true, organizer: 'x@y.com' }),
      m('b', 'Pipeline review', '2026-10-19T18:30:00Z', '2026-10-19T19:30:00Z'),
      m('c', 'Lunch invite', '2026-10-20T16:00:00Z', '2026-10-20T16:30:00Z', { awaitingReply: true }),
    ]
    const out = inviteClashes(meetings, NY, Date.parse('2026-10-18T12:00:00Z'))
    expect(out).toHaveLength(2)
    expect(out[0].clashes_with).toContain('"Pipeline review"')
    expect(out[1].clashes_with).toBeNull()
    expect(inviteForEmail('Invitation: Carrier call @ Mon Oct 19, 2026 2pm - 3pm (EDT)', out)?.event_id).toBe('a')
    expect(inviteForEmail('Re: Carrier call', out)).toBeNull()
  })
  it('parses an invitation subject and checks it against busy blocks', () => {
    const inv = inviteFromSubject('Invitation: Q4 review @ Mon Oct 19, 2026 2pm - 3pm (EDT) (me@x.com)', 'UTC')!
    expect(inv).toEqual({ title: 'Q4 review', startIso: '2026-10-19T18:00:00.000Z', endIso: '2026-10-19T19:00:00.000Z' })
    const busy = [
      { startIso: '2026-10-19T18:00:00Z', endIso: '2026-10-19T19:00:00Z', title: 'Q4 review' },
      { startIso: '2026-10-19T18:30:00Z', endIso: '2026-10-19T19:30:00Z', title: 'Hiring sync' },
    ]
    expect(checkParsedInvite(inv, busy, NY).clashes_with).toContain('"Hiring sync"')
    expect(checkParsedInvite(inv, busy.slice(0, 1), NY).clashes_with).toBeNull()
    expect(checkParsedInvite(inv, [{ startIso: '2026-10-19T18:30:00Z', endIso: '2026-10-19T19:30:00Z' }], NY).clashes_with).toContain('something marked busy')
    expect(inviteFromSubject('Re: lunch', NY)).toBeNull()
  })
  it('business items come with their own note when there are own follow-ups', () => {
    const d = { days_30_59: 330, days_60_89: 168, top: [] }
    expect(shapeAttention({ drifting: d, wentQuiet: null, slipping: [], ownListEmpty: false })!.note).toBe(ATTENTION_NOTE_WITH_ITEMS)
    const empty = shapeAttention({ drifting: d, wentQuiet: null, slipping: [] })!
    expect(empty.note).toBe(ATTENTION_NOTE)
    expect(empty.drifting_agents?.count).toBe(498)
    expect(ATTENTION_NOTE_WITH_ITEMS).toContain('drifting-agent count')
  })
})

describe('6. clash warnings name the meeting, not the calendar email', () => {
  it('busyLabel uses the title, else a neutral word', () => {
    expect(busyLabel({ title: 'Board prep' })).toBe('"Board prep"')
    expect(busyLabel({})).toBe('something marked busy')
  })
  it('unionBusy keeps a title from a duplicate span', () => {
    const out = unionBusy(
      [{ startIso: '2026-10-19T18:00:00Z', endIso: '2026-10-19T19:00:00Z', calendar: 'me@x.com' } as { startIso: string; endIso: string; title?: string; calendar: string }],
      [{ startIso: '2026-10-19T18:00:00Z', endIso: '2026-10-19T19:00:00Z', calendar: 'me@x.com', title: 'Board prep' }],
    )
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Board prep')
  })
  it('titles only for the caller own calendars', () => {
    const who = { email: 'me@x.com', role: 'admin' }
    expect(isOwnAccount({ memberId: 'm1', isShared: false, email: 'me@x.com' }, 'm1', who)).toBe(true)
    expect(isOwnAccount({ memberId: 'm2', isShared: false, email: 'co@x.com' }, 'm1', who)).toBe(false)
    expect(isOwnAccount({ memberId: null, isShared: true, email: 'me@x.com' }, 'm1', who)).toBe(true)
    expect(isOwnAccount({ memberId: null, isShared: true, email: 'boss@x.com' }, 'm1', who)).toBe(false)
    expect(isOwnAccount({ memberId: null, isShared: true, email: 'boss@x.com' }, 'm1', { email: 'me@x.com', role: 'owner' })).toBe(true)
    expect(isOwnAccount({ memberId: 'm1', isShared: false, email: 'me@x.com' }, null, who)).toBe(false)
  })
})

describe('7. board wins name their period', () => {
  it('a last-full-quarter span inside an October update says so with dates', () => {
    const q = labelEarlierQuarter(quarterSpan('2026-09', '2026-09-30'))
    expect(q.label).toBe('Q3 2026 (Jul 1 to Sep 30, the last full quarter)')
    expect(q.prior.label).toBe('Q2 2026 (Apr 1 to Jun 30)')
  })
  it('retention, reactivation and production wins lead with or carry their period', () => {
    const facts = {
      month: '2026-10', company: 'Acme', book: null, plan: null, qbo: null, goalsDone: [], goalsMissed: [], kpis: { hit: 0, missed: 0 },
      cardsDone: { count: 0, titles: [] }, cardsMissed: { count: 0, titles: [] }, decisions: [],
      trends: {
        production: { now: { premium: 130_000, policies: 130 }, prior: { premium: 100_000, policies: 100 }, priorLabel: 'Sep 1 to 18', label: 'Oct 1 to 18' },
        retention: { label: 'Q3 2026 (Jul 1 to Sep 30, the last full quarter)', priorLabel: 'Q2 2026 (Apr 1 to Jun 30)', nowPct: 70, priorPct: 64, stopped: 0, driftingAgents: 0 },
        placement: null,
        movers: { label: 'Oct 1 to 18', priorLabel: 'Sep 1 to 18', newWriters: 0, newWriterNames: [], reactivated: 3, reactivatedLabel: 'Q3 2026 (Jul 1 to Sep 30, the last full quarter)', top: [] },
      },
    } as BoardFacts
    const s = composeSections(facts)
    expect(s.wins).toContain('Premium written in Oct 1 to 18 rose 30% vs Sep 1 to 18: $130,000 against $100,000.')
    expect(s.wins.some((w) => w.startsWith('In Q3 2026 (Jul 1 to Sep 30, the last full quarter), agent retention rose 6 points'))).toBe(true)
    expect(s.wins.some((w) => w.startsWith('In Q3 2026 (Jul 1 to Sep 30, the last full quarter), 3 agents came back to writing'))).toBe(true)
  })
})
