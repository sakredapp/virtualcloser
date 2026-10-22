/**
 * change_setting / do_action on the settings registry (lib/settings/registry):
 * role refusals, the risky path without a yes, validation, the confirm gate,
 * and an audit row on every call. No database: supabase and the write
 * helpers are mocked. Made-up people only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordAudit = vi.fn(async () => undefined)
vi.mock('@/lib/ops/audit', () => ({ recordAudit: (...a: unknown[]) => recordAudit(...(a as [])) }))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const k of ['select', 'update', 'insert', 'eq', 'in', 'is', 'order', 'limit']) chain[k] = self
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.single = async () => ({ data: null, error: null })
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  return { supabase: { from: () => chain } }
})

const saveCompanyAssistantName = vi.fn(async (_id: string, v: unknown) => ({ ok: true as const, name: String(v) }))
vi.mock('@/lib/assistantNameServer', () => ({
  companyAssistantName: async () => 'Ciao',
  personalAssistantName: async () => null,
  saveCompanyAssistantName: (id: string, v: unknown) => saveCompanyAssistantName(id, v),
  savePersonalAssistantName: async () => ({ ok: true, name: '' }),
}))

const updateMember = vi.fn(async () => undefined)
vi.mock('@/lib/members', () => ({ updateMember: (...a: unknown[]) => updateMember(...(a as [])), listMembers: async () => [] }))

const inviteCoAdmin = vi.fn(async () => ({ ok: true as const, email: 'pat@example.test', reactivated: false }))
vi.mock('@/lib/team/coAdmins', () => ({ inviteCoAdmin: (...a: unknown[]) => inviteCoAdmin(...(a as [])), removeCoAdmin: vi.fn() }))

const saveCompanyLogo = vi.fn(async () => ({ ok: true as const, url: 'https://example.test/logo.png' }))
vi.mock('@/lib/integrations/companySettings', () => ({
  readCompanyLogo: () => null,
  rotateWisprLink: vi.fn(),
  saveCompanyLogo: (...a: unknown[]) => saveCompanyLogo(...(a as [])),
}))

import { changeSetting, doAction, describeRegistryCall, type RegistryCtx } from '@/lib/settings/registry'
import { isGatedCall } from '@/lib/agent/confirmGateShared'
import type { Member } from '@/types'

const tenant = { id: 't_demo', slug: 'demo', display_name: 'Demo Co', timezone: 'America/New_York', brand: 'cxo', settings: {} }
const person = (role: string, extra: Partial<Member> = {}) =>
  ({ id: `m_${role}`, rep_id: tenant.id, email: `${role}@example.test`, display_name: `Test ${role}`, role, is_active: true, settings: {}, timezone: null, ...extra }) as unknown as Member
const ctx = (role: string, over: Partial<RegistryCtx> = {}): RegistryCtx => ({ tenant, member: person(role), via: 'ciao', confirmed: false, ...over })

beforeEach(() => {
  recordAudit.mockClear()
  saveCompanyAssistantName.mockClear()
  updateMember.mockClear()
  inviteCoAdmin.mockClear()
  saveCompanyLogo.mockClear()
})

describe('change_setting role checks', () => {
  it('refuses a manager changing the company assistant name, and audits the refusal', async () => {
    const out = await changeSetting(ctx('manager'), 'assistant_name.company', 'Nova')
    expect(out.ok).toBe(false)
    expect(out.refused).toBe(true)
    expect(String(out.say)).toMatch(/owner or an admin/i)
    expect(saveCompanyAssistantName).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'change_setting:assistant_name.company', result: 'refused', memberId: 'm_manager' }))
  })

  it('refuses an assistant acting for their exec on an owner/admin setting', async () => {
    const member = person('owner', { acting_assistant: { id: 'm_ea', display_name: 'Test EA' } } as unknown as Partial<Member>)
    const out = await changeSetting({ tenant, member, via: 'ciao', confirmed: false }, 'assistant_name.company', 'Nova')
    expect(out.refused).toBe(true)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm_ea', result: 'refused' }))
  })

  it('lets an admin change it, and audits the change (MCP calls are tagged mcp:)', async () => {
    const out = await changeSetting(ctx('admin', { via: 'mcp' }), 'assistant name', 'Nova')
    expect(out.ok).toBe(true)
    expect(saveCompanyAssistantName).toHaveBeenCalledWith('t_demo', 'Nova')
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'mcp:change_setting:assistant_name.company', result: 'ok' }))
  })
})

describe('change_setting validation', () => {
  it('rejects an unknown time zone before writing', async () => {
    const out = await changeSetting(ctx('rep'), 'profile.timezone', 'Mars/Olympus')
    expect(out).toMatchObject({ ok: false, error: 'invalid' })
    expect(updateMember).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'change_setting:profile.timezone', result: 'not_done' }))
  })

  it('accepts a real time zone', async () => {
    const out = await changeSetting(ctx('rep'), 'profile.timezone', 'America/Chicago')
    expect(out.ok).toBe(true)
    expect(updateMember).toHaveBeenCalledWith('m_rep', { timezone: 'America/Chicago' })
  })

  it('rejects a logo that is not an https link', async () => {
    const out = await changeSetting(ctx('owner'), 'company.logo_url', 'http://example.test/logo.png')
    expect(out).toMatchObject({ ok: false, error: 'invalid' })
    expect(saveCompanyLogo).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean for an on/off setting', async () => {
    const out = await changeSetting(ctx('rep'), 'reminders.email', 'maybe')
    expect(out).toMatchObject({ ok: false, error: 'invalid' })
  })

  it('unknown keys and link-only settings are not written, and say so', async () => {
    expect(await changeSetting(ctx('owner'), 'no.such.setting', 1)).toMatchObject({ ok: false, error: 'unknown_key' })
    expect(await changeSetting(ctx('owner'), 'account.password', 'x')).toMatchObject({ ok: false, error: 'do_it_on_the_page' })
    expect(recordAudit).toHaveBeenCalledTimes(2)
  })
})

describe('risky actions need a yes', () => {
  it('do_action team.co_admin.invite without a confirm does nothing and asks for one', async () => {
    const out = await doAction(ctx('owner'), 'team.co_admin.invite', { email: 'pat@example.test', name: 'Pat Test' })
    expect(out).toMatchObject({ ok: false, needs_confirmation: true })
    expect(inviteCoAdmin).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'do_action:team.co_admin.invite', result: 'not_done' }))
  })

  it('runs after the yes, and the audit row is marked approved', async () => {
    const out = await doAction(ctx('owner', { confirmed: true }), 'team.co_admin.invite', { email: 'pat@example.test', name: 'Pat Test' })
    expect(out.ok).toBe(true)
    expect(inviteCoAdmin).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'do_action:team.co_admin.invite', result: 'ok', approved: true }))
  })

  it('a rep is refused before the confirm question is even asked', async () => {
    const out = await doAction(ctx('rep', { confirmed: true }), 'team.co_admin.invite', { email: 'pat@example.test' })
    expect(out.refused).toBe(true)
    expect(inviteCoAdmin).not.toHaveBeenCalled()
  })

  it('the Ciao confirm gate catches risky registry calls and describes them', () => {
    expect(isGatedCall('do_action', { key: 'team.co_admin.invite', input: { email: 'pat@example.test' } })).toBe(true)
    expect(isGatedCall('change_setting', { key: 'reminders.email', value: false })).toBe(false)
    const lines = describeRegistryCall('do_action', { key: 'team.co_admin.invite', input: { email: 'pat@example.test', name: 'Pat Test' } })
    expect(lines?.join(' ')).toMatch(/pat@example\.test/)
  })

  it('a tool-mode entry in Ciao hands back the tool to call', async () => {
    const out = await changeSetting(ctx('rep'), 'ai.nudges_paused_until', '2026-11-01')
    expect(out).toMatchObject({ ok: false, use_tool: 'pause_my_nudges' })
  })

  it('a tool-mode entry over MCP runs through runTool and is audited', async () => {
    const runTool = vi.fn(async () => ({ ok: true, say: 'Paused.' }))
    const out = await changeSetting(ctx('rep', { via: 'mcp', runTool }), 'ai.nudges_paused_until', { until: '2026-11-01' })
    expect(runTool).toHaveBeenCalledWith('pause_my_nudges', { until: '2026-11-01' })
    expect(out).toMatchObject({ ok: true, via_tool: 'pause_my_nudges' })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'mcp:change_setting:ai.nudges_paused_until', result: 'ok' }))
  })
})
