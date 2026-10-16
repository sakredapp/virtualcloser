import { describe, it, expect } from 'vitest'
import {
  doneKeysFromRuns,
  dueMembers,
  isInWeeklyRunWindow,
  isoWeekKey,
  markerKey,
  MIN_HISTORY_TURNS,
} from '@/lib/agent/weeklyLearningsSchedule'

const NY = 'America/New_York'
const history = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))

describe('isoWeekKey', () => {
  it('uses the ISO week of the tenant-local date', () => {
    // Mon 2026-10-12 is in ISO week 42.
    expect(isoWeekKey(new Date('2026-10-12T15:00:00Z'), NY)).toBe('2026-W42')
    // Sun 2026-10-18 23:00 NY is still week 42 although it is Monday in UTC.
    expect(isoWeekKey(new Date('2026-10-19T03:00:00Z'), NY)).toBe('2026-W42')
    expect(isoWeekKey(new Date('2026-10-19T03:00:00Z'), 'UTC')).toBe('2026-W43')
  })
  it('handles the ISO year boundary', () => {
    // Thu 2026-01-01 → 2026-W01; Mon 2024-12-30 → 2025-W01; Sun 2027-01-03 → 2026-W53.
    expect(isoWeekKey(new Date('2026-01-01T12:00:00Z'), 'UTC')).toBe('2026-W01')
    expect(isoWeekKey(new Date('2024-12-30T12:00:00Z'), 'UTC')).toBe('2025-W01')
    expect(isoWeekKey(new Date('2027-01-03T12:00:00Z'), 'UTC')).toBe('2026-W53')
  })
  it('falls back to UTC on a bad timezone', () => {
    expect(isoWeekKey(new Date('2026-10-12T15:00:00Z'), 'Not/AZone')).toBe('2026-W42')
  })
})

describe('isInWeeklyRunWindow', () => {
  it('is closed Monday before 7am local, open from 7am', () => {
    // EDT = UTC-4: 10:59Z = 6:59 local, 11:00Z = 7:00 local.
    expect(isInWeeklyRunWindow(new Date('2026-10-12T10:59:00Z'), NY)).toBe(false)
    expect(isInWeeklyRunWindow(new Date('2026-10-12T11:00:00Z'), NY)).toBe(true)
  })
  it('stays open the rest of the week so a missed Monday catches up', () => {
    expect(isInWeeklyRunWindow(new Date('2026-10-14T03:00:00Z'), NY)).toBe(true) // Tue night
    expect(isInWeeklyRunWindow(new Date('2026-10-19T03:59:00Z'), NY)).toBe(true) // Sun 23:59
  })
  it('respects the tenant timezone', () => {
    // 2026-10-12 08:00Z: Mon 1am in LA (closed), Mon 9am in Berlin (open).
    expect(isInWeeklyRunWindow(new Date('2026-10-12T08:00:00Z'), 'America/Los_Angeles')).toBe(false)
    expect(isInWeeklyRunWindow(new Date('2026-10-12T08:00:00Z'), 'Europe/Berlin')).toBe(true)
  })
  it('handles local midnight on Monday as closed', () => {
    expect(isInWeeklyRunWindow(new Date('2026-10-12T04:00:00Z'), NY)).toBe(false)
  })
})

describe('doneKeysFromRuns', () => {
  it('builds member and tenant keys from job_runs meta, ignoring failures and junk', () => {
    const keys = doneKeysFromRuns([
      { meta: { rep_id: 'r1', member_id: 'm1', week: '2026-W42' }, ok: true },
      { meta: { rep_id: 'r1', member_id: null, week: '2026-W42' }, ok: null }, // still running counts as taken
      { meta: { rep_id: 'r1', member_id: 'm2', week: '2026-W42' }, ok: false },
      { meta: null },
      { meta: { rep_id: 'r1' } },
    ])
    expect([...keys].sort()).toEqual([markerKey('r1', 'm1', '2026-W42'), markerKey('r1', null, '2026-W42')].sort())
  })
})

describe('dueMembers', () => {
  const members = [
    { id: 'owner', role: 'owner', is_active: true, settings: { agent_history: history(10) } },
    { id: 'admin', role: 'admin', is_active: true, settings: { agent_history: history(MIN_HISTORY_TURNS) } },
    { id: 'rep', role: 'rep', is_active: true, settings: { agent_history: history(20) } },
    { id: 'gone', role: 'admin', is_active: false, settings: { agent_history: history(20) } },
    { id: 'quiet', role: 'owner', is_active: true, settings: { agent_history: history(MIN_HISTORY_TURNS - 1) } },
    { id: 'nosettings', role: 'owner', is_active: true },
  ]
  it('returns active owners/admins with a real conversation', () => {
    expect(dueMembers('r1', members, '2026-W42', new Set()).map((m) => m.id)).toEqual(['owner', 'admin'])
  })
  it('skips members already done this week, not last week', () => {
    const done = new Set([markerKey('r1', 'owner', '2026-W42'), markerKey('r1', 'admin', '2026-W41')])
    expect(dueMembers('r1', members, '2026-W42', done).map((m) => m.id)).toEqual(['admin'])
  })
  it('scopes markers by tenant', () => {
    const done = new Set([markerKey('r2', 'owner', '2026-W42')])
    expect(dueMembers('r1', members, '2026-W42', done).map((m) => m.id)).toEqual(['owner', 'admin'])
  })
})
