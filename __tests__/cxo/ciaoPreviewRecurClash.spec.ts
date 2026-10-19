/**
 * Ciao QA 2026-10-19:
 *  1. The month-to-date board update preview is not saved and not on Today;
 *     it offers to save, and save: true really writes it. The honesty guard
 *     catches "it's on Today" with no write behind it.
 *  2. A repeating event's first date is the next matching slot still ahead
 *     (today when its time has not passed), stated in the proposal.
 *  3. A clash shows the clashing meeting's own start and end, not the part
 *     that overlaps the asked window.
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
  reads: [] as Array<{ from: string; to: string }>,
}
// Like Google: freeBusy and the events read both cut a block at the window asked for.
vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listConnectedGoogleAccounts: async () => [{ accountId: 'acc-dana', memberId: 'm-dana', email: 'dana@acme.test', label: 'Dana', isShared: false }],
  getBusySlots: async (_rep: string, from: string, to: string) => {
    g.reads.push({ from, to })
    const lo = Date.parse(from)
    const hi = Date.parse(to)
    return g.events
      .filter((e) => Date.parse(e.startIso) < hi && Date.parse(e.endIso) > lo)
      .map((e) => ({ startIso: new Date(Math.max(Date.parse(e.startIso), lo)).toISOString(), endIso: new Date(Math.min(Date.parse(e.endIso), hi)).toISOString(), calendar: 'Work', ...(e.title ? { title: e.title } : {}) }))
  },
}))
vi.mock('@/lib/cxoCalendar', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  chooseCalendar: async () => ({ calendar: { accountId: 'acc-dana', memberId: 'm-dana', accountEmail: 'dana@acme.test', accountLabel: 'Dana', calendarId: 'primary', name: 'Work', primary: true }, choices: [], ambiguous: false }),
}))

const board = {
  drafts: [] as Array<{ month: string; opts: Record<string, unknown> }>,
  existing: null as Record<string, unknown> | null,
}
const SECTIONS = { month: '2026-10', month_label: 'October 2026, month to date through Oct 19', headline: [], wins: ['Production up 4%'], misses: [], decisions: [], asks: [], sources: ['the book'], through: '2026-10-19', to_date: true }
vi.mock('@/lib/boardUpdate/data', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  previewBoardUpdate: async () => ({ month: '2026-10', through: '2026-10-19', sections: SECTIONS, text: 'Board update: October 2026, month to date through Oct 19\n...' }),
  getBoardUpdate: async () => board.existing,
  draftBoardUpdate: async (_t: unknown, month: string, opts: Record<string, unknown>) => {
    board.drafts.push({ month, opts })
    return { row: { id: 'bu-oct', rep_id: 'rep-acme', month, sections: opts.sections, draft_text: 'x', body: 'Board update: October 2026, month to date through Oct 19\n...', status: 'draft', edited: false, generated_at: null, edited_at: null, sent_at: null }, created: true, regenerated: false }
  },
}))

import { firstFutureStart } from '@/lib/cxoMeetingTime'
import { parseRecurrence, type Recurrence } from '@/lib/cxoRecurrence'
import { BUSY_READ_PAD_MS, busyAcrossAll, busyOverlapping, conflictIn } from '@/lib/cxoCalendar'
import { describeCxoCall } from '@/lib/agent/cxoTools'
import { CXO_BOARD_UPDATE_TOOL_HANDLERS } from '@/lib/agent/cxoBoardUpdateTool'
import { actionSucceeded, claimsAction, claimsOnToday } from '@/lib/agent/actionClaims'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const et = (local: string) => new Date(`${local}-04:00`).toISOString()
const est = (local: string) => new Date(`${local}-05:00`).toISOString()
const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: tz, settings: {} } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role: 'owner', timezone: tz, settings: {} } as unknown as Member
const ctx = (extra: Partial<AgentContext> = {}): AgentContext => ({ tenant: TENANT, caller: DANA, timezone: tz, todayIso: '2026-10-19', ownerMemberId: DANA.id, channel: 'app', ...extra })
const rec = (rule: string): Recurrence => {
  const r = parseRecurrence(rule)
  if (!r || !r.ok) throw new Error('bad rule')
  return r.recurrence
}
// Monday, Oct 19 2026, 7:55am in New York.
const MON_755 = new Date(et('2026-10-19T07:55:00'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(MON_755)
  g.events = []
  g.reads = []
  board.drafts = []
  board.existing = null
})
afterEach(() => vi.useRealTimers())

// ── 1. Board update preview ─────────────────────────────────────────────────

describe('month-to-date board update preview', () => {
  const run = async (args: Record<string, unknown>) => {
    const out = await CXO_BOARD_UPDATE_TOOL_HANDLERS.board_update(ctx(), args)
    return { text: out.text, json: JSON.parse(out.text) as Record<string, unknown> }
  }

  it('is not saved, not on Today, and offers to save', async () => {
    const { text, json } = await run({ to_date: true })
    expect(json).toMatchObject({ ok: true, kind: 'month_to_date_preview', saved: false, on_today: false, offer: 'Want me to save this as a draft on Today?' })
    expect(String(json.note)).toMatch(/NOT saved and NOT on Today/)
    expect(String(json.note)).toMatch(/never say it is saved, drafted to Today or on Today/)
    expect(String(json.note)).toContain('Want me to save this as a draft on Today?')
    expect(board.drafts).toEqual([])
    // The preview did not do anything, so a reply claiming otherwise is caught.
    expect(actionSucceeded('board_update', { to_date: true }, text)).toBe(false)
  })

  it('asking for the running month by its key is the preview too', async () => {
    const { json } = await run({ month: '2026-10' })
    expect(json.kind).toBe('month_to_date_preview')
    expect(board.drafts).toEqual([])
  })

  it('save: true really writes it as the month\'s draft, then says so', async () => {
    const { text, json } = await run({ to_date: true, save: true })
    expect(board.drafts).toHaveLength(1)
    expect(board.drafts[0].month).toBe('2026-10')
    expect(board.drafts[0].opts).toMatchObject({ regenerate: true, keepEdits: true, by: 'm-dana', sections: SECTIONS })
    expect(json).toMatchObject({ ok: true, kind: 'month_to_date_draft', saved: true, open_at: '/dashboard#board-update' })
    expect(String(json.say)).toMatch(/^Saved as a draft on Today/)
    expect(actionSucceeded('board_update', { to_date: true, save: true }, text)).toBe(true)
  })

  it('a draft saved earlier is named as on Today, the preview still is not', async () => {
    board.existing = { id: 'bu-oct', month: '2026-10', status: 'draft', sections: SECTIONS }
    const { json } = await run({ to_date: true })
    expect(json.saved).toBe(false)
    expect(String(json.on_today)).toMatch(/saved earlier is on Today/)
  })
})

describe('honesty guard: "on Today" claims', () => {
  it('catches a claim that something sits on Today', () => {
    for (const s of [
      "It's on Today for you to edit and send.",
      'It is on your Today, ready to edit.',
      'This draft is now on Today.',
      'The preview is saved on Today.',
      'I saved it to Today so you can tweak it.',
    ]) expect(claimsOnToday(s), s).toBe(true)
    const reply = 'Here is October so far (unsaved, month to date through Oct 19).\n\nHeadline: production up 4%.\n\nIt\'s on Today for you to edit and send.'
    expect(claimsAction(reply)).toBe(true)
  })

  it('an offer, a denial, or a meeting "on today" is not a claim', () => {
    for (const s of [
      'Want me to save this as a draft on Today?',
      'It is not saved and not on Today yet.',
      'Nothing is on Today yet.',
      'Once you say yes I will put it on Today.',
      "It's on today at 2pm with Erin.",
      'Your September update is on Today.',
    ]) expect(claimsOnToday(s), s).toBe(false)
    const reply = 'October so far, not saved yet (month to date through Oct 19).\n\nHeadline: production up 4%.\n\nWant me to save this as a draft on Today?'
    expect(claimsAction(reply)).toBe(false)
  })
})

// ── 2. Repeating events start at the next slot still ahead ──────────────────

describe('first date of a repeating event', () => {
  const weeklyMon = rec('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10')

  it('Monday 7:55am, "every Monday at 9": today at 9, not next week', () => {
    const f = firstFutureStart(weeklyMon, et('2026-10-26T09:00:00'), et('2026-10-26T09:30:00'), tz, MON_755)
    expect(f).toEqual({ startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T09:30:00'), moved: true, isToday: true })
  })

  it('once 9am has passed, the first one is next Monday', () => {
    const at905 = new Date(et('2026-10-19T09:05:00'))
    const asked = firstFutureStart(weeklyMon, et('2026-10-19T09:00:00'), et('2026-10-19T09:30:00'), tz, at905)
    expect(asked).toMatchObject({ startIso: et('2026-10-26T09:00:00'), moved: true, isToday: false })
    const already = firstFutureStart(weeklyMon, et('2026-10-26T09:00:00'), et('2026-10-26T09:30:00'), tz, at905)
    expect(already).toMatchObject({ startIso: et('2026-10-26T09:00:00'), moved: false })
  })

  it('a first date the person named is kept', () => {
    const f = firstFutureStart(weeklyMon, est('2026-11-02T09:00:00'), est('2026-11-02T09:30:00'), tz, MON_755, { keepLater: true })
    expect(f).toMatchObject({ startIso: est('2026-11-02T09:00:00'), moved: false })
  })

  it('weekly with no BYDAY follows the start\'s weekday; daily weekdays; monthly by day of month', () => {
    expect(firstFutureStart(rec('FREQ=WEEKLY;COUNT=4'), et('2026-10-26T10:00:00'), et('2026-10-26T11:00:00'), tz, MON_755).startIso).toBe(et('2026-10-19T10:00:00'))
    expect(firstFutureStart(rec('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'), et('2026-10-20T08:00:00'), et('2026-10-20T08:15:00'), tz, MON_755).startIso).toBe(et('2026-10-19T08:00:00'))
    // 7:30 already passed today: tomorrow.
    expect(firstFutureStart(rec('FREQ=DAILY'), et('2026-10-21T07:30:00'), et('2026-10-21T07:45:00'), tz, MON_755).startIso).toBe(et('2026-10-20T07:30:00'))
    // The 19th at 9 is still ahead today.
    expect(firstFutureStart(rec('FREQ=MONTHLY;COUNT=3'), est('2026-11-19T09:00:00'), est('2026-11-19T10:00:00'), tz, MON_755).startIso).toBe(et('2026-10-19T09:00:00'))
  })

  it('the proposal starts today and says so; the yes books that exact date', async () => {
    const d = await describeCxoCall(ctx(), 'create_calendar_event', { title: 'Weekly 1:1', start: '2026-10-26T09:00', duration_min: 30, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10' })
    expect(d?.ok).toBe(true)
    if (!d || !d.ok) return
    const firstLine = d.lines.find((l) => l.startsWith('First one:'))
    expect(firstLine).toMatch(/^First one: today, Mon, Oct 19, 9:00/)
    expect(d.lines).toContain('Repeats: every Monday, 10 times (one repeating event)')
    expect(d.args).toMatchObject({ start: et('2026-10-19T09:00:00'), end: et('2026-10-19T09:30:00'), start_date_named: true })
  })
})

// ── 3. A clash shows the meeting's own times ────────────────────────────────

describe('clash shows the clashing meeting\'s real start and end', () => {
  it('busyAcrossAll reads past the window and keeps each block whole', async () => {
    g.events = [
      { startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), title: 'Exec meeting' },
      { startIso: et('2026-10-19T13:00:00'), endIso: et('2026-10-19T14:00:00'), title: 'Lunch review' },
    ]
    const busy = await busyAcrossAll('rep-acme', et('2026-10-19T09:00:00'), et('2026-10-19T09:30:00'), { memberId: 'm-dana' })
    expect(g.reads[0]).toEqual({ from: new Date(Date.parse(et('2026-10-19T09:00:00')) - BUSY_READ_PAD_MS).toISOString(), to: new Date(Date.parse(et('2026-10-19T09:30:00')) + BUSY_READ_PAD_MS).toISOString() })
    expect(busy).toEqual([{ startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), calendar: 'Work (dana@acme.test)', title: 'Exec meeting' }])
  })

  it('a titled meeting wins over a merged untitled free/busy block', () => {
    const hit = conflictIn(
      [
        { startIso: et('2026-10-19T08:30:00'), endIso: et('2026-10-19T10:00:00'), calendar: 'Work' },
        { startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), calendar: 'Work', title: 'Exec meeting' },
      ],
      et('2026-10-19T09:00:00'),
      et('2026-10-19T09:30:00'),
    )
    expect(hit?.title).toBe('Exec meeting')
    expect(busyOverlapping([{ startIso: et('2026-10-19T07:00:00'), endIso: et('2026-10-19T08:00:00') }], et('2026-10-19T09:00:00'), et('2026-10-19T09:30:00'))).toEqual([])
  })

  it('the one-off proposal names 9:00 to 10:00, not 9:30', async () => {
    g.events = [{ startIso: et('2026-10-20T09:00:00'), endIso: et('2026-10-20T10:00:00'), title: 'Exec meeting' }]
    const d = await describeCxoCall(ctx(), 'create_calendar_event', { title: 'Coffee', start: '2026-10-20T09:00', duration_min: 30 })
    expect(d?.ok).toBe(false)
    if (!d || d.ok) return
    const say = String(JSON.parse(d.result.text).say)
    expect(say).toMatch(/"Exec meeting" from Tue, Oct 20, 9:00 AM EDT to Tue, Oct 20, 10:00 AM EDT/)
  })

  it('the repeating proposal lists the meeting\'s own end on every clashing date', async () => {
    g.events = [
      { startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), title: 'Exec meeting' },
      { startIso: est('2026-11-09T09:00:00'), endIso: est('2026-11-09T10:00:00'), title: 'Exec meeting' },
    ]
    const d = await describeCxoCall(ctx(), 'create_calendar_event', { title: 'Weekly 1:1', start: '2026-10-19T09:00', duration_min: 30, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10' })
    expect(d?.ok).toBe(true)
    if (!d || !d.ok) return
    const clash = d.lines.find((l) => l.startsWith('Clashes in the first'))!
    expect(clash).toContain('"Exec meeting" (Mon, Oct 19, 9:00 AM EDT to Mon, Oct 19, 10:00 AM EDT)')
    // Nov 9 is the last date checked: the read window ends 9:30 that day, and the meeting still shows 10:00 (EST after the change).
    expect(clash).toContain('"Exec meeting" (Mon, Nov 9, 9:00 AM EST to Mon, Nov 9, 10:00 AM EST)')
    expect(clash).not.toMatch(/9:30 AM/)
  })
})
