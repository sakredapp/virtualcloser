import { describe, expect, it } from 'vitest'
import {
  actingLabel,
  assistantPathKind,
  canHaveAssistant,
  canLinkAssistant,
  describeAction,
  isApiPath,
  pickActiveExec,
  shortName,
  underPrefix,
} from '@/lib/assistantsShared'

describe('assistantPathKind — financial and exec-only pages stay closed', () => {
  const blocked = [
    '/dashboard/plan',
    '/dashboard/plan/import',
    '/dashboard/employees',
    '/dashboard/employees/abc',
    '/dashboard/revenue',
    '/dashboard/integrations',
    '/dashboard/billing',
    '/dashboard/accounting',
    '/dashboard/pinnacle',
    '/dashboard/execs',
    '/dashboard/partners',
    '/dashboard/org',
    '/api/plan',
    '/api/payroll/run',
    '/api/integrations/quickbooks',
    '/api/integrations/quickbooks/sync',
    '/api/pinnacle/refresh',
    '/api/pinnacle/breakdown',
    '/api/mira/ask',
    '/api/me/activity',
    '/api/me/mcp-token',
    '/api/partners',
    '/api/google/oauth/start',
    '/admin',
  ]
  for (const p of blocked) it(`blocks ${p}`, () => expect(assistantPathKind(p)).toBe('blocked'))
})

describe('assistantPathKind — work paths act as the exec', () => {
  const work = [
    '/dashboard',
    '/dashboard/',
    '/dashboard/calendar',
    '/dashboard/boards',
    '/dashboard/boards/123',
    '/dashboard/meetings',
    '/api/today',
    '/api/messages',
    '/api/boards',
    '/api/calendar/ics',
    '/dashboard/boards?b=1#x',
  ]
  for (const p of work) it(`work ${p}`, () => expect(assistantPathKind(p)).toBe('work'))
})

describe('assistantPathKind — self paths are the assistant', () => {
  const self = ['/', '/login', '/logout', '/set-password', '/reset-password', '/dashboard/settings', '/dashboard/assistant', '/api/assistant/switch', '/api/me/liability']
  for (const p of self) it(`self ${p}`, () => expect(assistantPathKind(p)).toBe('self'))
})

describe('assistantPathKind — no prefix tricks', () => {
  it('needs a segment boundary', () => {
    expect(assistantPathKind('/api/todayx')).toBe('blocked')
    expect(assistantPathKind('/dashboard/calendarx')).toBe('blocked')
    expect(assistantPathKind('/dashboard/settingsevil')).toBe('blocked')
    expect(assistantPathKind('/dashboard/boards-money')).toBe('blocked')
  })
  it('refuses dot segments', () => {
    expect(assistantPathKind('/dashboard/boards/../plan')).toBe('blocked')
    expect(assistantPathKind('/dashboard/settings/../employees')).toBe('blocked')
    expect(assistantPathKind('/api/today/./x')).toBe('blocked')
  })
  it('collapses double slashes before deciding', () => {
    expect(assistantPathKind('//dashboard//plan')).toBe('blocked')
    expect(assistantPathKind('/dashboard//boards')).toBe('work')
  })
  it('ignores case', () => {
    expect(assistantPathKind('/Dashboard/Plan')).toBe('blocked')
    expect(assistantPathKind('/DASHBOARD/BOARDS')).toBe('work')
  })
  it('a query string cannot smuggle a work path', () => {
    expect(assistantPathKind('/dashboard/plan?x=/dashboard/boards')).toBe('blocked')
  })
  it('missing or relative paths are blocked', () => {
    expect(assistantPathKind(null)).toBe('blocked')
    expect(assistantPathKind(undefined)).toBe('blocked')
    expect(assistantPathKind('')).toBe('blocked')
    expect(assistantPathKind('dashboard/boards')).toBe('blocked')
  })
  it('underPrefix and isApiPath', () => {
    expect(underPrefix('/api/today', '/api/today')).toBe(true)
    expect(underPrefix('/api/today/x', '/api/today')).toBe(true)
    expect(underPrefix('/api/todayx', '/api/today')).toBe(false)
    expect(isApiPath('/api/plan')).toBe(true)
    expect(isApiPath('/apiary')).toBe(false)
    expect(isApiPath(null)).toBe(false)
  })
})

describe('pickActiveExec — the switcher', () => {
  const links = [
    { exec_member_id: 'a', exec_name: 'Mike C' },
    { exec_member_id: 'b', exec_name: 'Dana R' },
  ]
  it('uses the cookie when it is still a live link', () => expect(pickActiveExec(links, 'b')?.exec_member_id).toBe('b'))
  it('falls back to the first when the cookie points at a removed exec', () => expect(pickActiveExec(links, 'zzz')?.exec_member_id).toBe('a'))
  it('first when there is no cookie', () => expect(pickActiveExec(links, null)?.exec_member_id).toBe('a'))
  it('null with no links (removed assistant gets nothing)', () => expect(pickActiveExec([], 'a')).toBeNull())
})

describe('labels', () => {
  it('reads by {assistant} for {exec}', () => {
    expect(actingLabel('Pat Jones', 'Mike Cavaleri')).toBe('by Pat for Mike')
    expect(actingLabel('Pat', null)).toBe('by Pat')
  })
  it('shortName falls back to the email', () => {
    expect(shortName('', 'pat@x.com')).toBe('pat')
    expect(shortName(null, null)).toBe('Someone')
  })
})

describe('canHaveAssistant', () => {
  const base = { id: 'e1', rep_id: 'r1', role: 'owner', is_active: true }
  it('active owner/admin in the same org', () => {
    expect(canHaveAssistant(base, 'r1')).toBe(true)
    expect(canHaveAssistant({ ...base, role: 'admin' }, 'r1')).toBe(true)
  })
  it('never a deactivated exec, another org, a rep or an assistant', () => {
    expect(canHaveAssistant({ ...base, is_active: false }, 'r1')).toBe(false)
    expect(canHaveAssistant(base, 'r2')).toBe(false)
    expect(canHaveAssistant({ ...base, role: 'rep' }, 'r1')).toBe(false)
    expect(canHaveAssistant({ ...base, role: 'manager' }, 'r1')).toBe(false)
    expect(canHaveAssistant({ ...base, role: 'assistant' }, 'r1')).toBe(false)
    expect(canHaveAssistant(null, 'r1')).toBe(false)
  })
})

describe('canLinkAssistant', () => {
  it('a new email is fine', () => expect(canLinkAssistant(null, 'r1', 'e1')).toEqual({ ok: true }))
  it('re-linking an existing assistant in the org is fine', () => expect(canLinkAssistant({ rep_id: 'r1', role: 'assistant' }, 'r1', 'e1', 'a1')).toEqual({ ok: true }))
  it('never your own login', () => expect(canLinkAssistant({ rep_id: 'r1', role: 'owner' }, 'r1', 'e1', 'e1').ok).toBe(false))
  it('never another org\'s login', () => expect(canLinkAssistant({ rep_id: 'r2', role: 'assistant' }, 'r1', 'e1', 'x').ok).toBe(false))
  it('never turns an exec or rep login into an assistant', () => {
    expect(canLinkAssistant({ rep_id: 'r1', role: 'admin' }, 'r1', 'e1', 'x').ok).toBe(false)
    expect(canLinkAssistant({ rep_id: 'r1', role: 'rep' }, 'r1', 'e1', 'x').ok).toBe(false)
  })
})

describe('describeAction — the activity feed', () => {
  it('to-dos', () => {
    expect(describeAction('todos', { op: 'add', body: 'Call Dana' })?.summary).toBe('Added a to-do "Call Dana"')
    expect(describeAction('todos', { op: 'set', done: true })?.summary).toBe('Checked off a to-do')
    expect(describeAction('todos', { op: 'set', done: false })?.summary).toBe('Reopened a to-do')
    expect(describeAction('todos', { op: 'scan' })).toBeNull()
  })
  it('messages, boards, calendar', () => {
    expect(describeAction('messages', { op: 'send', body: 'Running late' })?.summary).toBe('Sent a message "Running late"')
    expect(describeAction('boards', { op: 'card.create', title: 'Q4 deck' })?.summary).toBe('Added a card "Q4 deck"')
    expect(describeAction('boards', { op: 'card.move' })).toBeNull()
    expect(describeAction('calendar', { op: 'add', label: 'Team' })?.summary).toBe('Added a calendar "Team"')
  })
  it('clips long text', () => {
    const s = describeAction('todos', { op: 'add', body: 'x'.repeat(200) })!.summary
    expect(s.length).toBeLessThan(100)
    expect(s.endsWith('…"')).toBe(true)
  })
})
