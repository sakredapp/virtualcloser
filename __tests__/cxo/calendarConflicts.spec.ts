import { describe, expect, it, vi, beforeEach } from 'vitest'

// Chainable fake for the notice reads/writes the tick makes.
const db: { open: Array<{ id: string; key: string }>; told: string[]; updates: Array<{ patch: unknown; filters: Array<[string, unknown]> }>; members: unknown[] } = { open: [], told: [], updates: [], members: [] }
function chain(table: string) {
  const filters: Array<[string, unknown]> = []
  let patch: unknown = null
  let cols = ''
  const c: Record<string, unknown> = {}
  c.select = (s: string) => ((cols = s), c)
  for (const op of ['eq', 'neq', 'is', 'in', 'like', 'limit']) c[op] = (k: string, v: unknown) => (filters.push([`${op}:${k}`, v]), c)
  c.update = (p: unknown) => ((patch = p), c)
  c.then = (res: (v: unknown) => unknown) => {
    if (table === 'reps') return Promise.resolve(res({ data: [{ id: 'org-a', brand: 'cxo', timezone: 'America/New_York', settings: {} }], error: null }))
    if (table === 'members') return Promise.resolve(res({ data: db.members, error: null }))
    if (patch) {
      db.updates.push({ patch, filters })
      return Promise.resolve(res({ data: null, error: null }))
    }
    if (cols === 'id, key') return Promise.resolve(res({ data: db.open, error: null }))
    const keys = (filters.find((f) => f[0] === 'in:key')?.[1] as string[]) ?? []
    return Promise.resolve(res({ data: keys.filter((k) => db.told.includes(k)).map((key) => ({ key })), error: null }))
  }
  return c
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
const meetingsMock = vi.fn()
vi.mock('@/lib/today', () => ({ todaysMeetings: (...a: unknown[]) => meetingsMock(...a) }))
const inserted: unknown[][] = []
vi.mock('@/lib/followups/engine', () => ({ insertNotices: async (rows: unknown[]) => (inserted.push(rows), rows.map((r, i) => ({ ...(r as object), id: `n${i}` }))) }))

import { detectIssues, issueKey, type CalEvent } from '@/lib/mira/calendarConflictsShared'
import { runCalendarConflictTick, isCheckTime } from '@/lib/mira/calendarConflicts'
import { actionsFor, CAL_CONFLICT_PREFIX } from '@/lib/followups/noticeActionsShared'
import { noticeKindsOr } from '@/lib/followups/notices'
import { noticeTag } from '@/lib/followups/shared'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { CXO_TOOL_DEFS, CXO_TOOL_HANDLERS } from '@/lib/agent/cxoTools'

const tz = 'America/New_York'
// Wednesday 2026-10-14, 7:30am New York.
const now = new Date('2026-10-14T07:30:00-04:00')
const t = (local: string) => new Date(`${local}-04:00`).toISOString()
const dana = { email: 'dana@lakeside.test', name: 'Dana' }
const lee = { email: 'lee@lakeside.test', name: 'Lee' }
const me = { email: 'sam@lakeside.test', name: 'Sam', self: true }
function ev(id: string, start: string, end: string, over: Partial<CalEvent> = {}): CalEvent {
  return { id, title: id, start: t(start), end: t(end), allDay: false, attendees: [], videoLink: null, location: null, hasAgenda: true, ...over }
}
const run = (events: CalEvent[]) => detectIssues({ events, tz, now, selfEmails: ['sam@lakeside.test'], memberId: 'm1' })

describe('detectIssues', () => {
  it('nothing to flag on a calm week', () => {
    expect(run([ev('a', '2026-10-14T09:00:00', '2026-10-14T10:00:00'), ev('b', '2026-10-14T11:00:00', '2026-10-14T12:00:00')])).toEqual([])
  })

  it('double-booked: one issue per overlapping pair, stable key', () => {
    const out = run([ev('zeta', '2026-10-14T09:00:00', '2026-10-14T10:00:00'), ev('alpha', '2026-10-14T09:30:00', '2026-10-14T10:30:00')])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('double')
    expect(out[0].key).toBe(issueKey('double', 'alpha~zeta', 'm1'))
    expect(out[0].key.startsWith(CAL_CONFLICT_PREFIX)).toBe(true)
    expect(out[0].title).toBe('Double-booked Wednesday, Oct 14 at 9:30am')
  })

  it('skips declined / free, all-day and past meetings', () => {
    expect(run([ev('a', '2026-10-14T09:00:00', '2026-10-14T10:00:00'), ev('b', '2026-10-14T09:30:00', '2026-10-14T10:30:00', { notBusy: true })])).toEqual([])
    expect(run([{ ...ev('a', '2026-10-14T09:00:00', '2026-10-14T10:00:00'), allDay: true }, ev('b', '2026-10-14T09:30:00', '2026-10-14T10:30:00')])).toEqual([])
    expect(run([ev('a', '2026-10-14T06:00:00', '2026-10-14T08:00:00'), ev('b', '2026-10-14T06:30:00', '2026-10-14T07:00:00')])).toEqual([])
  })

  it('no break: four hours back to back; a real gap breaks the stretch', () => {
    const day = (gap: number) => [
      ev('a', '2026-10-15T09:00:00', '2026-10-15T10:00:00'),
      ev('b', `2026-10-15T10:${String(gap).padStart(2, '0')}:00`, '2026-10-15T11:30:00'),
      ev('c', '2026-10-15T11:35:00', '2026-10-15T13:00:00'),
    ]
    const out = run(day(5))
    expect(out.map((i) => i.kind)).toEqual(['no_break'])
    expect(out[0].key).toBe(issueKey('no_break', '2026-10-15', 'm1'))
    expect(out[0].body).toContain('3 meetings back to back from 9:00am to 1:00pm')
    expect(run(day(20))).toEqual([])
  })

  it('no video link: only with other people, and not when there is a place or a room', () => {
    const solo = ev('focus', '2026-10-14T09:00:00', '2026-10-14T10:00:00', { attendees: [me] })
    const call = ev('sync', '2026-10-14T11:00:00', '2026-10-14T11:30:00', { attendees: [me, dana] })
    expect(run([solo, call]).map((i) => i.kind)).toEqual(['no_link'])
    expect(run([{ ...call, location: 'Suite 400' }])).toEqual([])
    expect(run([{ ...call, attendees: [me, dana, { email: 'c_1@resource.calendar.google.com', name: 'Room 2' }] }])).toEqual([])
    expect(run([{ ...call, videoLink: 'https://meet.google.com/abc' }])).toEqual([])
    // Too far out to nag yet.
    expect(run([{ ...call, start: t('2026-10-19T11:00:00'), end: t('2026-10-19T11:30:00') }])).toEqual([])
  })

  it('no agenda: group meetings of 30 minutes or more with empty notes', () => {
    const group = ev('plan', '2026-10-14T13:00:00', '2026-10-14T14:00:00', { attendees: [me, dana, lee], videoLink: 'https://meet.google.com/x', hasAgenda: false })
    expect(run([group]).map((i) => i.kind)).toEqual(['no_agenda'])
    expect(run([{ ...group, attendees: [me, dana] }])).toEqual([])
    expect(run([{ ...group, end: t('2026-10-14T13:15:00') }])).toEqual([])
    expect(run([{ ...group, hasAgenda: true }])).toEqual([])
  })
})

describe('the notice and its fix', () => {
  it('carries a prepared ask to Ciao that waits for a yes', () => {
    const [a] = actionsFor({ key: issueKey('no_link', 'ev1', 'm1'), item_id: 'ev1', title: 'No video link: Sync', body: 'Sync has 1 other person invited.' })
    expect(a.action).toBe('ask')
    expect(a.label).toBe('Add a video link')
    expect(a.prompt).toContain('ev1')
    expect(a.prompt).toContain('wait for my yes')
    expect(actionsFor({ key: issueKey('double', 'a~b', 'm1'), item_id: 'a|b' })[0].label).toBe('Move or decline')
    expect(actionsFor({ key: issueKey('no_break', '2026-10-15', 'm1') })[0].label).toBe('Find a break')
    expect(actionsFor({ key: issueKey('no_agenda', 'x', 'm1') })[0].label).toBe('Draft an agenda')
  })

  it('shows on the rail with the ops switch off, tagged Calendar', () => {
    expect(noticeKindsOr(['praise'])).toContain(`key.like.${CAL_CONFLICT_PREFIX}*`)
    expect(noticeTag('report', 'calconf-double-a~b-m1')).toBe('Calendar')
    expect(noticeTag('report', 'daywrap-x')).toBe('Report')
  })
})

describe('runCalendarConflictTick', () => {
  beforeEach(() => {
    db.open = []
    db.told = []
    db.updates = []
    db.members = [{ id: 'm1', rep_id: 'org-a', email: 'sam@lakeside.test', display_name: 'Sam', role: 'member', timezone: tz, settings: {}, is_active: true }]
    inserted.length = 0
    meetingsMock.mockReset()
  })

  it('checks from 7am on their work days', () => {
    expect(isCheckTime({ settings: {} }, tz, new Date('2026-10-14T06:50:00-04:00'))).toBe(false)
    expect(isCheckTime({ settings: {} }, tz, now)).toBe(true)
    expect(isCheckTime({ settings: {} }, tz, new Date('2026-10-17T09:00:00-04:00'))).toBe(false) // Saturday
  })

  it('one notice per new issue, once a day; dismissed ones are not sent again; fixed ones are cleared', async () => {
    meetingsMock.mockResolvedValue([ev('a', '2026-10-14T09:00:00', '2026-10-14T10:00:00'), ev('b', '2026-10-14T09:30:00', '2026-10-14T10:30:00'), ev('sync', '2026-10-14T11:00:00', '2026-10-14T11:30:00', { attendees: [me, dana] })])
    db.told = [issueKey('no_link', 'sync', 'm1')]
    db.open = [{ id: 'old', key: issueKey('no_link', 'gone', 'm1') }]
    const r = await runCalendarConflictTick(now)
    expect(r).toMatchObject({ tenants: 1, checked: 1, written: 1, cleared: 1, errors: 0 })
    expect(meetingsMock).toHaveBeenCalledWith('org-a', 'm1', tz, 8, { ownCalendarsOnly: true })
    const row = inserted[0][0] as Record<string, unknown>
    expect(row).toMatchObject({ rep_id: 'org-a', member_id: 'm1', key: issueKey('double', 'a~b', 'm1'), kind: 'report', item_kind: 'meeting', item_id: 'a|b', due_date: '2026-10-14' })
    expect(db.updates[0].filters).toEqual(expect.arrayContaining([['eq:rep_id', 'org-a'], ['eq:member_id', 'm1'], ['in:id', ['old']]]))
    // Same day again: not re-checked.
    const again = await runCalendarConflictTick(new Date(now.getTime() + 600_000))
    expect(again.checked).toBe(0)
    expect(meetingsMock).toHaveBeenCalledTimes(1)
  })

  it('writes nothing without a connected calendar or without issues', async () => {
    meetingsMock.mockResolvedValue(null)
    const r = await runCalendarConflictTick(new Date('2026-10-15T08:00:00-04:00'))
    expect(r.written).toBe(0)
    meetingsMock.mockResolvedValue([])
    const r2 = await runCalendarConflictTick(new Date('2026-10-16T08:00:00-04:00'))
    expect(r2).toMatchObject({ checked: 1, written: 0 })
    expect(inserted).toHaveLength(0)
  })
})

describe('on-demand tool', () => {
  it('employees get it, it has a handler and a def', () => {
    expect(EMPLOYEE_TOOLS.has('calendar_conflicts')).toBe(true)
    expect(typeof CXO_TOOL_HANDLERS.calendar_conflicts).toBe('function')
    expect(CXO_TOOL_DEFS.some((d) => d.name === 'calendar_conflicts')).toBe(true)
  })
})
