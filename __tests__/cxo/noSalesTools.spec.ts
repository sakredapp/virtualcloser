/**
 * Suite CXO has no sales tools (owner 2026-10-20). Pins:
 *   - a CXO tenant is never offered a CRM, lead, pipeline, KPI, target,
 *     roleplay or call tool; a Virtual Closer tenant still is;
 *   - the executor refuses a forged sales-tool call on a CXO tenant, even
 *     from the owner, and leaves Virtual Closer alone;
 *   - delegate_intents drops sales kinds on CXO, and executeIntent refuses
 *     them on CXO before any handler runs;
 *   - "what can you do" and the prompt never mention CRM, leads or pipeline;
 *   - the CRM pages are closed on Suite CXO hosts;
 *   - the admin sign-in and the new-client default follow the host.
 * Pure apart from mocked modules: no database, no network.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      throw new Error('no database in this test')
    },
  },
}))

import { CXO_INTENT_KINDS, CXO_SALES_TOOL_NAMES, cxoIntentAllowed, cxoToolAllowed, CXO_NO_SALES_RECEIPT } from '@/lib/agent/cxoNoSales'
import { authorizeToolCall } from '@/lib/agent/access'
import { capabilitiesFor } from '@/lib/agent/cxoCatalog'
import { cxoPathAllowed } from '@/lib/cxoRoutes'
import { adminEyebrow } from '@/lib/adminBrand'
import { defaultOperatorBrand, operatorBrand, operatorBrandChoices } from '@/lib/newClientBrand'

const cxo = { id: 'rep-harbor', slug: 'harbor', display_name: 'Harbor', brand: 'cxo', tier: 'enterprise', settings: { cxo_employee_ops: true } }
const vc = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', brand: 'virtualcloser', tier: 'enterprise', settings: {} }
const SALES = ['list_leads', 'list_pipeline_boards', 'list_pipeline_leads', 'list_kpi_history', 'list_targets', 'list_roleplay_sessions', 'list_recent_calls', 'get_call_stats']

describe('the tool list', { timeout: 30000 }, () => {
  it('Suite CXO is never offered a sales tool; Virtual Closer still is', async () => {
    const { toolDefsForTenant } = await import('@/lib/agent/tools')
    const cxoNames = toolDefsForTenant(cxo as never).map((t) => t.name)
    const vcNames = toolDefsForTenant(vc as never).map((t) => t.name)
    for (const n of SALES) {
      expect(CXO_SALES_TOOL_NAMES.has(n), n).toBe(true)
      expect(cxoNames, n).not.toContain(n)
      expect(vcNames, n).toContain(n)
    }
    // What stays: the book, the plan, finance, people.
    expect(cxoNames).toContain('producer_production')
    expect(cxoNames).toContain('payroll')
    expect(cxoNames).toContain('list_members')
  })

  it('no CXO tool description offers CRM, leads or a pipeline', async () => {
    const { toolDefsForTenant } = await import('@/lib/agent/tools')
    for (const t of toolDefsForTenant(cxo as never)) {
      if (t.name !== 'delegate_intents') continue
      expect(t.description).not.toMatch(/\bCRM writes\b|add_lead\{|move_lead_stage\{|pipeline_triage\{/)
      expect(t.description).toContain('no CRM, leads, pipeline')
    }
  })
})

describe('the executor gate', () => {
  it('refuses a forged sales-tool call on a CXO tenant, even for the owner', () => {
    for (const n of SALES) {
      const r = authorizeToolCall(n, { selfOnly: false, tenant: cxo })
      expect(r, n).not.toBeNull()
      expect(JSON.parse(r!.text)).toMatchObject({ ok: false, refused: true, error: 'not_on_suite_cxo', tool: n })
    }
  })

  it('leaves Virtual Closer and the CXO executive tools alone', () => {
    for (const n of SALES) expect(authorizeToolCall(n, { selfOnly: false, tenant: vc }), n).toBeNull()
    for (const n of ['producer_production', 'plan_pacing', 'quickbooks_financials', 'payroll', 'list_members']) {
      expect(authorizeToolCall(n, { selfOnly: false, tenant: cxo }), n).toBeNull()
      expect(cxoToolAllowed(n, cxo), n).toBe(true)
    }
    // No tenant passed (older callers): unchanged role-only behaviour.
    expect(authorizeToolCall('list_leads', { selfOnly: false })).toBeNull()
  })
})

describe('delegate_intents and executeIntent', { timeout: 30000 }, () => {
  const salesKinds = ['add_lead', 'update_lead', 'schedule_followup', 'log_call', 'pipeline_triage', 'snooze_lead', 'set_deal_value', 'handoff_lead', 'objection_coach', 'rep_pulse', 'leaderboard', 'forecast', 'winloss', 'inbox_zero', 'commission_report', 'set_target', 'log_kpi', 'create_kpi_card', 'list_kpi_cards', 'create_project', 'move_lead_stage', 'bulk_import_leads']

  it('allows only the Suite CXO kinds on CXO, everything on Virtual Closer', () => {
    for (const k of salesKinds) {
      expect(CXO_INTENT_KINDS.has(k), k).toBe(false)
      expect(cxoIntentAllowed({ kind: k }, cxo), k).toBe(false)
      expect(cxoIntentAllowed({ kind: k }, vc), k).toBe(true)
    }
    for (const k of ['brain_item', 'complete_task', 'book_meeting', 'send_email', 'defer_item']) expect(cxoIntentAllowed({ kind: k }, cxo), k).toBe(true)
    // Reports: only the calendar one; the others read leads, call stats and targets.
    expect(cxoIntentAllowed({ kind: 'report', report_type: 'calendar' }, cxo)).toBe(true)
    for (const t of ['pipeline', 'today', 'week', 'goals', 'metrics', 'lead_history', undefined]) expect(cxoIntentAllowed({ kind: 'report', report_type: t }, cxo), String(t)).toBe(false)
    expect(cxoIntentAllowed({ kind: 'report', report_type: 'pipeline' }, vc)).toBe(true)
  })

  it('the delegate_intents handler drops sales kinds on CXO and says why', async () => {
    const { TOOL_HANDLERS } = await import('@/lib/agent/tools')
    const handler = TOOL_HANDLERS.delegate_intents
    const ctx = { tenant: cxo, caller: { id: 'm1', role: 'owner' }, selfOnly: false } as never
    const out = await handler(ctx, { intents: [{ kind: 'add_lead', name: 'Sample Person' }, { kind: 'brain_item', item_type: 'note', content: 'x' }] })
    expect(out.intents?.map((i) => i.kind)).toEqual(['brain_item'])
    expect(JSON.parse(out.text)).toMatchObject({ refused: 1, error: 'not_on_suite_cxo' })
    const vcOut = await handler({ ...(ctx as object), tenant: vc } as never, { intents: [{ kind: 'add_lead', name: 'Sample Person' }] })
    expect(vcOut.intents?.map((i) => i.kind)).toEqual(['add_lead'])
  })

  it('executeIntent refuses a sales kind on CXO before touching the database', async () => {
    const { executeIntent } = await import('@/lib/mira/intents')
    for (const k of ['add_lead', 'move_lead_stage', 'bulk_import_leads', 'create_project', 'set_target', 'inbox_zero']) {
      const out = await executeIntent({ kind: k } as never, cxo as never, [], [], null, { id: 'm1', role: 'owner' } as never, 'x')
      expect(out, k).toBe(CXO_NO_SALES_RECEIPT)
    }
    const report = await executeIntent({ kind: 'report', report_type: 'pipeline' } as never, cxo as never, [], [], null, { id: 'm1', role: 'owner' } as never)
    expect(report).toBe(CXO_NO_SALES_RECEIPT)
  })
})

describe('what Ciao says it can do', { timeout: 30000 }, () => {
  it('never lists CRM, leads or a pipeline on Suite CXO', async () => {
    const { toolDefsForTenant } = await import('@/lib/agent/tools')
    const lines = capabilitiesFor(toolDefsForTenant(cxo as never)).join('\n')
    expect(lines).not.toMatch(/\bCRM\b|\bleads\b|pipeline|Sales KPIs|sales targets/i)
  })

  it('the prompt says there are no sales tools here', async () => {
    const { buildCxoPrompt } = await import('@/lib/agent/cxoPrompt')
    const { toolDefsForTenant } = await import('@/lib/agent/tools')
    const ctx = { tenant: { ...cxo, company: 'Harbor', timezone: 'America/New_York' }, caller: { id: 'm1', display_name: 'Ellen Exec', role: 'owner', email: 'x@harbor.test' }, timezone: 'America/New_York', todayIso: '2026-10-20', ownerMemberId: 'm1', selfOnly: false } as never
    const p = buildCxoPrompt(ctx, { tools: toolDefsForTenant(cxo as never) })
    expect(p).toContain('There is no CRM, no leads, no sales pipeline')
    expect(p).not.toContain('CRM writes')
  })
})

describe('pages and admin', () => {
  it('closes the CRM pages on Suite CXO hosts', () => {
    for (const p of ['/dashboard/pipeline', '/dashboard/leads', '/dashboard/leads/abc', '/dashboard/projects', '/dashboard/projects/abc', '/dashboard/prospects', '/dashboard/dialer']) {
      expect(cxoPathAllowed(p), p).toBe(false)
    }
    for (const p of ['/dashboard/plan', '/dashboard/accounting', '/dashboard/revenue']) expect(cxoPathAllowed(p), p).toBe(true)
  })

  it('the admin sign-in says Suite CXO on a Suite CXO host', () => {
    expect(adminEyebrow('suitecxo.com')).toBe('Suite CXO · Admin')
    expect(adminEyebrow('www.suitecxo.com')).toBe('Suite CXO · Admin')
    expect(adminEyebrow('mike.suitecxo.com')).toBe('Suite CXO · Admin')
    expect(adminEyebrow('suitecxo-git-x-team.vercel.app')).toBe('Suite CXO · Admin')
    expect(adminEyebrow('virtualcloser.com')).toBe('Virtual Closer · Admin')
    expect(adminEyebrow(null)).toBe('Virtual Closer · Admin')
  })

  it('a new client defaults to Suite CXO on a Suite CXO host', () => {
    expect(defaultOperatorBrand('suitecxo.com')).toBe('cxo')
    expect(defaultOperatorBrand('virtualcloser.com')).toBe('virtualcloser')
    expect(operatorBrandChoices('suitecxo.com')[0].key).toBe('cxo')
    expect(operatorBrandChoices('virtualcloser.com')[0].key).toBe('virtualcloser')
    expect(operatorBrand(undefined, defaultOperatorBrand('suitecxo.com'))).toBe('cxo')
    expect(operatorBrand('virtualcloser', 'cxo')).toBe('virtualcloser')
    expect(operatorBrand(undefined)).toBe('virtualcloser')
  })
})
