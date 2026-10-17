import { describe, expect, it } from 'vitest'
import {
  askNoticeText,
  cleanLines,
  cleanStatus,
  composePrefill,
  composeRollup,
  isAskTime,
  isRollupTime,
  lastWeekKey,
  rollupKey,
  statusKey,
  teamName,
  weekStartIso,
} from '@/lib/status/weeklyShared'
import { ALWAYS_SHOWN_PREFIXES, actionsFor } from '@/lib/followups/noticeActionsShared'
import { weeklyStatusOn } from '@/lib/status/weekly'
import { employeePathAllowed } from '@/lib/employees/access'

const NY = 'America/New_York'

describe('weekly status timing', () => {
  it('asks Friday from 2pm in the person zone, not before', () => {
    // Fri 2026-10-16 13:59 NY = 17:59Z; 14:00 NY = 18:00Z
    expect(isAskTime(new Date('2026-10-16T17:59:00Z'), NY)).toBe(false)
    expect(isAskTime(new Date('2026-10-16T18:00:00Z'), NY)).toBe(true)
    expect(isAskTime(new Date('2026-10-17T18:00:00Z'), NY)).toBe(false) // Saturday
  })
  it('rolls up Monday from 8am in the company zone and covers last week', () => {
    const mon = new Date('2026-10-19T12:30:00Z') // 8:30am NY
    expect(isRollupTime(new Date('2026-10-19T11:59:00Z'), NY)).toBe(false)
    expect(isRollupTime(mon, NY)).toBe(true)
    expect(lastWeekKey(mon, NY)).toBe('2026-W42')
  })
  it('week starts Monday midnight local', () => {
    expect(weekStartIso(new Date('2026-10-16T18:00:00Z'), NY)).toBe('2026-10-12T04:00:00.000Z')
  })
})

describe('prefill', () => {
  it('builds moved / next / blockers from their own rows, deduped and capped', () => {
    const p = composePrefill({
      doneTodos: [{ body: 'Send Q3 deck' }, { body: 'send q3 deck' }],
      doneCards: [{ title: 'Hire ops lead' }],
      meetings: [{ title: 'Board prep' }, { title: null }],
      openTodos: [
        { body: 'Later thing', due_date: null },
        { body: 'Soon thing', due_date: '2026-10-20', priority: 'high' },
      ],
      openCards: [{ title: 'Card due first', due_date: '2026-10-19' }],
      waitingOn: [{ to: 'Dana', body: 'pricing sign-off' }],
    })
    expect(p.moved).toEqual(['Send Q3 deck', 'Hire ops lead', 'Met: Board prep'])
    expect(p.next).toEqual(['Card due first', 'Soon thing', 'Later thing'])
    expect(p.blockers).toEqual(['Waiting on Dana: pricing sign-off'])
  })
  it('the ask says nothing blocking when there are no blockers', () => {
    const t = askNoticeText({ moved: ['A'], next: [], blockers: [] })
    expect(t.title).toMatch(/drafted/)
    expect(t.body).toContain('Nothing I can see')
    expect(askNoticeText({ moved: [], next: [], blockers: [] }).title).toMatch(/what did you move/)
  })
  it('cleans an edit from text or arrays', () => {
    expect(cleanLines('- one\n\n* two\n• one')).toEqual(['one', 'two'])
    expect(cleanStatus({ moved: ['x'], next: 'y', blockers: 5 })).toEqual({ moved: ['x'], next: ['y'], blockers: [] })
  })
})

describe('rollup', () => {
  it('is null when nobody has anything', () => {
    expect(composeRollup('2026-W42', [{ name: 'A', team: 'Ops', moved: [], next: [], blockers: [], confirmed: false }])).toBeNull()
  })
  it('puts blockers first and marks unconfirmed drafts', () => {
    const r = composeRollup('2026-W42', [
      { name: 'Ben', team: 'Sales', moved: ['Closed Acme'], next: [], blockers: [], confirmed: true },
      { name: 'Ana', team: 'Ops', moved: [], next: ['Payroll'], blockers: ['Waiting on IT: laptop'], confirmed: false },
    ])!
    expect(r.title).toBe('Weekly status W42: 2 people, 1 blocker')
    expect(r.body.indexOf('Blockers')).toBe(0)
    expect(r.body.indexOf('Ops')).toBeLessThan(r.body.indexOf('Sales'))
    expect(r.body).toContain('Ana (not confirmed)')
    expect(r.body).toContain('1 not confirmed')
  })
  it('names a team by department, else manager', () => {
    expect(teamName({ department: 'Finance', manager: 'Zed' })).toBe('Finance')
    expect(teamName({ department: null, manager: 'Zed' })).toBe("Zed's team")
    expect(teamName(undefined)).toBe('No team set')
  })
})

describe('notice wiring', () => {
  it('the ask gets a one-tap Looks right; the rollup gets none', () => {
    const ask = { key: statusKey('2026-W42', 'm1'), item_id: 'row1' }
    expect(actionsFor(ask)).toEqual([{ action: 'confirm_status', label: 'Looks right' }])
    expect(actionsFor({ key: rollupKey('2026-W42', 'm1') })).toEqual([])
    expect(actionsFor({ key: statusKey('2026-W42', 'm1'), item_id: null })).toEqual([])
  })
  it('both show regardless of the employee-ops switch', () => {
    expect(ALWAYS_SHOWN_PREFIXES).toContain('weekly-status-')
    expect(ALWAYS_SHOWN_PREFIXES).toContain('weekly-rollup-')
  })
  it('is on unless switched off', () => {
    expect(weeklyStatusOn({})).toBe(true)
    expect(weeklyStatusOn({ CXO_WEEKLY_STATUS: 'off' })).toBe(false)
  })
})

describe('employee access', () => {
  it('an employee login can reach their own weekly status route', () => {
    expect(employeePathAllowed('/api/status/weekly')).toBe(true)
    expect(employeePathAllowed('/api/status/weeklyx')).toBe(false)
    expect(employeePathAllowed('/api/status/team')).toBe(false)
  })
})
