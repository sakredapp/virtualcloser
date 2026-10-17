import { describe, expect, it, vi, beforeEach } from 'vitest'

// A tiny chainable fake for the notice + to-do reads/writes actOnNotice makes.
const state: { notice: Record<string, unknown> | null; updated: Array<{ table: string; patch: unknown; filters: Array<[string, unknown]> }>; marked: string[] } = { notice: null, updated: [], marked: [] }
function chain(table: string) {
  const filters: Array<[string, unknown]> = []
  let patch: unknown = null
  const c: Record<string, unknown> = {}
  const self = () => c
  c.select = self
  c.eq = (k: string, v: unknown) => (filters.push([k, v]), c)
  c.is = (k: string, v: unknown) => (filters.push([`is:${k}`, v]), c)
  c.in = (k: string, v: unknown) => (filters.push([`in:${k}`, v]), c)
  c.update = (p: unknown) => ((patch = p), c)
  c.maybeSingle = async () => ({ data: state.notice, error: null })
  c.then = (res: (v: unknown) => unknown) => {
    if (table === 'cxo_todos') {
      state.updated.push({ table, patch, filters })
      const ids = (filters.find((f) => f[0] === 'in:id')?.[1] as string[]) ?? []
      return Promise.resolve(res({ data: ids.slice(0, 2).map((id) => ({ id })), error: null }))
    }
    if (table === 'cxo_followup_notices' && patch) state.marked.push(String(filters.find((f) => f[0] === 'id')?.[1]))
    return Promise.resolve(res({ data: null, error: null }))
  }
  return c
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))

import { composeWrap, firstMeetingOn, isWrapTime, nextWorkDay, sortTodos, wrapKey, wrapSchedule, type WrapInput } from '@/lib/mira/dayWrapShared'
import { actionsFor, dayWord, joinIds, splitIds, DAY_WRAP_PREFIX } from '@/lib/followups/noticeActionsShared'
import { actOnNotice, NoticeActionRefused } from '@/lib/followups/noticeActions'
import { noticeKindsOr } from '@/lib/followups/notices'

const tz = 'America/New_York'
// 2026-10-16 is a Friday.
const at = (local: string) => new Date(`${local}-04:00`)

function input(over: Partial<WrapInput> = {}): WrapInput {
  return { day: '2026-10-14', tz, todos: [], owed: [], mailOwed: null, meetings: [], nextDay: '2026-10-15', ...over }
}

describe('when the wrap goes out', () => {
  it('defaults to 5pm on weekdays', () => {
    expect(wrapSchedule({ settings: {} })).toEqual({ hour: 17, days: [1, 2, 3, 4, 5] })
    expect(isWrapTime({ settings: {} }, tz, at('2026-10-14T16:55:00'))).toBe(false)
    expect(isWrapTime({ settings: {} }, tz, at('2026-10-14T17:05:00'))).toBe(true)
    expect(isWrapTime({ settings: {} }, tz, at('2026-10-14T20:05:00'))).toBe(false)
    expect(isWrapTime({ settings: {} }, tz, at('2026-10-17T17:05:00'))).toBe(false) // Saturday
  })

  it('respects their own working hours', () => {
    const m = { settings: { work_hours: { start: 7, end: 15, days: [0, 1, 2, 3, 4] } } }
    expect(wrapSchedule(m)).toEqual({ hour: 14, days: [0, 1, 2, 3, 4] })
    expect(isWrapTime(m, tz, at('2026-10-18T14:10:00'))).toBe(true) // Sunday is a work day for them
    expect(isWrapTime(m, tz, at('2026-10-16T14:10:00'))).toBe(false) // Friday is not
  })

  it('moves to the next work day (Friday goes to Monday)', () => {
    expect(nextWorkDay('2026-10-14', [1, 2, 3, 4, 5])).toBe('2026-10-15')
    expect(nextWorkDay('2026-10-16', [1, 2, 3, 4, 5])).toBe('2026-10-19')
    expect(dayWord('2026-10-14', '2026-10-15')).toBe('tomorrow')
    expect(dayWord('2026-10-16', '2026-10-19')).toBe('Monday')
  })

  it('one key per person per day', () => {
    expect(wrapKey('2026-10-14', 'm1')).toBe('daywrap-2026-10-14-m1')
    expect(wrapKey('2026-10-14', 'm1')).not.toBe(wrapKey('2026-10-15', 'm1'))
  })
})

describe('composeWrap', () => {
  it('says nothing when there is nothing to say', () => {
    expect(composeWrap(input())).toBeNull()
    // Tomorrow's meeting alone is not a reason.
    expect(composeWrap(input({ meetings: [{ title: 'Standup', start: '2026-10-15T09:00:00-04:00', allDay: false }] }))).toBeNull()
    // A to-do with no due date that is still open is not slipping.
    expect(composeWrap(input({ todos: [{ id: 't1', body: 'Someday', done_at: null, due_date: null }] }))).toBeNull()
  })

  it('done, slipping, owed and tomorrow first meeting', () => {
    const w = composeWrap(
      input({
        todos: [
          { id: 't1', body: 'Send the Lakeside deck', done_at: '2026-10-14T15:00:00Z', due_date: null },
          { id: 't2', body: 'Call the printer', done_at: null, due_date: '2026-10-14' },
          { id: 't3', body: 'Budget review', done_at: null, due_date: '2026-10-12' },
          { id: 't4', body: 'Next week', done_at: null, due_date: '2026-10-21' },
        ],
        owed: [{ from: 'Dana', kind: 'request' }, { from: 'Dana', kind: 'question' }, { from: 'Lee', kind: 'message' }],
        meetings: [
          { title: 'Late one', start: '2026-10-15T15:00:00-04:00', allDay: false },
          { title: 'Planning', start: '2026-10-15T09:30:00-04:00', allDay: false },
          { title: 'Holiday', start: '2026-10-15', allDay: true },
        ],
      }),
    )!
    expect(w.title).toBe('Your day: 1 done, 2 to move, 3 replies owed')
    expect(w.moveIds).toEqual(['t2', 't3'])
    expect(w.body).toContain('Done today: 1 to-do (Send the Lakeside deck).')
    expect(w.body).toContain('Slips to tomorrow: 2 to-dos still open')
    expect(w.body).toContain('Replies owed: 3 messages from Dana; Lee.')
    expect(w.body).toContain('First meeting tomorrow: Planning at 9:30am.')
    expect(w.body).not.toContain('Email')
  })

  it('email line only when a count is given (Pinnacle edition, own mailbox)', () => {
    expect(composeWrap(input({ mailOwed: 0 }))).toBeNull()
    const w = composeWrap(input({ mailOwed: 2 }))!
    expect(w.body).toContain('Email: 2 emails in your inbox still need a reply.')
  })

  it('done counts only the local day', () => {
    const { done } = sortTodos([{ id: 'a', body: 'x', done_at: '2026-10-14T02:00:00Z', due_date: null }], '2026-10-14', tz)
    expect(done).toHaveLength(0) // 10pm the evening before, New York time
  })

  it('first meeting skips all-day and other days', () => {
    expect(firstMeetingOn([{ title: 'A', start: '2026-10-16T08:00:00-04:00', allDay: false }], '2026-10-15', tz)).toBeNull()
  })
})

describe('notice actions', () => {
  beforeEach(() => {
    state.notice = null
    state.updated = []
    state.marked = []
  })

  it('a day wrap with to-dos to move gets the button; others do not', () => {
    expect(actionsFor({ key: 'daywrap-2026-10-16-m1', item_id: joinIds(['a', 'b']), due_date: '2026-10-19' })).toEqual([{ action: 'move_tomorrow', label: 'Move to Monday' }])
    expect(actionsFor({ key: 'daywrap-2026-10-14-m1', item_id: 'a', due_date: '2026-10-15' })[0].label).toBe('Move to tomorrow')
    expect(actionsFor({ key: 'daywrap-2026-10-14-m1', item_id: null, due_date: '2026-10-15' })).toEqual([])
    expect(actionsFor({ key: 'nudge-request-x', item_id: 'a', due_date: '2026-10-15' })).toEqual([])
    expect(splitIds('a|b||c')).toEqual(['a', 'b', 'c'])
  })

  it('the rail shows day wraps with the ops switch off', () => {
    expect(noticeKindsOr(['praise'])).toContain(`key.like.${DAY_WRAP_PREFIX}*`)
  })

  it('moves only their own open to-dos, then clears the notice', async () => {
    state.notice = { id: 'n1', key: 'daywrap-2026-10-14-m1', item_id: 'a|b|c', due_date: '2026-10-15', read_at: null }
    const r = await actOnNotice('org-a', 'm1', 'n1', 'move_tomorrow')
    expect(r.note).toBe('Moved 2 to-dos to tomorrow.')
    const u = state.updated[0]
    expect(u.patch).toEqual({ due_date: '2026-10-15' })
    expect(u.filters).toEqual(expect.arrayContaining([['rep_id', 'org-a'], ['member_id', 'm1'], ['in:id', ['a', 'b', 'c']], ['is:done_at', null], ['is:deleted_at', null]]))
    expect(state.marked).toEqual(['n1'])
  })

  it('refuses an action the notice does not carry, or a notice that is not theirs', async () => {
    state.notice = { id: 'n2', key: 'nudge-request-x', item_id: 'a', due_date: '2026-10-15', read_at: null }
    await expect(actOnNotice('org-a', 'm1', 'n2', 'move_tomorrow')).rejects.toBeInstanceOf(NoticeActionRefused)
    state.notice = null
    await expect(actOnNotice('org-a', 'm1', 'n3', 'move_tomorrow')).rejects.toBeInstanceOf(NoticeActionRefused)
    expect(state.updated).toHaveLength(0)
  })
})
