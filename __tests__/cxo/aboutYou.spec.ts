import { describe, expect, it } from 'vitest'
import {
  ABOUT_KEYS,
  EMPLOYEE_ROLES,
  EMPLOYEE_ROLE_CAPS,
  EXEC_ROLES,
  FOCUS_CAPS,
  FOCUS_MAX,
  FOCUS_READS,
  GENERAL_FOCUS,
  INSURANCE_FOCUS,
  ROLE_DEFAULTS,
  aboutPromptBlock,
  aboutView,
  applyAbout,
  askedRoleQuestion,
  effectiveFocus,
  focusOptionsFor,
  guessRole,
  pickAbilities,
  readAbout,
  roleLabel,
  type Flavor,
} from '@/lib/onboarding/aboutYouShared'
import { dayOneSteps, type DayOneFacts } from '@/lib/onboarding/dayOneShared'
import { CAPABILITIES, capabilityItemsFor } from '@/lib/agent/cxoCatalog'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { SET_MY_FOCUS_TOOL } from '@/lib/agent/cxoSelfServeTools'
import { TOOL_HANDLERS, toolDefsForTenant } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'

const INS: Flavor = { insurance: true, quickbooks: false }
const INS_QBO: Flavor = { insurance: true, quickbooks: true }
const GEN: Flavor = { insurance: false, quickbooks: false }
const now = new Date('2026-10-19T15:00:00Z')

const capIds = new Set(CAPABILITIES.map((c) => c.id))
const ALL_ITEMS = CAPABILITIES.map((c) => ({ id: c.id, label: c.label }))
const cxoTenant = { id: 't_test', brand: 'cxo', settings: { cxo_employee_ops: true } } as unknown as Tenant
const cxoToolNames = new Set(toolDefsForTenant(cxoTenant).map((t) => t.name))

describe('the two questions', () => {
  it('executives get the eleven roles from the brief, Other last', () => {
    expect(EXEC_ROLES.map((o) => o.label)).toEqual([
      'CEO / Founder',
      'President',
      'COO',
      'CFO',
      'CMO',
      'Chief Sales / Head of Sales',
      'Head of Recruiting',
      'VP / Director',
      'Operations / Admin',
      'Executive Assistant',
      'Other',
    ])
    expect(EMPLOYEE_ROLES.at(-1)?.id).toBe('other')
  })

  it('insurance books get the insurance chips; cash only with QuickBooks', () => {
    expect(focusOptionsFor('exec', INS_QBO)).toEqual(INSURANCE_FOCUS)
    expect(focusOptionsFor('exec', INS).map((o) => o.id)).not.toContain('cash')
    expect(focusOptionsFor('exec', INS)).toHaveLength(13)
    expect(focusOptionsFor('exec', GEN)).toEqual(GENERAL_FOCUS)
    for (const list of [focusOptionsFor('exec', INS), focusOptionsFor('exec', INS_QBO), GENERAL_FOCUS]) {
      expect(list.length).toBeGreaterThanOrEqual(12)
      expect(list.length).toBeLessThanOrEqual(15)
    }
  })

  it('employees get the role question only', () => {
    expect(focusOptionsFor('employee', INS_QBO)).toEqual([])
    const v = aboutView(readAbout({}), 'employee', INS_QBO)
    expect(v.roles).toEqual(EMPLOYEE_ROLES)
    expect(v.focusOptions).toEqual([])
    expect(v.ask).toBe(true)
  })
})

describe('readAbout / aboutView', () => {
  it('nothing stored: ask, and guess from a typed title', () => {
    const v = aboutView(readAbout({ title: 'Chief Financial Officer' }), 'exec', INS)
    expect(v).toMatchObject({ ask: true, answered: false, role: null, guess: 'cfo' })
  })

  it('skipped: never asks again', () => {
    const v = aboutView(readAbout({ [ABOUT_KEYS.skippedAt]: now.toISOString() }), 'exec', INS)
    expect(v.ask).toBe(false)
  })

  it('ignores junk in the stored focus', () => {
    const a = readAbout({ [ABOUT_KEYS.focus]: ['revenue', 7, 'revenue', 'x'.repeat(80)] })
    expect(a.focus).toEqual(['revenue'])
  })
})

describe('guessRole', () => {
  it.each([
    ['Chief Financial Officer', 'cfo'],
    ['Chief Operating Officer', 'coo'],
    ['President', 'president'],
    ['Vice President', 'vp'],
    ['VP Marketing', 'vp'],
    ['CMO', 'cmo'],
    ['Founder & CEO', 'ceo'],
    ['Head of Recruiting', 'recruiting_head'],
    ['Executive Assistant', 'ea'],
    ['', null],
    ['Wizard', null],
  ])('%s → %s', (title, want) => {
    expect(guessRole(title, 'exec')).toBe(want)
  })

  it('employee titles map to the employee list', () => {
    expect(guessRole('Commissions Specialist', 'employee')).toBe('finance')
    expect(guessRole('Licensing & Onboarding', 'employee')).toBe('recruiting')
  })
})

describe('applyAbout', () => {
  it('saves a role and picks, stamps the answer, fills an empty rail title', () => {
    const r = applyAbout({ assistant_name: 'Ada' }, { role: 'cfo', focus: ['cash', 'revenue'] }, 'exec', INS_QBO, now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.settings).toMatchObject({ assistant_name: 'Ada', [ABOUT_KEYS.role]: 'cfo', [ABOUT_KEYS.focus]: ['cash', 'revenue'], [ABOUT_KEYS.answeredAt]: now.toISOString(), title: 'CFO' })
  })

  it('never overwrites a title they typed', () => {
    const r = applyAbout({ title: 'Chief Financial Officer' }, { role: 'cfo' }, 'exec', INS, now)
    expect(r.ok && r.settings.title).toBe('Chief Financial Officer')
  })

  it('Other needs words; unknown roles are refused', () => {
    expect(applyAbout({}, { role: 'other' }, 'exec', INS, now)).toEqual({ ok: false, error: 'Type your role.' })
    expect(applyAbout({}, { role: 'wizard' }, 'exec', INS, now)).toEqual({ ok: false, error: 'Pick a role from the list.' })
    expect(applyAbout({}, { role: 'cfo' }, 'employee', INS, now)).toEqual({ ok: false, error: 'Pick a role from the list.' })
    const ok = applyAbout({}, { role: 'other', roleOther: '  Chief   Compliance Officer ' }, 'exec', INS, now)
    expect(ok.ok && roleLabel(ok.about)).toBe('Chief Compliance Officer')
  })

  it('drops chips this tenant does not offer, dedupes, caps at six', () => {
    const r = applyAbout({}, { focus: ['cash', 'revenue', 'revenue', 'pipeline', 'placement', 'carriers', 'board', 'hiring', 'calendar', 'followups'] }, 'exec', INS, now)
    expect(r.ok && r.about.focus).toEqual(['revenue', 'placement', 'carriers', 'board', 'hiring', 'calendar'])
    expect(r.ok && r.about.focus.length).toBe(FOCUS_MAX)
  })

  it('"I care more about recruiting now": adds it first, keeping what was in effect', () => {
    const start = { [ABOUT_KEYS.role]: 'cmo' }
    const r = applyAbout(start, { focusAdd: ['recruiting'] }, 'exec', INS, now)
    expect(r.ok && r.about.focus[0]).toBe('recruiting')
    // The CMO defaults were in effect, so they stay behind it.
    expect(r.ok && r.about.focus).toEqual(['recruiting', 'submitted_ap', 'top_slipping', 'agencies', 'retention'])
    const r2 = applyAbout({ [ABOUT_KEYS.focus]: ['revenue', 'cash'] }, { focusAdd: ['recruiting'], focusRemove: ['cash'] }, 'exec', INS_QBO, now)
    expect(r2.ok && r2.about.focus).toEqual(['recruiting', 'revenue'])
  })

  it('a skip only stamps the skip', () => {
    const r = applyAbout({ title: 'x' }, { skip: true }, 'exec', INS, now)
    expect(r.ok && r.settings).toEqual({ title: 'x', [ABOUT_KEYS.skippedAt]: now.toISOString() })
  })

  it('an empty patch saves nothing', () => {
    expect(applyAbout({}, {}, 'exec', INS, now)).toEqual({ ok: false, error: 'Nothing to save.' })
  })
})

describe('effectiveFocus', () => {
  it('their picks win; else their role defaults; else nothing', () => {
    expect(effectiveFocus({ role: 'cfo', focus: ['board'] }, 'exec', INS)).toEqual({ ids: ['board'], picked: true })
    expect(effectiveFocus({ role: 'cfo', focus: [] }, 'exec', INS)).toEqual({ ids: ['revenue', 'persistency', 'carriers', 'board'], picked: false })
    expect(effectiveFocus({ role: 'cfo', focus: [] }, 'exec', INS_QBO).ids).toContain('cash')
    expect(effectiveFocus({ role: null, focus: [] }, 'exec', INS)).toEqual({ ids: [], picked: false })
  })

  it('every role default is a chip on that list', () => {
    for (const [kind, map] of Object.entries(ROLE_DEFAULTS)) {
      const ids = new Set((kind === 'insurance' ? INSURANCE_FOCUS : GENERAL_FOCUS).map((o) => o.id))
      for (const [role, picks] of Object.entries(map)) {
        expect(EXEC_ROLES.some((o) => o.id === role)).toBe(true)
        for (const p of picks) expect(ids.has(p), `${kind}.${role}: ${p}`).toBe(true)
      }
    }
  })
})

describe('(a) abilities picked by role and picks', () => {
  it('every focus and employee role points at real capabilities', () => {
    for (const ids of [...Object.values(FOCUS_CAPS), ...Object.values(EMPLOYEE_ROLE_CAPS)]) for (const id of ids) expect(capIds.has(id), id).toBe(true)
    for (const o of [...INSURANCE_FOCUS, ...GENERAL_FOCUS]) expect(FOCUS_CAPS[o.id], o.id).toBeDefined()
  })

  it('a CMO and a CFO get different first picks', () => {
    const cmo = pickAbilities(ALL_ITEMS, { role: 'cmo', focus: [] }, 'exec', INS).slice(0, 4).map((x) => x.id)
    const cfo = pickAbilities(ALL_ITEMS, { role: 'cfo', focus: [] }, 'exec', INS_QBO).slice(0, 4).map((x) => x.id)
    expect(cmo[0]).toBe('producers')
    expect(cmo).toContain('people')
    expect(cfo[0]).toBe('revenue')
    expect(cfo).toContain('finance')
    expect(cmo).not.toEqual(cfo)
  })

  it('only orders; nothing added or dropped', () => {
    const out = pickAbilities(ALL_ITEMS, { role: 'coo', focus: ['calendar'] }, 'exec', GEN)
    expect(out).toHaveLength(ALL_ITEMS.length)
    expect(new Set(out.map((x) => x.id))).toEqual(capIds)
    expect(out[0].id).toBe('calendar')
  })

  it('no answer keeps the catalog order', () => {
    expect(pickAbilities(ALL_ITEMS, { role: null, focus: [] }, 'exec', INS)).toEqual(ALL_ITEMS)
  })

  it('employees are ordered by their role', () => {
    const items = ALL_ITEMS.filter((c) => ['todos', 'calendar', 'my_quota', 'sheets', 'messages'].includes(c.id))
    expect(pickAbilities(items, { role: 'finance', focus: [] }, 'employee', INS)[0].id).toBe('my_quota')
    expect(pickAbilities(items, { role: 'ea', focus: [] }, 'employee', INS)[0].id).toBe('calendar')
  })

  it('capabilityItemsFor keeps uncatalogued tools as their own lines', () => {
    const items = capabilityItemsFor([{ name: 'list_my_todos' }, { name: 'brand_new_tool', description: 'Does a new thing. More words.' }])
    expect(items.map((i) => i.id)).toEqual(['todos', 'tool:brand_new_tool'])
  })

  it('the first-day step says who it was picked for', () => {
    const facts: DayOneFacts = { employeeOnly: false, role: 'admin', hasEmployeeRow: false, managerName: null, calendarConnected: true, inbox: false, oneOnOneDate: null, hasOneOnOne: false, todoCount: 1, abilitiesSeen: false }
    const withRole = dayOneSteps(facts, { home: '/dashboard', abilities: ['a', 'b'], roleLabel: 'CFO' }).find((s) => s.id === 'abilities')
    const without = dayOneSteps(facts, { home: '/dashboard', abilities: ['a', 'b'] }).find((s) => s.id === 'abilities')
    expect(without?.detail).toBe('2 things, picked for your role.')
    expect(withRole?.detail).toBe('2 things, picked for you as CFO.')
  })
})

describe('(b) the prompt block', () => {
  const tools = cxoToolNames

  it('every read it suggests is a real Suite CXO tool', () => {
    for (const reads of Object.values(FOCUS_READS)) for (const r of reads) expect(cxoToolNames.has(r.tool) || ['pinnacle_revenue', 'whats_slipping'].includes(r.tool), r.tool).toBe(true)
  })

  it('a CFO leads with money, a CMO with recruiting and production', () => {
    const cfo = aboutPromptBlock(readAbout({ [ABOUT_KEYS.role]: 'cfo' }), { who: 'exec', flavor: INS_QBO, tools, firstName: 'Marcus', canSave: true })!
    const cmo = aboutPromptBlock(readAbout({ [ABOUT_KEYS.role]: 'cmo' }), { who: 'exec', flavor: INS, tools, firstName: 'Owen', canSave: true })!
    expect(cfo.text).toContain('## About Marcus')
    expect(cfo.text).toContain('role CFO; as a CFO, likely cares most about Revenue & commissions, Cash & expenses')
    expect(cfo.text).toContain('lead with Revenue & commissions, Cash & expenses, Persistency & lapses')
    expect(cfo.text).toContain('quickbooks_financials')
    expect(cmo.text).toContain('lead with New agents & recruiting, Submitted AP & production, Top & slipping agents')
    expect(cmo.text).toContain('producer_production view=new period=qtd')
    expect(cfo.askOnce).toBe(false)
    expect(cfo.text).toContain('set_my_focus')
  })

  it('their own picks are "cares most about"', () => {
    const b = aboutPromptBlock(readAbout({ [ABOUT_KEYS.role]: 'coo', [ABOUT_KEYS.focus]: ['carriers'] }), { who: 'exec', flavor: INS, tools, firstName: 'Dana', canSave: true })!
    expect(b.text).toContain('- About this person: role COO; cares most about Carrier mix.')
  })

  it('reads are only suggested when the caller has the tool', () => {
    const b = aboutPromptBlock(readAbout({ [ABOUT_KEYS.role]: 'cfo' }), { who: 'exec', flavor: INS_QBO, tools: new Set(['payroll']), firstName: 'M', canSave: false })!
    expect(b.text).not.toContain('quickbooks_financials')
    expect(b.text).toContain('payroll view=summary')
    expect(b.text).not.toContain('set_my_focus')
  })

  it('employees get the About line, not the exec lead-with line', () => {
    const b = aboutPromptBlock(readAbout({ [ABOUT_KEYS.role]: 'finance' }), { who: 'employee', flavor: INS, tools, firstName: 'Iris', canSave: true })!
    expect(b.text).toContain('role Finance / Commissions')
    expect(b.text).not.toContain('Open-ended asks')
  })

  it('(c) unanswered: may ask once; never after it asked or they skipped', () => {
    const fresh = aboutPromptBlock(readAbout({}), { who: 'exec', flavor: INS, tools, firstName: 'J', canSave: true })!
    expect(fresh.askOnce).toBe(true)
    expect(fresh.text).toContain("By the way, what's your role? I'll lead with what matters to you.")
    expect(aboutPromptBlock(readAbout({ [ABOUT_KEYS.askedAt]: now.toISOString() }), { who: 'exec', flavor: INS, tools, firstName: 'J', canSave: true })).toBeNull()
    expect(aboutPromptBlock(readAbout({ [ABOUT_KEYS.skippedAt]: now.toISOString() }), { who: 'exec', flavor: INS, tools, firstName: 'J', canSave: true })).toBeNull()
    expect(aboutPromptBlock(readAbout({}), { who: 'exec', flavor: INS, tools, firstName: 'J', canSave: false })).toBeNull()
    const titled = aboutPromptBlock(readAbout({ title: 'President', [ABOUT_KEYS.askedAt]: 'x' }), { who: 'exec', flavor: INS, tools, firstName: 'J', canSave: true })!
    expect(titled.text).toContain('title President')
    expect(titled.askOnce).toBe(false)
    const titledFresh = aboutPromptBlock(readAbout({ title: 'President' }), { who: 'exec', flavor: INS, tools, firstName: 'J', canSave: true })!
    expect(titledFresh.askOnce).toBe(true)
    expect(titledFresh.text).toContain("you're down as President. What do you want me to lead with")
  })

  it('spots the one-time question in a reply', () => {
    expect(askedRoleQuestion("Revenue is up 4%. By the way, what's your role? I'll lead with what matters to you.")).toBe(true)
    expect(askedRoleQuestion('What is your title, so I can tailor this?')).toBe(true)
    expect(askedRoleQuestion("By the way, I have you as COO \u2014 anything you'd like me to lead with in these rundowns?")).toBe(true)
    expect(askedRoleQuestion('What do you want me to keep an eye on?')).toBe(true)
    expect(askedRoleQuestion('Your role on the board is noted.')).toBe(false)
    expect(askedRoleQuestion('Revenue leads with $1.2M. Want me to dig into the placement dip?')).toBe(false)
  })
})

describe('set_my_focus', () => {
  it('is a Suite CXO tool with a handler, on the employee allow-list', () => {
    expect(cxoToolNames.has('set_my_focus')).toBe(true)
    expect(typeof TOOL_HANDLERS.set_my_focus).toBe('function')
    expect(EMPLOYEE_TOOLS.has('set_my_focus')).toBe(true)
    expect(CAPABILITIES.find((c) => c.id === 'memory')?.tools).toContain('set_my_focus')
  })

  it('names every role and chip id the model may use', () => {
    for (const o of [...EXEC_ROLES, ...EMPLOYEE_ROLES, ...INSURANCE_FOCUS, ...GENERAL_FOCUS]) expect(SET_MY_FOCUS_TOOL.description).toContain(o.id)
  })

  it('is not offered outside Suite CXO', () => {
    const vc = toolDefsForTenant({ id: 't_vc', brand: 'virtualcloser' } as unknown as Tenant).map((t) => t.name)
    expect(vc).not.toContain('set_my_focus')
  })
})
