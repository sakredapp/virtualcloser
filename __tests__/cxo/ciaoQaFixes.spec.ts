/**
 * Ciao QA 2026-10-18 fixes on the real Pinnacle book: one drifting rule,
 * policies wording, slipping agents named, board wins, calendar checks for
 * replies and repeating events, emails awaiting reply, fresh chats and one
 * time label per meeting.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in tests') } } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))

import { policiesWording } from '@/lib/agent/policiesWording'
import { agentsLine } from '@/lib/agent/cxoSlippingTool'
import { composeSections, producerMovers, type BoardFacts } from '@/lib/boardUpdate/shared'
import { DRIFTING_DEFINITION, retentionSummary, toRetentionRaw } from '@/lib/book/retention'
import { firstOccurrences, meetingTimeInText } from '@/lib/cxoMeetingTime'
import { timeRangeLabel } from '@/lib/cxoFreeTime'
import { pickAwaitingReply } from '@/lib/agent/cxoTools'
import { CIAO_IDLE_MS, historyFilter, pickConversation } from '@/lib/agent/chatSessions'
import { appendAnswerNow } from '@/lib/agent/runAgent'
import { PARALLEL_READ_TOOLS } from '@/lib/agent/readBatch'

const NY = 'America/New_York'

describe('policies wording (matches the Revenue card)', () => {
  it('renames count keys and words, never names', () => {
    const out = policiesWording({ applications: 12, note: 'Applications fell; 3 apps pending', name: 'Applications Unlimited LLC', rows: [{ carrier: 'App Life', applications_change_pct: -4 }] })
    expect(out).toEqual({ policies: 12, note: 'Policies fell; 3 policies pending', name: 'Applications Unlimited LLC', rows: [{ carrier: 'App Life', policies_change_pct: -4 }] })
  })
  it('keeps both fields when a row already has policies', () => {
    expect(policiesWording({ applications: 5, policies: 4 })).toEqual({ policies_written: 5, policies: 4 })
  })
})

describe('what is slipping names agents', () => {
  it('names the biggest dollar drops first, with agency, and the exact total', () => {
    const row = (name: string, agency: string | null, prior: number, now: number, pct: number | null) => ({ name, agency, ap_drop: prior - now, prior_submitted_ap: prior, now_submitted_ap: now, ap_change_pct: pct, prior_applications: 5, now_applications: 2 })
    const line = agentsLine({ rule: 'R.', total: 9, went_quiet: 2, top: [
      row('B Two', null, 20_000, 9_000, -55),
      row('A One', 'North', 50_000, 19_000, -62),
      row('D Four', 'East', 10_000, 6_000, -40),
      row('C Three', 'South', 30_000, 12_000, -60),
    ] } as never)
    expect(line).toBe('Biggest drops: A One (North) down $31,000 (-62%), $50,000 to $19,000; C Three (South) down $18,000 (-60%), $30,000 to $12,000; B Two down $11,000 (-55%), $20,000 to $9,000. In all, 9 agents meet the slipping rule; 2 of them wrote nothing in these days. The rule: R.')
  })
  it('says so when no agent is down', () => {
    expect(agentsLine({ top: [], total: 0, went_quiet: 0, rule: '' } as never)).toMatch(/No individual agent/)
  })
})

describe('board update wins are computed like misses', () => {
  const win = { start: '2026-10-01', end: '2026-10-17' }
  it('first-time writers and top gainers', () => {
    const m = producerMovers(
      [
        { name: 'New A', team: 'T1', premium: 9000, policies: 3, firstPolicy: '2026-10-05' },
        { name: 'Old B', team: 'T1', premium: 20000, policies: 8, firstPolicy: '2025-01-02' },
        { name: 'Old C', team: null, premium: 5000, policies: 2, firstPolicy: '2024-03-01' },
      ],
      [
        { name: 'Old B', team: 'T1', premium: 12000, policies: 5, firstPolicy: '2025-01-02' },
        { name: 'Old C', team: null, premium: 7000, policies: 3, firstPolicy: '2024-03-01' },
      ],
      win,
    )
    expect(m.newWriters).toBe(1)
    expect(m.newWriterNames).toEqual(['New A'])
    expect(m.top.map((x) => x.name)).toEqual(['New A', 'Old B'])
  })
  it('a flat month still has wins from movers', () => {
    const facts: BoardFacts = {
      month: '2026-10', company: 'Acme', book: null, plan: null, qbo: null, goalsDone: [], goalsMissed: [], kpis: { hit: 0, missed: 0 },
      cardsDone: { count: 0, titles: [] }, cardsMissed: { count: 0, titles: [] }, decisions: [],
      trends: {
        production: { now: { premium: 100_000, policies: 100 }, prior: { premium: 101_000, policies: 101 }, priorLabel: 'Sep 1-17' },
        retention: null,
        placement: null,
        movers: { label: 'October to date', priorLabel: 'Sep 1-17', newWriters: 4, newWriterNames: ['New A'], reactivated: 2, reactivatedLabel: 'Q4 to date', top: [{ name: 'Old B', team: 'T1', now: 20000, prior: 12000 }] },
      },
    } as BoardFacts
    const s = composeSections(facts)
    expect(s.wins.length).toBe(3)
    expect(s.wins[0]).toContain('4 new agents wrote a first policy in October to date, including New A')
    expect(s.wins[1]).toContain('2 agents came back to writing')
    expect(s.wins[2]).toContain('Old B (T1) up $8,000 to $20,000')
  })
})

describe('one drifting definition', () => {
  it('retention reports the total, the as-of day and the shared definition', () => {
    const s = retentionSummary(toRetentionRaw({ inactive_after_days: 90, drifting: { as_of: '2026-10-18', days_30_59: 330, days_60_89: 168, top: [] } }))
    expect(s.drifting_agents).toBe(498)
    expect(s.drifting_as_of).toBe('2026-10-18')
    expect(s.drifting_definition).toBe(DRIFTING_DEFINITION)
    expect(DRIFTING_DEFINITION).toMatch(/30 to 89 days/)
  })
})

describe('repeating events: first dates', () => {
  it('weekly on Monday keeps 9am across the DST change', () => {
    const occ = firstOccurrences({ freq: 'WEEKLY', interval: 1, byDay: ['MO'], count: null, until: null } as never, '2026-10-26T13:00:00Z', '2026-10-26T13:30:00Z', NY)
    expect(occ.map((o) => o.startIso)).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z', '2026-11-16T14:00:00.000Z'])
    expect(occ[1].endIso).toBe('2026-11-02T14:30:00.000Z')
  })
  it('every other week on Tue and Thu, capped by COUNT', () => {
    const occ = firstOccurrences({ freq: 'WEEKLY', interval: 2, byDay: ['TU', 'TH'], count: 3, until: null } as never, '2026-10-20T14:00:00Z', '2026-10-20T15:00:00Z', NY)
    expect(occ.map((o) => o.startIso.slice(0, 10))).toEqual(['2026-10-20', '2026-10-22', '2026-11-03'])
  })
  it('daily stops at UNTIL; monthly skips months without the day', () => {
    const d = firstOccurrences({ freq: 'DAILY', interval: 1, byDay: [], count: null, until: '20261021' } as never, '2026-10-19T13:00:00Z', '2026-10-19T13:15:00Z', NY)
    expect(d).toHaveLength(3)
    const m = firstOccurrences({ freq: 'MONTHLY', interval: 1, byDay: [], count: null, until: null } as never, '2027-01-31T15:00:00Z', '2027-01-31T16:00:00Z', NY, 3)
    expect(m.map((o) => o.startIso.slice(0, 10))).toEqual(['2027-01-31', '2027-03-31', '2027-05-31'])
  })
})

describe('meeting time a reply accepts', () => {
  const today = '2026-10-18' // a Sunday
  it('weekday plus time', () => {
    expect(meetingTimeInText('Tuesday at 2pm works for me.', today, NY)).toEqual({ startIso: '2026-10-20T18:00:00.000Z', matched: 'Tuesday 2pm' })
  })
  it('month-day, numeric date, noon, 24h', () => {
    expect(meetingTimeInText('Oct 22 at 10:30 am sounds good', today, NY)?.startIso).toBe('2026-10-22T14:30:00.000Z')
    expect(meetingTimeInText('Confirmed for 10/23 at noon.', today, NY)?.startIso).toBe('2026-10-23T16:00:00.000Z')
    expect(meetingTimeInText('See you tomorrow 14:00', today, NY)?.startIso).toBe('2026-10-19T18:00:00.000Z')
  })
  it('a declined time is not a meeting', () => {
    expect(meetingTimeInText("I can't do Tuesday at 2pm.", today, NY)).toBeNull()
    expect(meetingTimeInText('Thanks for the deck, Tuesday at 2pm is the board call.', today, NY)).toBeNull()
  })
  it('a past month-day rolls to next year', () => {
    expect(meetingTimeInText('Jan 5 at 9am works', today, NY)?.startIso.slice(0, 10)).toBe('2027-01-05')
  })
})

describe('emails awaiting your reply', () => {
  it('keeps people who wrote last; drops mine, automated and broken', () => {
    const out = pickAwaitingReply([
      { id: 't1', meta: { subject: 'Q3', fromName: 'Dana', fromAddress: 'dana@acme.com', lastMessageAt: '2026-10-17', snippet: 'Can you send…' } },
      { id: 't2', meta: { subject: 'Re: Q3', fromAddress: 'dana@acme.com', lastMessageAt: '2026-10-17', lastFromMe: true } },
      { id: 't3', meta: { subject: 'Alert', fromAddress: 'no-reply@bank.com', lastMessageAt: '2026-10-17' } },
      { id: 't4', meta: { subject: 'Self', fromAddress: 'Me@Co.com', lastMessageAt: '2026-10-17' } },
      { id: 't5' },
    ], 'me@co.com')
    expect(out).toEqual([{ thread_id: 't1', subject: 'Q3', from: 'Dana', last_at: '2026-10-17', snippet: 'Can you send…' }])
  })
})

describe('new chat carries nothing over', () => {
  it('asked-for fresh always starts a new conversation', () => {
    expect(pickConversation({ last_at: new Date().toISOString() }, Date.now(), true)).toBe('new')
    expect(pickConversation({ last_at: new Date(Date.now() - CIAO_IDLE_MS - 1).toISOString() }, Date.now())).toBe('new')
    expect(pickConversation({ last_at: new Date().toISOString() }, Date.now())).toBe('reuse')
  })
  it('history reads only that conversation (untagged turns only after it began)', () => {
    expect(historyFilter({ id: 'c1', started_at: '2026-10-18T19:00:00Z' })).toBe('conversation_id.eq.c1,and(conversation_id.is.null,created_at.gte.2026-10-18T19:00:00Z)')
  })
})

describe('one time label per meeting', () => {
  it('always has minutes; one AM/PM when both ends share it', () => {
    expect(timeRangeLabel(Date.parse('2026-10-19T17:00:00Z'), Date.parse('2026-10-19T18:45:00Z'), NY)).toBe('1:00 – 2:45 PM')
    expect(timeRangeLabel(Date.parse('2026-10-19T17:00:00Z'), Date.parse('2026-10-19T17:45:00Z'), NY)).toBe('1:00 – 1:45 PM')
    expect(timeRangeLabel(Date.parse('2026-10-19T15:30:00Z'), Date.parse('2026-10-19T17:00:00Z'), NY)).toBe('11:30 AM – 1:00 PM')
  })
})

describe('speed: answer-now turn and parallel reads', () => {
  it('adds the answer-now note once to the last user turn', () => {
    const msgs = [{ role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'x', content: '{}' }] }]
    appendAnswerNow(msgs as never)
    appendAnswerNow(msgs as never)
    expect((msgs[0].content as Array<{ type: string }>).filter((b) => b.type === 'text')).toHaveLength(1)
  })
  it('book reads run in parallel', () => {
    for (const t of ['producer_production', 'whats_slipping', 'list_calendar_events', 'list_followups', 'find_free_time']) {
      expect(PARALLEL_READ_TOOLS.has(t), t).toBe(true)
    }
  })
})
