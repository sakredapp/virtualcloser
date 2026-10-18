/**
 * Fixes from the Ciao QA run of 2026-10-18 (docs/qa/ciao-pinnacle-qa-2026-10-18.md).
 * Pure pieces and the self-serve tools; the runAgent honesty guard and the
 * coworker fallback run end to end in employeeMira.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selfView, approvals } = vi.hoisted(() => ({
  selfView: { value: null as unknown },
  approvals: {
    listApprovals: vi.fn(async () => [] as unknown[]),
    listPlaudPending: vi.fn(async () => [] as unknown[]),
    decideApproval: vi.fn(async () => ({ id: 'a1', status: 'executed', summary: 'Email Dana the deck' })),
  },
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in this spec') } } }))
vi.mock('@/lib/employees/data', async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadSelfView: async () => selfView.value }))
vi.mock('@/lib/ops/approvals', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...approvals }))
vi.mock('@/lib/members', async (orig) => ({ ...(await orig<Record<string, unknown>>()), listMembers: async () => [{ id: 'm2', display_name: 'Maya Fischer' }] }))

import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { actionSucceeded, claimsAction, isActionTool } from '@/lib/agent/actionClaims'
import { renderGoogleState } from '@/lib/agent/googleState'
import { payrollToolResult } from '@/lib/payroll/aiView'
import { routingHintsFor } from '@/lib/agent/cxoCatalog'
import { quotaNameFromArgs, quotaTypeFromArgs } from '@/lib/agent/cxoEmployeeTools'
import { EMPLOYEE_TOOLS, isEmployeeCaller } from '@/lib/agent/access'
import { CXO_SELF_SERVE_TOOL_HANDLERS } from '@/lib/agent/cxoSelfServeTools'
import { CONNECT_EMAIL_HINT, INBOX_NOT_CONNECTED_HINT } from '@/lib/partners'
import { CXO_DRAFTING_RULES, CXO_HONESTY_RULES } from '@/lib/agent/cxoPrompt'
import { toolDefsFor, type AgentContext } from '@/lib/agent/tools'

const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: 'America/New_York', settings: { cxo_employee_ops: true } } as unknown as Tenant
const member = (id: string, role: string, name: string) => ({ id, rep_id: TENANT.id, role, display_name: name, email: `${name.toLowerCase()}@acme.test`, is_active: true, settings: {} }) as unknown as Member
const ctxFor = (caller: Member): AgentContext => ({ tenant: TENANT, caller, timezone: 'America/New_York', todayIso: '2026-10-18', ownerMemberId: caller.id, selfOnly: isEmployeeCaller(caller, TENANT) })
const OWNER = member('owner-1', 'owner', 'Jordan')
const REP = member('rep-1', 'rep', 'Maya')
const parse = async (p: Promise<{ text: string }>) => JSON.parse((await p).text) as Record<string, unknown>

beforeEach(() => {
  selfView.value = null
  vi.clearAllMocks()
})

describe('gap 2: claims an action', () => {
  it.each([
    'Added to your to-dos.',
    'Done. Dana will see it in her messages.',
    "I've scheduled the call for Tuesday at 2pm.",
    'I have sent Maya a note.',
    'Your reminder has been set for 3pm.',
    "Maya's quota has been updated to $40,000.",
    'Sent!',
  ])('flags "%s"', (s) => expect(claimsAction(s)).toBe(true))

  it.each([
    'Want me to add it to your to-dos?',
    'I can send Maya a note if you like.',
    'Set a reminder for Friday so it does not slip.',
    "Maya's quota is set at $40,000 for October.",
    "Here's a draft:\n\nHi Dana,\n\nI've attached the deck we discussed.\n\nBest,\n[Your name]\n\nShould I send it?",
    'Google is not connected yet, so nothing was sent.',
    "I'll add it once you say yes.",
    '',
  ])('does not flag "%s"', (s) => expect(claimsAction(s)).toBe(false))

  it('only reads the opening and closing paragraphs, so a drafted body is not a claim', () => {
    const reply = 'Here is a version you can send.\n\nI have updated the forecast and sent the numbers to the board.\n\nTell me what to change.'
    expect(claimsAction(reply)).toBe(false)
  })

  it('knows which tools act', () => {
    for (const t of ['add_my_todo', 'send_member_message', 'set_employee_quota', 'decide_approval', 'create_doc', 'delegate_intents']) expect(isActionTool(t), t).toBe(true)
    for (const t of ['list_my_todos', 'payroll', 'team_adoption', 'my_quota', 'list_approvals', 'find_free_time']) expect(isActionTool(t), t).toBe(false)
  })

  it('counts only real (or queued) results as done', () => {
    expect(actionSucceeded('add_my_todo', {}, JSON.stringify({ ok: true, id: 't1' }))).toBe(true)
    expect(actionSucceeded('send_member_message', {}, JSON.stringify({ ok: false, queued: true }))).toBe(true)
    expect(actionSucceeded('add_my_todo', {}, JSON.stringify({ ok: false, error: 'nope' }))).toBe(false)
    expect(actionSucceeded('set_employee_quota', {}, JSON.stringify({ ok: false, needs_confirmation: true }))).toBe(false)
    expect(actionSucceeded('board_update', { action: 'list' }, JSON.stringify({ ok: true }))).toBe(false)
    expect(actionSucceeded('add_my_todo', {}, 'Saved.', true)).toBe(false)
    expect(actionSucceeded('add_my_todo', {}, 'Error: no such list')).toBe(false)
    expect(actionSucceeded('list_my_todos', {}, JSON.stringify({ ok: true }))).toBe(false)
  })
})

describe('gap 6: real Google state in the prompt', () => {
  it('says what is connected', () => {
    const s = renderGoogleState({ mail: { connected: true, email: 'j@acme.test' }, calendar: { connected: true, email: 'j@acme.test' } })
    expect(s).toContain('Email: connected as j@acme.test')
    expect(s).toContain('Calendar: connected as j@acme.test')
  })
  it('when nothing is connected: say so, still draft, never "ready to send"', () => {
    const s = renderGoogleState({ mail: { connected: false, email: null }, calendar: { connected: false, email: null } })
    expect(s).toContain('Email: NOT connected')
    expect(s).toContain('write the full email right here in chat')
    expect(s).toContain('Never say an email is ready to send')
    expect(s).toContain('Calendar: NOT connected')
  })
  it('editions without email get no email line', () => {
    expect(renderGoogleState({ mail: null, calendar: { connected: false, email: null } })).not.toContain('Email:')
  })
  it('the not-connected copy no longer says "ready to send"', () => {
    for (const s of [CONNECT_EMAIL_HINT, INBOX_NOT_CONNECTED_HINT]) {
      expect(s.toLowerCase()).not.toContain('ready to send')
      expect(s).toContain('not connected')
    }
    expect(CONNECT_EMAIL_HINT.startsWith('Not sent')).toBe(true)
  })
})

describe('gap 8: missing data is not zero', () => {
  it('payroll with nothing loaded is "not set up"', () => {
    const r = payrollToolResult('summary', '', [], [])
    expect(r).toMatchObject({ ok: true, has_data: false, not_set_up: true })
    expect(String(r.say)).toContain('not set up')
  })
  it('the prompt rules say so too, plus drafts and personal-email warnings', () => {
    const honesty = [CXO_HONESTY_RULES].flat().join('\n')
    const drafting = [CXO_DRAFTING_RULES].flat().join('\n')
    expect(honesty).toMatch(/zero/i)
    expect(honesty).toMatch(/personal/i)
    expect(drafting).toMatch(/\[Name\]|placeholder/i)
  })
})

describe('gap 5: "what\'s slipping" is business, not app usage', () => {
  it('routes slippage to whats_slipping when present', () => {
    const lines = routingHintsFor(['whats_slipping', 'team_adoption', 'list_followups']).join('\n')
    expect(lines).toMatch(/slipping/i)
    expect(lines).not.toMatch(/team_adoption[^\n]*who is slipping/i)
  })
  it('falls back to follow-ups and pacing (never adoption) without whats_slipping', () => {
    const withIt = routingHintsFor(['whats_slipping', 'list_followups'])
    const without = routingHintsFor(['list_followups'])
    const fallback = without.find((l) => /overdue/.test(l))
    expect(fallback).toBeDefined()
    expect(fallback).toMatch(/never answer it with team_adoption/i)
    expect(withIt).not.toContain(fallback)
  })
})

describe('small fixes: quota keeps the metric', () => {
  it('"submitted AP" is premium named "Submitted AP", not revenue', () => {
    const args = { metric: 'submitted AP', type: 'revenue' }
    const type = quotaTypeFromArgs(args)
    expect(type).toBe('premium')
    expect(quotaNameFromArgs(args, type, 'Premium $')).toBe('Submitted AP')
  })
  it('a plain type still works', () => {
    expect(quotaTypeFromArgs({ type: 'policies' })).toBe('policies')
    expect(quotaNameFromArgs({}, 'policies', 'Policies')).toBe('Policies')
  })
})

describe('gap 3: my_quota is the caller only', () => {
  it('is on the employee allow-list, and approvals are not', () => {
    expect(EMPLOYEE_TOOLS.has('my_quota')).toBe(true)
    expect(EMPLOYEE_TOOLS.has('list_approvals')).toBe(false)
    expect(EMPLOYEE_TOOLS.has('decide_approval')).toBe(false)
  })
  it('takes no person argument', () => {
    const def = toolDefsFor(TENANT, REP).find((t) => t.name === 'my_quota')
    expect(def).toBeDefined()
    expect(Object.keys((def!.input_schema as { properties: object }).properties)).toEqual([])
    expect(toolDefsFor(TENANT, REP).map((t) => t.name)).not.toContain('list_approvals')
    expect(toolDefsFor(TENANT, OWNER).map((t) => t.name)).toEqual(expect.arrayContaining(['my_quota', 'list_approvals', 'decide_approval']))
  })
  it('an unlinked login is "not set up", never zero', async () => {
    const r = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.my_quota(ctxFor(REP), {}))
    expect(r).toMatchObject({ ok: true, linked: false, not_set_up: true })
  })
  it('a linked record with no quota is "not set up"', async () => {
    selfView.value = { employee: { id: 'e1', name: 'Maya' }, kpis: [], actuals: [], tiers: [], manager: null }
    const r = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.my_quota(ctxFor(REP), { employee: 'Someone Else' }))
    expect(r).toMatchObject({ linked: true, not_set_up: true, name: 'Maya' })
  })
})

describe('gap 4: approvals for approvers only', () => {
  it('an employee is turned away before anything is read', async () => {
    const r = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.list_approvals(ctxFor(REP), {}))
    expect(r.ok).toBe(false)
    expect(approvals.listApprovals).not.toHaveBeenCalled()
    const d = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.decide_approval(ctxFor(REP), { id: 'a1', decision: 'approve', confirmed: true }))
    expect(d.ok).toBe(false)
    expect(approvals.decideApproval).not.toHaveBeenCalled()
  })
  it('lists pending items with who asked', async () => {
    approvals.listApprovals.mockResolvedValueOnce([{ id: 'a1', summary: 'Email Dana the deck', requested_by: 'm2', reason: 'outside_send', tool: 'compose_partner_message', created_at: '2026-10-18T10:00:00Z' }])
    const r = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.list_approvals(ctxFor(OWNER), {}))
    expect(r).toMatchObject({ ok: true, count: 1 })
    expect((r.items as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'a1', asked_by: 'Maya Fischer', why: 'goes outside the company' })
  })
  it('deciding needs an explicit yes', async () => {
    const r = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.decide_approval(ctxFor(OWNER), { id: 'a1', decision: 'approve' }))
    expect(r).toMatchObject({ ok: false, needs_confirmation: true })
    expect(approvals.decideApproval).not.toHaveBeenCalled()
    const ok = await parse(CXO_SELF_SERVE_TOOL_HANDLERS.decide_approval(ctxFor(OWNER), { id: 'a1', decision: 'approve', confirmed: true }))
    expect(ok).toMatchObject({ ok: true, status: 'executed' })
    expect(approvals.decideApproval).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', approve: true }))
  })
})
