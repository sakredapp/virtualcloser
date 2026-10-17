import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ONBOARD_PREFIX,
  allDone,
  cleanTodo,
  dayOneSteps,
  doneCount,
  firstDayOver,
  isNewMember,
  joinedAt,
  managerNoticeText,
  managerStepsApply,
  readyKey,
  welcomeKey,
  welcomeNoticeText,
  type DayOneFacts,
} from '@/lib/onboarding/dayOneShared'
import { ALWAYS_SHOWN_PREFIXES, ONBOARDING_NOTICE_PREFIX, actionsFor } from '@/lib/followups/noticeActionsShared'
import { employeePathAllowed } from '@/lib/employees/access'
import { onboardingOn } from '@/lib/onboarding/dayOne'

const base: DayOneFacts = {
  employeeOnly: true,
  role: 'rep',
  hasEmployeeRow: true,
  managerName: 'Dana Reyes',
  calendarConnected: false,
  inbox: false,
  oneOnOneDate: null,
  hasOneOnOne: false,
  todoCount: 0,
  abilitiesSeen: false,
}
const home = '/dashboard/me'

describe('who is new', () => {
  const now = new Date('2026-10-17T15:00:00Z')
  it('joined in the last two weeks counts; long-time logins never do', () => {
    expect(isNewMember({ created_at: '2026-10-10T09:00:00Z' }, now)).toBe(true)
    expect(isNewMember({ created_at: '2026-09-01T09:00:00Z' }, now)).toBe(false)
    expect(isNewMember({ created_at: null }, now)).toBe(false)
  })
  it('a re-invite starts the clock again', () => {
    expect(joinedAt({ created_at: '2026-01-01T00:00:00Z', invited_at: '2026-10-16T00:00:00Z' })).toBe('2026-10-16T00:00:00.000Z')
    expect(isNewMember({ created_at: '2026-01-01T00:00:00Z', invited_at: '2026-10-16T00:00:00Z' }, now)).toBe(true)
  })
  it('the first day is over a full day after they first signed in, never before they sign in', () => {
    expect(firstDayOver({ created_at: '2026-10-15T00:00:00Z', last_login_at: null, accepted_at: null }, now)).toBe(false)
    expect(firstDayOver({ created_at: '2026-10-15T00:00:00Z', accepted_at: '2026-10-16T16:00:00Z' }, now)).toBe(false)
    expect(firstDayOver({ created_at: '2026-10-15T00:00:00Z', accepted_at: '2026-10-16T14:00:00Z' }, now)).toBe(true)
  })
})

describe('the checklist', () => {
  it('an employee gets all five steps, each open one with a single action', () => {
    const steps = dayOneSteps(base, { home, abilities: ['a', 'b'] })
    expect(steps.map((s) => s.id)).toEqual(['calendar', 'abilities', 'manager', 'one_on_one', 'first_todo'])
    expect(doneCount(steps)).toBe(1) // manager is on record
    const cal = steps.find((s) => s.id === 'calendar')!
    expect(cal.action).toEqual({ kind: 'link', label: 'Connect Google', href: '/api/google/oauth/start?return=%2Fdashboard%2Fme' })
    expect(cal.title).toBe('Connect your Google calendar')
    expect(steps.find((s) => s.id === 'one_on_one')!.action).toMatchObject({ kind: 'ask', label: 'Ask Dana' })
    expect(steps.find((s) => s.id === 'first_todo')!.action).toEqual({ kind: 'todo', label: 'Add' })
    expect(steps.find((s) => s.id === 'abilities')!.detail).toBe('2 things, picked for your role.')
  })
  it('email is named only on the Pinnacle edition', () => {
    expect(dayOneSteps({ ...base, inbox: true }, { home })[0].title).toBe('Connect your Google calendar and email')
    for (const s of dayOneSteps(base, { home })) expect(`${s.title} ${s.detail}`).not.toMatch(/email|gmail|inbox/i)
  })
  it('an owner with no manager never sees the manager or 1:1 steps', () => {
    const f = { ...base, employeeOnly: false, role: 'owner', hasEmployeeRow: false, managerName: null }
    expect(managerStepsApply(f)).toBe(false)
    expect(dayOneSteps(f, { home: '/dashboard' }).map((s) => s.id)).toEqual(['calendar', 'abilities', 'first_todo'])
  })
  it('an employee with no manager on record is asked to tell an admin', () => {
    const steps = dayOneSteps({ ...base, managerName: null }, { home })
    expect(steps.find((s) => s.id === 'manager')).toMatchObject({ done: false, action: { kind: 'ask' } })
    expect(steps.find((s) => s.id === 'one_on_one')!.action).toBeNull()
  })
  it('is done only when every step is', () => {
    const all = { ...base, calendarConnected: true, abilitiesSeen: true, hasOneOnOne: true, oneOnOneDate: '2026-10-21', todoCount: 1 }
    const steps = dayOneSteps(all, { home })
    expect(allDone(steps)).toBe(true)
    expect(steps.every((s) => s.action === null)).toBe(true)
    expect(steps.find((s) => s.id === 'one_on_one')!.detail).toBe('Set for Wed, Oct 21.')
    expect(allDone(dayOneSteps({ ...all, todoCount: 0 }, { home }))).toBe(false)
  })
  it('user-facing copy has no em dashes', () => {
    const steps = dayOneSteps(base, { home })
    const text = [...steps.flatMap((s) => [s.title, s.detail]), managerNoticeText('Ana', steps).body, welcomeNoticeText('Ana', steps)!.body].join(' ')
    expect(text).not.toContain('—')
  })
})

describe('notices', () => {
  it('welcome lists what is left, and is null when nothing is', () => {
    const t = welcomeNoticeText('Ana', dayOneSteps(base, { home }))!
    expect(t.title).toBe('Welcome, Ana. Your first day with Ciao')
    expect(t.body).toContain('4 quick steps')
    expect(t.body).toContain('- Add your first to-do')
    const done = dayOneSteps({ ...base, calendarConnected: true, abilitiesSeen: true, hasOneOnOne: true, todoCount: 2 }, { home })
    expect(welcomeNoticeText('Ana', done)).toBeNull()
  })
  it('the manager hears "<name> is set up", or what is left after the first day', () => {
    const done = dayOneSteps({ ...base, calendarConnected: true, abilitiesSeen: true, hasOneOnOne: true, todoCount: 2 }, { home })
    expect(managerNoticeText('Ana Ruiz', done).title).toBe('Ana Ruiz is set up')
    const part = managerNoticeText('Ana Ruiz', dayOneSteps({ ...base, calendarConnected: true }, { home }))
    expect(part.title).toBe("Ana Ruiz's first day: 2 of 5 set up")
    expect(part.body.indexOf('Still open')).toBe(0)
    expect(part.body).toContain('No 1:1 on the calendar yet')
  })
  it('one key per person, shown with the employee-ops switch off, no one-tap action', () => {
    expect(ONBOARD_PREFIX).toBe(ONBOARDING_NOTICE_PREFIX)
    expect(ALWAYS_SHOWN_PREFIXES).toContain(ONBOARD_PREFIX)
    expect(welcomeKey('m1')).toBe('onboard-welcome-m1')
    expect(readyKey('m1')).toBe('onboard-ready-m1')
    expect(actionsFor({ key: readyKey('m1'), item_id: 'm1' })).toEqual([])
  })
  it('cleans a to-do', () => {
    expect(cleanTodo('  Meet\n the  team ')).toBe('Meet the team')
    expect(cleanTodo(5)).toBe('')
  })
})

describe('wiring', () => {
  it('an employee login can reach its checklist and connect its own Google', () => {
    expect(employeePathAllowed('/api/employees/me/onboarding')).toBe(true)
    expect(employeePathAllowed('/api/google/oauth/start')).toBe(true)
    expect(employeePathAllowed('/api/google/oauth/callback')).toBe(true)
    expect(employeePathAllowed('/api/google/disconnect')).toBe(false)
  })
  it('is on unless switched off', () => {
    expect(onboardingOn({})).toBe(true)
    expect(onboardingOn({ CXO_ONBOARDING: 'off' })).toBe(false)
  })
  it('runs on the Hetzner worker tick, deploys with it, and shows on both homes', () => {
    const worker = fs.readFileSync('hetzner-worker/index.ts', 'utf8')
    expect(worker).toContain("import { runOnboardingTick } from '../lib/onboarding/dayOne'")
    expect(worker).toMatch(/CXO_ONBOARDING_EVERY_N_TICKS \?\? '20'/)
    expect(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8')).toContain("- 'lib/onboarding/**'")
    expect(fs.readFileSync('vercel.json', 'utf8')).not.toMatch(/onboarding/)
    expect(fs.readFileSync('app/dashboard/me/page.tsx', 'utf8')).toContain('<DayOneCard />')
    expect(fs.readFileSync('app/dashboard/CxoToday.tsx', 'utf8')).toMatch(/!ownerName && \(\s*<div className="cx-today-strip">\s*<DayOneCard \/>/)
  })
  it('never sends email or calls a model', () => {
    const src = fs.readFileSync('lib/onboarding/dayOne.ts', 'utf8')
    expect(src).not.toMatch(/sendEmail|emailNotices|aiProvider|anthropic|openrouter/i)
  })
})
