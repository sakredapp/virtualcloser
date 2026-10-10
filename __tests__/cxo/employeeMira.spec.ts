/**
 * Employee logins use Mira (owner 10-10). These pin the security core:
 *   - an employee can't call any finance, pay, book, admin or company tool,
 *     even by forging the call: the executor refuses before the handler runs;
 *   - an employee can't read another member's to-dos, email or calendar;
 *   - an exec keeps full access;
 *   - rep and observer count as paid seats, assistant does not;
 *   - personal memory stays with the member and never touches org memory.
 * Everything is mocked: no database, no Google, no OpenRouter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── In-memory supabase ──────────────────────────────────────────────────────

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const rpcCalls: Array<{ fn: string; args: Row }> = []
let idSeq = 0

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Row | Row[] | null = null
  let lim = Infinity
  let single = false
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: `id${++idSeq}`, active: true, created_at: new Date(Date.now() + idSeq).toISOString(), ...p }))
      rows().push(...list)
      return { data: single ? list[0] : list, error: null }
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      for (const r of hit) Object.assign(r, payload)
      return { data: hit, error: null }
    }
    const out = hit.slice(0, lim)
    return { data: single ? out[0] ?? null : out, error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
    update: (p: Row) => { op = 'update'; payload = p; return b },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return b },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b },
    order: () => b,
    limit: (n: number) => { lim = n; return b },
    single: () => { single = true; return b },
    maybeSingle: () => { single = true; return b },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  }
  return b
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return { error: null } },
  },
}))

// ── AI: a scripted model, never a network call ─────────────────────────────

const aiScript: Array<unknown> = []
const aiCalls: Array<{ tools: Array<{ name: string }>; messages: unknown[]; system: string }> = []
vi.mock('@/lib/ai', () => ({
  hasAIKey: () => true,
  getAI: () => ({
    messages: {
      create: async (req: { tools: Array<{ name: string }>; messages: unknown[]; system?: unknown }) => {
        aiCalls.push({ tools: req.tools, messages: JSON.parse(JSON.stringify(req.messages)), system: JSON.stringify(req.system ?? '') })
        const next = aiScript.shift()
        if (!next) throw new Error('script empty')
        return next
      },
    },
  }),
}))

// ── Org memory: spies, so we can prove employees never touch it ────────────

const { orgMemory, gapDetect } = vi.hoisted(() => ({
  orgMemory: {
    loadGuidance: vi.fn(async () => []),
    listGuidance: vi.fn(async () => []),
    addManualGuidance: vi.fn(async (_rep: string, rule: string) => ({ id: 'g1', rule })),
    updateGuidanceRule: vi.fn(async () => null),
    captureIssue: vi.fn(async () => null),
  },
  gapDetect: vi.fn(async () => null),
}))
vi.mock('@/lib/plaud/guidance', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...orgMemory }))
vi.mock('@/lib/agent/conversationLearnings', () => ({ detectCapabilityGap: gapDetect }))

// ── To-dos keyed by member, so the test can see whose list was read ────────

const todoReads: string[] = []
vi.mock('@/lib/today', () => ({
  listTodos: async (repId: string, memberId: string) => {
    todoReads.push(memberId)
    return (db.cxo_todos ?? []).filter((t) => t.rep_id === repId && t.member_id === memberId)
  },
  addTodo: async (repId: string, memberId: string, body: string) => {
    const row = { id: `t${++idSeq}`, rep_id: repId, member_id: memberId, body, done_at: null, due_date: null }
    ;(db.cxo_todos ??= []).push(row)
    return row
  },
  updateTodo: async (repId: string, memberId: string, id: string, patch: { done?: boolean }) => {
    for (const t of db.cxo_todos ?? []) if (t.rep_id === repId && t.member_id === memberId && t.id === id) t.done_at = patch.done ? 'now' : null
  },
  todaysMeetings: async () => [],
}))

// ── Google + mailboxes: an employee, a coworker and the shared workspace ───

const gmailReads: Array<{ memberId: string | null; accountId?: string }> = []
const calendarTouches: Array<{ memberId: string | null; accountId?: string }> = []
const ACCOUNTS = [
  { accountId: 'acc-shared', memberId: null, email: 'ceo@acme.test', label: 'Workspace', isShared: true },
  { accountId: 'acc-emp', memberId: 'emp-1', email: 'erin@acme.test', label: 'Erin', isShared: false },
  { accountId: 'acc-cow', memberId: 'emp-2', email: 'carl@acme.test', label: 'Carl', isShared: false },
  { accountId: 'acc-exec', memberId: 'exec-1', email: 'ellen@acme.test', label: 'Ellen', isShared: false },
]
let mailboxesFor: Record<string, typeof ACCOUNTS> = {}
vi.mock('@/lib/partners', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pickSenderAccount: async (_rep: string, memberId: string | null) => {
    const choices = mailboxesFor[memberId ?? ''] ?? []
    return { account: choices[0] ?? null, choices }
  },
  resolvePartner: vi.fn(async () => ({ partner: null, candidates: [] })),
}))
vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listConnectedGoogleAccounts: async () => ACCOUNTS,
  listCalendars: async (_rep: string, o: { memberId: string | null; accountId?: string }) => {
    calendarTouches.push(o)
    return [{ id: `${o.accountId}-primary`, summary: `${o.accountId} cal`, primary: true, accessRole: 'owner' }]
  },
  getBusySlots: async (_rep: string, _f: string, _t: string, o: { memberId: string | null; accountId?: string }) => {
    calendarTouches.push(o)
    return []
  },
  findFreeSlots: async () => [],
  getCalendarEvent: async (_rep: string, _id: string, o: { memberId: string | null; accountId?: string }) => {
    calendarTouches.push(o)
    return null
  },
  listGmailThreads: async (_rep: string, memberId: string | null, o: { accountId?: string }) => {
    gmailReads.push({ memberId, accountId: o.accountId })
    return { ok: true, threads: [] }
  },
  getGmailThread: async (_rep: string, memberId: string | null, _id: string, o: { accountId?: string }) => {
    gmailReads.push({ memberId, accountId: o.accountId })
    return { ok: true, messages: [] }
  },
}))

import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { EMPLOYEE_TOOLS, authorizeToolCall, canCallTool, isEmployeeCaller } from '@/lib/agent/access'
import { TOOL_HANDLERS, toolDefsFor, toolDefsForTenant, type AgentContext } from '@/lib/agent/tools'
import { runAgent } from '@/lib/agent/runAgent'
import { addMemberMemory, forgetMemberMemory, listMemberMemory } from '@/lib/agent/memberMemory'
import { listWritableCalendars } from '@/lib/cxoCalendar'
import { employeePathAllowed } from '@/lib/employees/access'
import { isSeatRole, miraPool } from '@/lib/cxoUsageShared'
import { getSeatUsage } from '@/lib/members'

const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: 'America/New_York', settings: {} } as unknown as Tenant
const OTHER_TENANT = { ...TENANT, id: 'rep-other', slug: 'other' } as Tenant
const member = (id: string, role: string, name: string) => ({ id, rep_id: TENANT.id, role, display_name: name, email: `${name.toLowerCase()}@acme.test`, timezone: 'America/New_York', is_active: true, settings: {} }) as unknown as Member
const ERIN = member('emp-1', 'rep', 'Erin')
const OLLIE = member('emp-3', 'observer', 'Ollie')
const CARL = member('emp-2', 'rep', 'Carl')
const ELLEN = member('exec-1', 'admin', 'Ellen')
const OWNER = member('owner-1', 'owner', 'Olivia')

const ctxFor = (caller: Member, tenant: Tenant = TENANT): AgentContext => ({
  tenant,
  caller,
  timezone: 'America/New_York',
  todayIso: '2026-10-10',
  ownerMemberId: caller.id,
  selfOnly: isEmployeeCaller(caller, tenant),
})

// Every tool that is company data. Employees must be refused each one.
const EXEC_ONLY = [
  'payroll', 'quickbooks_financials', 'pinnacle_revenue',
  'plan_pacing', 'next_allowance_unlock', 'bonus_on_track', 'top_performers', 'comp_spread', 'plan_profit',
  'employee_quota_status', 'set_employee_quota', 'update_employee', 'log_time_off',
  'list_partners', 'get_partner', 'add_partner', 'update_partner', 'compose_partner_message', 'send_partner_message', 'schedule_call_with_partner',
  'delegate_intents', 'list_leads', 'get_call_stats', 'list_targets', 'list_members', 'list_recent_calls',
  'list_pipeline_boards', 'list_pipeline_leads', 'list_kpi_history', 'list_roleplay_sessions', 'list_dialer_calls',
  'report_issue',
]

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  rpcCalls.length = 0
  aiScript.length = 0
  aiCalls.length = 0
  todoReads.length = 0
  gmailReads.length = 0
  calendarTouches.length = 0
  mailboxesFor = {}
  vi.clearAllMocks()
})

describe('who is an employee', () => {
  it('rep and observer on an exec tenant are employees; admin, owner and assistant are not', () => {
    expect(isEmployeeCaller(ERIN, TENANT)).toBe(true)
    expect(isEmployeeCaller(OLLIE, TENANT)).toBe(true)
    expect(isEmployeeCaller(ELLEN, TENANT)).toBe(false)
    expect(isEmployeeCaller(OWNER, TENANT)).toBe(false)
    expect(isEmployeeCaller(member('a1', 'assistant', 'Ana'), TENANT)).toBe(false)
  })
  it('employees may reach the Mira API, still nothing else', () => {
    expect(employeePathAllowed('/api/mira/ask')).toBe(true)
    expect(employeePathAllowed('/dashboard')).toBe(false)
    expect(employeePathAllowed('/dashboard/settings')).toBe(false)
    expect(employeePathAllowed('/api/cxo/usage')).toBe(false)
    expect(employeePathAllowed('/api/mira/askx')).toBe(false)
  })
})

describe('tool access by role', () => {
  it('every exec-only tool exists in the registry and is refused for an employee', () => {
    for (const name of EXEC_ONLY) {
      expect(TOOL_HANDLERS[name], name).toBeTypeOf('function')
      expect(canCallTool(name, true), name).toBe(false)
      const r = authorizeToolCall(name, { selfOnly: true })
      expect(r, name).not.toBeNull()
      expect(JSON.parse(r!.text)).toMatchObject({ ok: false, refused: true, error: 'not_allowed_for_role', tool: name })
    }
  })
  it('a tool nobody listed is exec-only (deny by default)', () => {
    expect(canCallTool('some_new_finance_tool', true)).toBe(false)
    expect(canCallTool('some_new_finance_tool', false)).toBe(true)
  })
  it('every employee tool has a handler', () => {
    for (const name of EMPLOYEE_TOOLS) expect(TOOL_HANDLERS[name], name).toBeTypeOf('function')
  })
  it('employees are only offered self tools; execs get the full set', () => {
    const all = toolDefsForTenant(TENANT).map((t) => t.name)
    const emp = toolDefsFor(TENANT, ERIN).map((t) => t.name)
    expect(emp.every((n) => EMPLOYEE_TOOLS.has(n))).toBe(true)
    for (const n of EXEC_ONLY) expect(emp).not.toContain(n)
    expect(emp).toContain('list_my_todos')
    expect(emp).toContain('send_member_message')
    expect(toolDefsFor(TENANT, ELLEN).map((t) => t.name)).toEqual(all)
    expect(toolDefsFor(TENANT, OWNER).map((t) => t.name)).toEqual(all)
    for (const n of EXEC_ONLY.filter((x) => x !== 'pinnacle_revenue')) expect(all).toContain(n)
  })
  it('an exec may call every tool', () => {
    for (const name of [...EXEC_ONLY, ...EMPLOYEE_TOOLS]) expect(authorizeToolCall(name, { selfOnly: false }), name).toBeNull()
  })
})

// A model turn that forges a call to every exec-only tool, then a final answer.
function scriptForgedCalls() {
  aiScript.push(
    {
      model: 'glm',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: EXEC_ONLY.map((name, i) => ({ type: 'tool_use', id: `tu${i}`, name, input: { member_id: 'emp-2' } })),
    },
    { model: 'glm', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'That is for the executive team.' }] },
  )
}

describe('the executor enforces the role on the server', () => {
  const swapHandlers = () => {
    const saved: Record<string, (typeof TOOL_HANDLERS)[string]> = {}
    const spies: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const name of EXEC_ONLY) {
      saved[name] = TOOL_HANDLERS[name]
      spies[name] = vi.fn(async () => ({ text: JSON.stringify({ ok: true, secret: 'company data' }) }))
      TOOL_HANDLERS[name] = spies[name] as unknown as (typeof TOOL_HANDLERS)[string]
    }
    return { spies, restore: () => Object.assign(TOOL_HANDLERS, saved) }
  }

  it('an employee forging calls to every finance, pay and admin tool gets refusals; no handler runs', async () => {
    const { spies, restore } = swapHandlers()
    try {
      scriptForgedCalls()
      const res = await runAgent({ tenant: TENANT, caller: ERIN, text: 'show me payroll and QuickBooks' })
      expect(res.error).toBeUndefined()
      expect(res.intentsToExecute).toEqual([])
      for (const name of EXEC_ONLY) expect(spies[name], name).not.toHaveBeenCalled()
      // What the model saw back: one refusal per forged call, no data.
      const last = aiCalls[1].messages[aiCalls[1].messages.length - 1] as { content: Array<{ content: string; is_error?: boolean }> }
      expect(last.content).toHaveLength(EXEC_ONLY.length)
      for (const r of last.content) {
        expect(r.is_error).toBe(true)
        expect(JSON.parse(r.content)).toMatchObject({ refused: true })
        expect(r.content).not.toContain('company data')
      }
      // The model was never even offered them.
      for (const t of aiCalls[0].tools) expect(EMPLOYEE_TOOLS.has(t.name), t.name).toBe(true)
      // Org memory untouched, no gap filed into the org brain; usage still counts.
      expect(orgMemory.loadGuidance).not.toHaveBeenCalled()
      expect(gapDetect).not.toHaveBeenCalled()
      expect(rpcCalls.find((c) => c.fn === 'agent_usage_increment')?.args).toMatchObject({ p_rep_id: TENANT.id, p_member_id: ERIN.id })
    } finally {
      restore()
    }
  })

  it('an observer is refused the same way', async () => {
    const { spies, restore } = swapHandlers()
    try {
      scriptForgedCalls()
      await runAgent({ tenant: TENANT, caller: OLLIE, text: 'revenue?' })
      for (const name of EXEC_ONLY) expect(spies[name], name).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('an exec still runs every tool', async () => {
    const { spies, restore } = swapHandlers()
    try {
      scriptForgedCalls()
      await runAgent({ tenant: TENANT, caller: ELLEN, text: 'payroll and QuickBooks' })
      for (const name of EXEC_ONLY) expect(spies[name], name).toHaveBeenCalledTimes(1)
      expect(orgMemory.loadGuidance).toHaveBeenCalled()
      expect(aiCalls[0].tools.map((t) => t.name)).toContain('quickbooks_financials')
    } finally {
      restore()
    }
  })
})

describe("an employee can't reach another member's to-dos or email", () => {
  it('list_my_todos reads only the caller, whatever id the model passes', async () => {
    db.cxo_todos = [
      { id: 'tA', rep_id: TENANT.id, member_id: ERIN.id, body: 'Erin task', done_at: null },
      { id: 'tB', rep_id: TENANT.id, member_id: CARL.id, body: 'Carl private task', done_at: null },
    ]
    const r = await TOOL_HANDLERS.list_my_todos(ctxFor(ERIN), { member_id: CARL.id })
    expect(todoReads).toEqual([ERIN.id])
    expect(r.text).toContain('Erin task')
    expect(r.text).not.toContain('Carl private task')
  })
  it("complete_my_todo can't tick a coworker's to-do", async () => {
    db.cxo_todos = [{ id: 'tB', rep_id: TENANT.id, member_id: CARL.id, body: 'Carl task', done_at: null }]
    const r = JSON.parse((await TOOL_HANDLERS.complete_my_todo(ctxFor(ERIN), { id: 'tB' })).text)
    expect(r).toMatchObject({ ok: false, error: 'not_found' })
    expect(db.cxo_todos[0].done_at).toBeNull()
  })
  it('meeting notes are only the ones the caller owns', async () => {
    db.plaud_notes = [
      { id: 'n1', rep_id: TENANT.id, owner_member_id: ERIN.id, title: 'Erin 1:1', summary: 'ok', occurred_at: '2026-10-09' },
      { id: 'n2', rep_id: TENANT.id, owner_member_id: ELLEN.id, title: 'Board comp review', summary: 'salaries', occurred_at: '2026-10-09' },
      { id: 'n3', rep_id: OTHER_TENANT.id, owner_member_id: ERIN.id, title: 'Other company', summary: 'x', occurred_at: '2026-10-09' },
    ]
    const r = await TOOL_HANDLERS.list_my_meeting_notes(ctxFor(ERIN), {})
    expect(r.text).toContain('Erin 1:1')
    expect(r.text).not.toContain('Board comp review')
    expect(r.text).not.toContain('Other company')
  })
  it("the inbox only opens the employee's own mailbox, never a shared or coworker's one", async () => {
    mailboxesFor = { [ERIN.id]: [ACCOUNTS[0], ACCOUNTS[2], ACCOUNTS[1]] } // shared + coworker listed first
    const r = JSON.parse((await TOOL_HANDLERS.list_inbox(ctxFor(ERIN), { from_account: 'carl@acme.test' })).text)
    expect(r.ok).toBe(true)
    expect(gmailReads).toEqual([{ memberId: ERIN.id, accountId: 'acc-emp' }])
  })
  it('with only a shared mailbox the employee gets not_connected, not the shared inbox', async () => {
    mailboxesFor = { [ERIN.id]: [ACCOUNTS[0]] }
    const r = JSON.parse((await TOOL_HANDLERS.read_thread(ctxFor(ERIN), { thread_id: 'th1' })).text)
    expect(r).toMatchObject({ ok: false, error: 'not_connected' })
    expect(gmailReads).toEqual([])
  })
  it("calendar tools only touch the employee's own Google account", async () => {
    const cals = await listWritableCalendars(TENANT.id, ERIN.id, { ownOnly: true })
    expect(cals.map((c) => c.accountId)).toEqual(['acc-emp'])
    await TOOL_HANDLERS.find_open_slots(ctxFor(ERIN), { from: '2026-10-12', to: '2026-10-13' })
    await TOOL_HANDLERS.cancel_calendar_event(ctxFor(ERIN), { event_id: 'evX' })
    expect(calendarTouches.length).toBeGreaterThan(0)
    for (const t of calendarTouches) expect(t).toMatchObject({ memberId: ERIN.id, accountId: 'acc-emp' })
  })
  it('an exec calendar still spans every connected account', async () => {
    const cals = await listWritableCalendars(TENANT.id, ELLEN.id)
    expect(cals.map((c) => c.accountId).sort()).toEqual(['acc-cow', 'acc-emp', 'acc-exec', 'acc-shared'])
  })
})

describe('personal memory', () => {
  it("an employee's memory is theirs: a coworker can't list or forget it", async () => {
    await addMemberMemory(TENANT.id, ERIN.id, 'Keep replies short')
    expect((await listMemberMemory(TENANT.id, ERIN.id)).map((r) => r.rule)).toEqual(['Keep replies short'])
    expect(await listMemberMemory(TENANT.id, CARL.id)).toEqual([])
    expect(await forgetMemberMemory(TENANT.id, CARL.id, 'replies short')).toEqual([])
    expect((await listMemberMemory(TENANT.id, ERIN.id)).length).toBe(1)
    // Another company with the same member id sees nothing either.
    expect(await listMemberMemory(OTHER_TENANT.id, ERIN.id)).toEqual([])
  })
  it('remember / forget / list_learned for an employee use personal memory, never org memory', async () => {
    const ctx = ctxFor(ERIN)
    const r = JSON.parse((await TOOL_HANDLERS.remember(ctx, { rule: 'I work 7 to 3' })).text)
    expect(r).toMatchObject({ ok: true, personal: true })
    expect(db.agent_member_memory).toHaveLength(1)
    expect(db.agent_member_memory[0]).toMatchObject({ rep_id: TENANT.id, member_id: ERIN.id, rule: 'I work 7 to 3' })
    const listed = JSON.parse((await TOOL_HANDLERS.list_learned(ctx, {})).text)
    expect(listed.items.map((i: { rule: string }) => i.rule)).toEqual(['I work 7 to 3'])
    expect(JSON.parse((await TOOL_HANDLERS.list_learned(ctxFor(CARL), {})).text).items).toEqual([])
    const forgot = JSON.parse((await TOOL_HANDLERS.forget(ctx, { query: '7 to 3' })).text)
    expect(forgot.count).toBe(1)
    expect(orgMemory.addManualGuidance).not.toHaveBeenCalled()
    expect(orgMemory.listGuidance).not.toHaveBeenCalled()
    expect(orgMemory.updateGuidanceRule).not.toHaveBeenCalled()
  })
  it("an employee's own rules reach their prompt, not a coworker's", async () => {
    await addMemberMemory(TENANT.id, ERIN.id, 'Call me E')
    await addMemberMemory(TENANT.id, CARL.id, 'Carl secret preference')
    aiScript.push({ model: 'glm', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Hi E' }] })
    await runAgent({ tenant: TENANT, caller: ERIN, text: 'hi' })
    expect(aiCalls[0].system).toContain('Call me E')
    expect(aiCalls[0].system).not.toContain('Carl secret preference')
    expect(orgMemory.loadGuidance).not.toHaveBeenCalled()
  })
  it('exec memory still goes to the org memory', async () => {
    await TOOL_HANDLERS.remember(ctxFor(ELLEN), { rule: 'Never CC the whole team' })
    expect(orgMemory.addManualGuidance).toHaveBeenCalledWith(TENANT.id, 'Never CC the whole team', 'both', 'prefer', null)
    expect(db.agent_member_memory ?? []).toHaveLength(0)
  })
})

describe('seats: one price for everyone', () => {
  it('rep and observer are seats; assistant is not', () => {
    expect(isSeatRole('rep')).toBe(true)
    expect(isSeatRole('observer')).toBe(true)
    expect(isSeatRole('owner')).toBe(true)
    expect(isSeatRole('admin')).toBe(true)
    expect(isSeatRole('member')).toBe(true)
    expect(isSeatRole('assistant')).toBe(false)
    expect(miraPool(['owner', 'rep', 'observer', 'assistant'], 0)).toMatchObject({ seats: 3, included: 1500 })
  })
  it('getSeatUsage (billing cap) counts the same seats as the Mira pool', async () => {
    const roles = ['owner', 'admin', 'rep', 'observer', 'assistant']
    db.members = roles.map((role, i) => ({ id: `m${i}`, rep_id: TENANT.id, role, is_active: true }))
    db.members.push({ id: 'gone', rep_id: TENANT.id, role: 'rep', is_active: false })
    db.reps = [{ id: TENANT.id, max_seats: 10 }]
    const usage = await getSeatUsage(TENANT.id)
    expect(usage).toEqual({ used: 4, max: 10 })
    expect(usage.used).toBe(miraPool(roles, 0).seats)
    expect((await getSeatUsage(TENANT.id, { excludeOwner: true })).used).toBe(3)
  })
})
