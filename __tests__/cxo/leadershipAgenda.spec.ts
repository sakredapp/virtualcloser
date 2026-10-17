import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INVITE_END,
  INVITE_START,
  agendaInvitePrompt,
  agendaNoticeKey,
  agendaNoticeText,
  asksForMeeting,
  cleanBody,
  cleanSections,
  composeAgenda,
  isDraftTime,
  matchesAsk,
  mergeIntoDescription,
  overdueByOwner,
  owedFromDigest,
  pickLeadershipSeries,
  startLabel,
  titleLooksLeadership,
  type SeriesEvent,
} from '@/lib/meetings/agendaShared'
import { ALWAYS_SHOWN_PREFIXES, actionsFor } from '@/lib/followups/noticeActionsShared'
import { agendaOn, chooseSeries } from '@/lib/meetings/agenda'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { CXO_AGENDA_TOOL_DEFS, CXO_AGENDA_TOOL_HANDLERS } from '@/lib/agent/cxoAgendaTool'

const NY = 'America/New_York'
const NOW = new Date('2026-10-17T14:00:00Z') // Sat 10am NY
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const ev = (over: Partial<SeriesEvent>): SeriesEvent => ({
  id: 'e1_20261019T130000Z',
  title: 'Weekly leadership',
  start: '2026-10-19T13:00:00Z',
  end: '2026-10-19T14:00:00Z',
  allDay: false,
  attendees: [{ email: 'ceo@co.com' }, { email: 'cfo@co.com' }, { email: 'coo@co.com' }],
  seriesId: 'e1',
  organizer: 'ceo@co.com',
  ...over,
})
const LEADERS = ['ceo@co.com', 'cfo@co.com', 'coo@co.com']

describe('finding the leadership meeting', () => {
  it('reads leadership-style titles, not 1:1s', () => {
    for (const t of ['Weekly Leadership', 'Exec sync', 'L10', 'Staff meeting', 'Management review', 'SLT']) expect(titleLooksLeadership(t)).toBe(true)
    expect(titleLooksLeadership('Leadership 1:1 with Sam')).toBe(false)
    expect(titleLooksLeadership('Lunch')).toBe(false)
  })
  it('picks a recurring series by title, soonest instance only', () => {
    const picks = pickLeadershipSeries({
      events: [ev({}), ev({ id: 'e1_b', start: '2026-10-26T13:00:00Z' }), ev({ id: 'x', seriesId: null, title: 'Exec offsite' })],
      leaderEmails: LEADERS,
      marks: [],
      now: NOW,
    })
    expect(picks.map((p) => p.eventId)).toEqual(['e1_20261019T130000Z'])
  })
  it('falls back to the series with three or more leaders on it', () => {
    const picks = pickLeadershipSeries({ events: [ev({ title: 'Monday sync' })], leaderEmails: LEADERS, marks: [], now: NOW })
    expect(picks).toHaveLength(1)
    expect(pickLeadershipSeries({ events: [ev({ title: 'Monday sync' })], leaderEmails: ['ceo@co.com'], marks: [], now: NOW })).toEqual([])
  })
  it('an exec mark wins, and "not" removes a series', () => {
    const events = [ev({}), ev({ id: 'k_1', seriesId: 'k', title: 'Kickoff', attendees: [{ email: 'ceo@co.com' }, { email: 'a@co.com' }] })]
    expect(pickLeadershipSeries({ events, leaderEmails: LEADERS, marks: [{ series_id: 'k', choice: 'leadership' }], now: NOW }).map((c) => c.seriesId)).toEqual(['k'])
    expect(pickLeadershipSeries({ events, leaderEmails: LEADERS, marks: [{ series_id: 'e1', choice: 'not' }], now: NOW })).toEqual([])
  })
  it('matches an ask by weekday or title words', () => {
    const [c] = pickLeadershipSeries({ events: [ev({})], leaderEmails: LEADERS, marks: [], now: NOW })
    expect(matchesAsk(c, "Monday's leadership meeting", NY)).toBe(true)
    expect(matchesAsk(c, 'tuesday', NY)).toBe(false)
    expect(matchesAsk(c, '', NY)).toBe(true)
    expect(chooseSeries({ picks: [c], all: [c] }, 'the board call', NY)).toBeNull()
    expect(chooseSeries({ picks: [c], all: [c] }, undefined, NY)?.seriesId).toBe('e1')
  })
})

describe('when to draft', () => {
  it('about 24h before, from 7am local', () => {
    const start = '2026-10-19T13:00:00Z' // Mon 9am NY
    expect(isDraftTime(start, new Date('2026-10-18T12:00:00Z'), NY)).toBe(false) // 25h before
    expect(isDraftTime(start, new Date('2026-10-18T13:30:00Z'), NY)).toBe(true) // Sun 9:30am
    expect(isDraftTime(start, new Date('2026-10-19T14:00:00Z'), NY)).toBe(false) // started
  })
  it('booked late: not before 7am unless it starts within two hours', () => {
    const start = '2026-10-19T13:00:00Z'
    expect(isDraftTime(start, new Date('2026-10-19T09:00:00Z'), NY)).toBe(false) // 5am NY
    expect(isDraftTime(start, new Date('2026-10-19T11:30:00Z'), NY)).toBe(true) // 7:30am NY
    expect(startLabel(start, NY)).toBe('Mon, Oct 19, 9:00am')
  })
})

describe('what goes on it', () => {
  it('decisions still owed come from the last digest, minus what was decided', () => {
    const owed = owedFromDigest({
      items: [{ text: 'Decide on the Q4 hiring plan', owner: 'Dana' }, { text: 'Send deck' }, { text: 'Approve the pricing pilot' }],
      decisions: ['Approve the pricing pilot'],
      notes: ['Do we open Denver?', 'Good energy'],
    })
    expect(owed).toEqual(['Decide on the Q4 hiring plan (Dana)', 'Do we open Denver?'])
    expect(owedFromDigest(null)).toEqual([])
  })
  it('overdue commitments group by owner, oldest first, capped', () => {
    const out = overdueByOwner(
      [
        { owner: 'Sam', body: 'Ship forecast', due_date: '2026-10-14' },
        { owner: 'Dana', body: 'Call bank', due_date: '2026-10-10', meeting_title: 'Leadership' },
        { owner: 'Sam', body: 'Not late', due_date: '2026-10-20' },
      ],
      '2026-10-17',
    )
    expect(out).toEqual([
      { owner: 'Dana', items: ['Call bank (due Oct 10, from Leadership)'], more: 0 },
      { owner: 'Sam', items: ['Ship forecast (due Oct 14)'], more: 0 },
    ])
  })
  it('a coworker message counts only when it asks for the meeting', () => {
    expect(asksForMeeting('Can we put this on the agenda for Monday?', 'Weekly leadership')).toBe(true)
    expect(asksForMeeting('Bring it up at weekly leadership please', 'Weekly leadership')).toBe(true)
    expect(asksForMeeting('Lunch at noon?', 'Weekly leadership')).toBe(false)
  })
  it('composes plain sections and nothing when empty', () => {
    expect(composeAgenda(cleanSections({}))).toBe('')
    const body = composeAgenda(cleanSections({ numbers: ['Revenue is 12% behind pace'], blockers: ['Sam: waiting on legal'], raised: ['Dana: office move'] }))
    expect(body).toBe('Numbers that moved\n- Revenue is 12% behind pace\n\nBlockers from the weekly status\n- Sam: waiting on legal\n\nAsked to raise\n- Dana: office move')
    expect(body).not.toMatch(/—/)
    expect(cleanBody('a\r\n\n\n\nb ')).toBe('a\n\nb')
  })
})

describe('the invite', () => {
  it('puts the agenda first and replaces an earlier copy, keeping the notes', () => {
    const once = mergeIntoDescription('<p>Zoom link here</p>', 'Old')
    expect(once.startsWith(`${INVITE_START}\nOld\n${INVITE_END}`)).toBe(true)
    expect(once).toContain('Zoom link here')
    const twice = mergeIntoDescription(once, 'New')
    expect(twice).not.toContain('Old')
    expect(twice.split(INVITE_START)).toHaveLength(2)
    expect(twice).toContain('Zoom link here')
  })
})

describe('notice wiring', () => {
  it('the draft notice gets a one-tap Add to the invite that asks Ciao for a yes', () => {
    const t = agendaNoticeText('Weekly leadership', startLabel('2026-10-19T13:00:00Z', NY), 'x')
    const n = { key: agendaNoticeKey('a1', 'm1'), item_id: 'a1', title: t.title }
    const acts = actionsFor(n)
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ action: 'ask', label: 'Add to the invite' })
    expect((acts[0] as { prompt: string }).prompt).toBe(agendaInvitePrompt({ id: 'a1', title: 'Weekly leadership' }))
    expect((acts[0] as { prompt: string }).prompt).toMatch(/wait for my yes/)
    expect(actionsFor({ key: agendaNoticeKey('a1', 'm1'), item_id: null })).toEqual([])
    expect(t.body).toMatch(/Nothing goes on the invite until you say yes/)
  })
  it('shows regardless of the employee-ops switch and is on unless switched off', () => {
    expect(ALWAYS_SHOWN_PREFIXES).toContain('lagenda-')
    expect(agendaOn({})).toBe(true)
    expect(agendaOn({ CXO_LEADERSHIP_AGENDA: 'off' })).toBe(false)
  })
})

describe('Ciao and worker wiring', () => {
  it('the tool is registered, exec only, and needs confirmed for the invite', () => {
    expect(Object.keys(CXO_AGENDA_TOOL_HANDLERS)).toEqual(['leadership_agenda'])
    expect(CXO_AGENDA_TOOL_DEFS[0].name).toBe('leadership_agenda')
    expect([...EMPLOYEE_TOOLS]).not.toContain('leadership_agenda')
    const tools = read('lib/agent/cxoTools.ts')
    expect(tools).toContain('...CXO_AGENDA_TOOL_HANDLERS')
    expect(tools).toContain('...CXO_AGENDA_TOOL_DEFS')
    expect(read('lib/agent/cxoCatalog.ts')).toContain("tool: 'leadership_agenda'")
    expect(read('lib/agent/cxoAgendaTool.ts')).toMatch(/args\.confirmed !== true \|\| ctx\.untrustedSeen === true/)
  })
  it('runs on the Hetzner tick with a kill switch, never a Vercel cron', () => {
    const w = read('hetzner-worker/index.ts')
    expect(w).toContain('runLeadershipAgendaTick')
    expect(w).toContain('CXO_AGENDA_EVERY_N_TICKS')
    expect(read('.github/workflows/deploy-worker.yml')).toContain("'lib/meetings/**'")
    expect(read('vercel.json')).not.toMatch(/agenda/)
  })
  it('no model in the agenda path', () => {
    for (const f of ['lib/meetings/agenda.ts', 'lib/meetings/agendaShared.ts', 'lib/agent/cxoAgendaTool.ts']) {
      expect(read(f)).not.toMatch(/aiProvider|anthropic|haiku|openrouter/i)
    }
  })
})
