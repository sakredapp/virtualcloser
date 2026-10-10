/**
 * Suite CXO employee ops: the pure rules behind follow-up nudges, approvals,
 * scheduled reports and the feature switch. No database, no network.
 */
import { describe, expect, it } from 'vitest'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import {
  effectiveDue,
  inWorkingHours,
  noticeKey,
  noticeTag,
  notifyStatus,
  openItemsFor,
  planFollowups,
  workHours,
  type FollowItem,
  type FollowMember,
} from '@/lib/followups/shared'
import { auditResultOf, classifyAction, isApprover, needsApproval, orgDirectory, summarizeArgs, visibleAuditRows } from '@/lib/ops/approvalsShared'
import { asReportKind, buildReport, nextRunAt, parseWeekday, timingWords } from '@/lib/ops/reportsShared'

const REP = 'rep_cxo'
const TZ = 'America/New_York'
// Wednesday 2026-10-14 15:00 New York (19:00Z): inside default working hours.
const NOW = new Date('2026-10-14T19:00:00Z')

function member(id: string, extra: Partial<FollowMember> = {}): FollowMember {
  return { id, rep_id: REP, role: 'rep', is_active: true, timezone: TZ, display_name: id.toUpperCase(), email: `${id}@acme.com`, settings: null, ...extra }
}
function item(id: string, extra: Partial<FollowItem> = {}): FollowItem {
  return { kind: 'request', id, rep_id: REP, title: `Task ${id}`, responsible: ['bob'], asker: 'ann', due_date: null, created_at: '2026-10-01T12:00:00Z', done_at: null, href: `/dashboard/me#${id}`, ...extra }
}
const team = [member('ann', { role: 'owner' }), member('bob'), member('cat'), member('eve', { role: 'assistant' })]

describe('feature switch', () => {
  it('is off unless settings.cxo_employee_ops is exactly true', () => {
    expect(cxoEmployeeOps(null)).toBe(false)
    expect(cxoEmployeeOps({ settings: null })).toBe(false)
    expect(cxoEmployeeOps({ settings: { cxo_employee_ops: 'true' } })).toBe(false)
    expect(cxoEmployeeOps({ settings: { cxo_employee_ops: 1 } })).toBe(false)
    expect(cxoEmployeeOps({ settings: { cxo_employee_ops: true } })).toBe(true)
  })
})

describe('planFollowups', () => {
  it('nudges the person responsible when due today or tomorrow', () => {
    const out = planFollowups({ items: [item('a', { due_date: '2026-10-14' }), item('b', { due_date: '2026-10-15' }), item('c', { due_date: '2026-10-20' })], members: team, sent: new Set(), now: NOW })
    expect(out.map((n) => [n.kind, n.member_id, n.item_id])).toEqual([
      ['nudge', 'bob', 'a'],
      ['nudge', 'bob', 'b'],
    ])
    expect(out[0].title).toBe('Due today: Task a')
    expect(out[0].body).toBe('ANN is waiting on this request.')
    expect(out[1].title).toBe('Due tomorrow: Task b')
  })

  it('escalates an overdue item to the asker, naming who still owes it', () => {
    const out = planFollowups({ items: [item('a', { due_date: '2026-10-12', responsible: ['bob', 'cat'] })], members: team, sent: new Set(), now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'escalate', member_id: 'ann', key: 'escalate|request|a' })
    expect(out[0].body).toMatch(/^BOB and CAT have not closed this request\./)
  })

  it('closes once to the asker when done recently, never for old closes', () => {
    const fresh = item('a', { done_at: '2026-10-14T10:00:00Z' })
    const stale = item('b', { done_at: '2026-10-01T10:00:00Z' })
    const out = planFollowups({ items: [fresh, stale], members: team, sent: new Set(), now: NOW })
    expect(out.map((n) => [n.kind, n.member_id, n.item_id])).toEqual([['close', 'ann', 'a']])
    expect(out[0].body).toBe('BOB closed the request you were waiting on.')
  })

  it('never repeats a key already sent and never plans the same key twice', () => {
    const items = [item('a', { due_date: '2026-10-14' }), item('a', { due_date: '2026-10-14' })]
    const first = planFollowups({ items, members: team, sent: new Set(), now: NOW })
    expect(first).toHaveLength(1)
    const again = planFollowups({ items, members: team, sent: new Set(first.map((n) => n.key)), now: NOW })
    expect(again).toEqual([])
  })

  it('waits for working hours and pauses, and never writes anything for them', () => {
    const sunday = new Date('2026-10-18T19:00:00Z')
    expect(planFollowups({ items: [item('a', { due_date: '2026-10-18' })], members: team, sent: new Set(), now: sunday })).toEqual([])
    const paused = team.map((m) => (m.id === 'bob' ? { ...m, settings: { followups_paused_until: '2026-10-20T00:00:00Z' } } : m))
    expect(planFollowups({ items: [item('a', { due_date: '2026-10-14' })], members: paused, sent: new Set(), now: NOW })).toEqual([])
  })

  it('never nudges an executive assistant, an inactive member or someone off the tenant', () => {
    const items = [item('a', { due_date: '2026-10-14', responsible: ['eve'] }), item('b', { due_date: '2026-10-14', responsible: ['zed'] })]
    const members = [...team, member('zed', { rep_id: 'other_rep' }), member('gone', { is_active: false })]
    expect(planFollowups({ items, members, sent: new Set(), now: NOW })).toEqual([])
    expect(notifyStatus(member('eve', { role: 'assistant' }), REP, NOW)).toBe('never')
    expect(notifyStatus(member('bob'), REP, NOW)).toBe('now')
  })

  it('skips a nudge for brand-new items and for cards (the reminder job covers them), but still escalates cards', () => {
    const young = item('a', { due_date: '2026-10-14', created_at: '2026-10-14T18:30:00Z' })
    expect(planFollowups({ items: [young], members: team, sent: new Set(), now: NOW })).toEqual([])
    const card = item('c', { kind: 'card', due_date: '2026-10-14' })
    expect(planFollowups({ items: [card], members: team, sent: new Set(), now: NOW })).toEqual([])
    const lateCard = item('d', { kind: 'card', due_date: '2026-10-10' })
    expect(planFollowups({ items: [lateCard], members: team, sent: new Set(), now: NOW }).map((n) => n.kind)).toEqual(['escalate'])
  })

  it('implies a due date for requests without one; cards need a real one', () => {
    expect(effectiveDue({ kind: 'request', due_date: null, created_at: '2026-10-01T12:00:00Z' })).toBe('2026-10-04')
    expect(effectiveDue({ kind: 'card', due_date: null, created_at: '2026-10-01T12:00:00Z' })).toBeNull()
    expect(effectiveDue({ kind: 'meeting', due_date: '2026-10-09T00:00:00Z', created_at: '2026-10-01T12:00:00Z' })).toBe('2026-10-09')
  })

  it('keys and tags are stable', () => {
    expect(noticeKey('nudge', { kind: 'request', id: 'x' }, 'bob')).toBe('nudge|request|x|bob')
    expect(noticeTag('approval')).toBe('Needs your OK')
    expect(noticeTag('weird')).toBe('Mira')
  })
})

describe('working hours', () => {
  it('defaults to Mon–Fri 9–7 and accepts a custom window', () => {
    expect(workHours({ settings: null })).toEqual({ start: 9, end: 19, days: [1, 2, 3, 4, 5] })
    expect(workHours({ settings: { work_hours: { start: 7, end: 5 } } }).end).toBe(19)
    const m = { settings: { work_hours: { start: 6, end: 12, days: [6] } }, timezone: TZ }
    expect(inWorkingHours(m, new Date('2026-10-17T14:00:00Z'))).toBe(true) // Sat 10:00 NY
    expect(inWorkingHours(m, new Date('2026-10-17T17:00:00Z'))).toBe(false) // Sat 13:00 NY
    expect(inWorkingHours({ settings: null, timezone: 'Not/AZone' }, NOW)).toBe(true)
  })
})

describe('views', () => {
  it('waiting_on is what others owe me; owed_by_me is what I owe', () => {
    const items = [item('a', { due_date: '2026-10-20' }), item('b', { asker: 'bob', responsible: ['ann'] }), item('c', { done_at: '2026-10-13T00:00:00Z' })]
    const waiting = openItemsFor({ items, members: team, memberId: 'ann', view: 'waiting_on', now: NOW, tz: TZ })
    expect(waiting.map((r) => r.id)).toEqual(['a'])
    expect(waiting[0].owes).toEqual(['BOB'])
    const owed = openItemsFor({ items, members: team, memberId: 'ann', view: 'owed_by_me', now: NOW, tz: TZ })
    expect(owed.map((r) => r.id)).toEqual(['b'])
    expect(owed[0].overdue).toBe(true)
  })
})

describe('approvals', () => {
  const exec = { id: 'ann', rep_id: REP, role: 'owner' }
  const employee = { id: 'bob', rep_id: REP, role: 'rep' }
  const assistant = { id: 'eve', rep_id: REP, role: 'assistant' }
  const tenant = { id: REP, brand: 'cxo' }
  const org = orgDirectory([{ email: 'ann@acme.com' }, { email: 'bob@gmail.com' }])

  it('only executives approve; employees and assistants never do', () => {
    expect(isApprover(exec, tenant)).toBe(true)
    expect(isApprover({ role: 'manager' }, tenant)).toBe(true)
    expect(isApprover(employee, tenant)).toBe(false)
    expect(isApprover(assistant, tenant)).toBe(false)
    expect(isApprover(null, tenant)).toBe(false)
  })

  it('classifies outside sends and HR writes; inside-the-company actions need nothing', () => {
    expect(classifyAction('send_partner_message', { partner: 'Acme Capital', subject: 'Q4' }, org)).toEqual({ reason: 'outside_send', summary: 'Email Acme Capital: "Q4"' })
    expect(classifyAction('reply_to_thread', { mode: 'send', to: 'ann@acme.com' }, org)).toBeNull()
    expect(classifyAction('reply_to_thread', { mode: 'send', to: 'sam@acme.com' }, org)).toBeNull() // company domain
    expect(classifyAction('reply_to_thread', { mode: 'send', to: 'bob@gmail.com' }, org)).toBeNull() // a member, public domain
    expect(classifyAction('reply_to_thread', { mode: 'send', to: 'x@gmail.com' }, org)?.reason).toBe('outside_send')
    expect(classifyAction('reply_to_thread', { mode: 'draft', to: 'x@gmail.com' }, org)).toBeNull()
    expect(classifyAction('create_calendar_event', { title: 'Sync', attendees: ['ann@acme.com'] }, org)).toBeNull()
    expect(classifyAction('create_calendar_event', { title: 'Sync', attendees: ['ann@acme.com', 'p@partner.io'] }, org)?.summary).toBe('Invite p@partner.io to "Sync"')
    expect(classifyAction('schedule_call_with_partner', { partner: 'Acme' }, org)).toBeNull()
    expect(classifyAction('schedule_call_with_partner', { partner: 'Acme', pick_first: true }, org)?.reason).toBe('outside_send')
    expect(classifyAction('set_employee_quota', { employee: 'Bob' }, org)).toEqual({ reason: 'others_work', summary: "Change an employee's quota: Bob" })
    expect(classifyAction('list_my_todos', {}, org)).toBeNull()
  })

  it('queues only when it needs an OK and the caller cannot give one', () => {
    const cls = classifyAction('send_partner_message', { partner: 'Acme' }, org)
    expect(needsApproval(cls, employee, tenant)).toBe(true)
    expect(needsApproval(cls, exec, tenant)).toBe(false)
    expect(needsApproval(null, employee, tenant)).toBe(false)
  })

  it('audit: execs see the company, employees only their own rows, never another tenant', () => {
    const rows = [
      { id: '1', rep_id: REP, member_id: 'ann' },
      { id: '2', rep_id: REP, member_id: 'bob' },
      { id: '3', rep_id: 'other', member_id: 'bob' },
    ]
    expect(visibleAuditRows(rows, exec, tenant).map((r) => r.id)).toEqual(['1', '2'])
    expect(visibleAuditRows(rows, employee, tenant).map((r) => r.id)).toEqual(['2'])
  })

  it('summarizes arguments without keeping long text, and classes results', () => {
    expect(summarizeArgs({ to: 'x@y.com', body: 'a'.repeat(500), n: 2, tags: ['a', 'b'], nested: { a: 1 } })).toEqual({ to: 'x@y.com', body: '[500 chars]', n: 2, tags: ['a', 'b'], nested: '[object]' })
    expect(auditResultOf('{"ok":true}')).toBe('ok')
    expect(auditResultOf('{"ok":false}')).toBe('not_done')
    expect(auditResultOf('{"ok":false,"error":"x"}')).toBe('error')
    expect(auditResultOf('{"refused":true}')).toBe('refused')
    expect(auditResultOf('{"queued":true}')).toBe('queued')
    expect(auditResultOf('plain text')).toBe('ok')
  })
})

describe('scheduled reports', () => {
  it('next run is strictly after now, at the local hour, weekdays only for daily', () => {
    const fri = new Date('2026-10-16T13:30:00Z') // Fri 09:30 NY
    const daily = nextRunAt({ cadence: 'daily', weekday: null, hour: 9 }, TZ, fri)
    expect(daily.toISOString()).toBe('2026-10-19T13:00:00.000Z') // Mon 9am NY, skips the weekend
    const weekly = nextRunAt({ cadence: 'weekly', weekday: 1, hour: 8 }, TZ, fri)
    expect(weekly.toISOString()).toBe('2026-10-19T12:00:00.000Z')
    const laterToday = nextRunAt({ cadence: 'daily', weekday: null, hour: 17 }, TZ, fri)
    expect(laterToday.toISOString()).toBe('2026-10-16T21:00:00.000Z')
    expect(nextRunAt({ cadence: 'daily', weekday: null, hour: 9 }, 'Nope/Zone', fri).toISOString()).toBe('2026-10-19T13:00:00.000Z')
  })

  it('parses weekdays and words the timing', () => {
    expect(parseWeekday('Monday')).toBe(1)
    expect(parseWeekday('fri')).toBe(5)
    expect(parseWeekday(3)).toBe(3)
    expect(parseWeekday('someday')).toBeNull()
    expect(parseWeekday('')).toBeNull()
    expect(timingWords({ cadence: 'daily', weekday: null, hour: 9 })).toBe('every weekday at 9am')
    expect(timingWords({ cadence: 'weekly', weekday: 5, hour: 17 })).toBe('every Friday at 5pm')
    expect(timingWords({ cadence: 'weekly', weekday: 0, hour: 0 })).toBe('every Sunday at 12am')
    expect(asReportKind('overdue')).toBe('overdue')
    expect(asReportKind('everything')).toBeNull()
  })

  it('never builds an empty report, and company-wide kinds only for executives', () => {
    const items = [item('a', { due_date: '2026-10-10' }), item('b', { due_date: '2026-10-20', responsible: ['cat'] })]
    expect(buildReport({ kind: 'open_by_person', items, members: team, memberId: 'bob', companyWide: false, now: NOW, tz: TZ })).toBeNull()
    expect(buildReport({ kind: 'my_open', items: [], members: team, memberId: 'bob', companyWide: false, now: NOW, tz: TZ })).toBeNull()
    const mine = buildReport({ kind: 'my_open', items, members: team, memberId: 'bob', companyWide: false, now: NOW, tz: TZ })
    expect(mine?.count).toBe(1)
    expect(mine?.title).toBe('What you owe: 1')
    expect(mine?.body).toContain('Task a (overdue since')
    const company = buildReport({ kind: 'open_by_person', items, members: team, memberId: 'ann', companyWide: true, now: NOW, tz: TZ })
    expect(company?.count).toBe(2)
    expect(company?.body).toContain('BOB (1)')
    expect(company?.body).toContain('CAT (1)')
    const overdue = buildReport({ kind: 'overdue', items, members: team, memberId: 'ann', companyWide: true, now: NOW, tz: TZ })
    expect(overdue?.count).toBe(1)
  })
})
