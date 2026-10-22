/**
 * Every setting and action a user can reach must be in the settings registry
 * (lib/settings/registryShared REGISTRY) or exempt with a written reason, so
 * Ciao and the MCP can explain it and, where possible, change it for them
 * (owner 2026-10-22: "no user should ever have to manually change a setting").
 *
 * A new mutating API route, server action or settings form field fails this
 * spec until it is registered or exempted.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REGISTRY, REGISTRY_EXEMPT, registryCounts, sourceCovered, isRiskyRegistryCall } from '@/lib/settings/registryShared'
import { TOOL_HANDLERS, toolDefsForTenant } from '@/lib/agent/tools'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import type { Tenant } from '@/lib/tenant'
import { discoverActions, discoverAll, discoverFields, discoverRoutes } from './discoverSources'

const APP = path.resolve(__dirname, '../../app')
const FIXTURE = path.resolve(__dirname, 'fixtures/unregistered')

// Raise these when coverage grows; never lower them to make a change pass.
const FLOOR = { sources: 200, settings: 30, actions: 34, doable: 45 }

// Scanning app/ reads a few hundred files: slow when the whole suite runs in parallel.
const SCAN_MS = 30_000

describe('settings registry coverage', () => {
  // One scan, shared by the tests below.
  const routes = discoverRoutes(APP)
  const actions = discoverActions(APP)
  const fields = discoverFields(APP)
  const found = [...routes, ...actions, ...fields]

  it('finds the real sources (the scanner is not silently empty)', () => {
    expect(routes).toContain('POST /api/me/about')
    expect(routes).toContain('PUT /api/me/assistant-name')
    expect(actions).toContain('action:dashboard/settings/assistantActions.ts#actionAddExecAssistant')
    expect(actions).toContain('action:dashboard/integrations/page.tsx#saveLogo')
    expect(fields).toContain('field:dashboard/settings/ExecAssistantSection.tsx#email')
    expect(found.length).toBeGreaterThanOrEqual(FLOOR.sources)
  }, SCAN_MS)

  it('every mutating route, server action and settings field is registered or exempt', () => {
    const missing = found.filter((s) => !sourceCovered(s))
    expect(missing, `Register these in lib/settings/registryShared.ts (REGISTRY) or add them to REGISTRY_EXEMPT with a reason:\n${missing.join('\n')}`).toEqual([])
  })

  it('fails on an unregistered route, action and field (fixture)', () => {
    const fx = discoverAll(FIXTURE)
    expect(fx).toEqual(
      expect.arrayContaining([
        'POST /api/me/secret-toggle',
        'action:dashboard/settings/page.tsx#flipHiddenThing',
        'field:dashboard/settings/page.tsx#hidden_thing',
      ]),
    )
    expect(fx.filter((s) => !sourceCovered(s))).toEqual(
      expect.arrayContaining(['POST /api/me/secret-toggle', 'action:dashboard/settings/page.tsx#flipHiddenThing', 'field:dashboard/settings/page.tsx#hidden_thing']),
    )
  })

  it('a wildcard exemption covers by prefix only', () => {
    expect(sourceCovered('POST /api/cron/anything')).toBe(true)
    expect(sourceCovered('POST /api/cronx')).toBe(false)
    expect(sourceCovered('POST /api/x', [], { 'POST /api/x': 'reason' })).toBe(true)
    expect(sourceCovered('POST /api/x', [], {})).toBe(false)
  })

  it('every exemption has a reason', () => {
    for (const [k, why] of Object.entries(REGISTRY_EXEMPT)) expect(why.trim().length, k).toBeGreaterThan(5)
  })
})

describe('settings registry entries', () => {
  it('keys are unique and every entry is fully described', () => {
    const keys = REGISTRY.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of REGISTRY) {
      expect(e.label.length, e.key).toBeGreaterThan(3)
      expect(e.what.length, e.key).toBeGreaterThan(10)
      expect(e.where.path.startsWith('/'), e.key).toBe(true)
      if (e.risky) expect(e.riskWhy ?? '', `${e.key} is risky: say why`).not.toBe('')
      if (e.how.mode === 'link' || e.how.mode === 'operator') expect(e.how.reason.length, e.key).toBeGreaterThan(5)
    }
  })

  it('every tool-mode entry points at a real tool on Suite CXO', () => {
    const cxo = { id: 't_test', brand: 'cxo', settings: { cxo_employee_ops: true } } as unknown as Tenant
    const offered = new Set(toolDefsForTenant(cxo).map((t) => t.name))
    for (const e of REGISTRY) {
      if (e.how.mode !== 'tool') continue
      expect(TOOL_HANDLERS[e.how.tool], `${e.key} -> ${e.how.tool}`).toBeTypeOf('function')
      expect(offered.has(e.how.tool), `${e.key} -> ${e.how.tool} not offered on Suite CXO`).toBe(true)
    }
  })

  it('the five settings tools are offered on Suite CXO and to employees', () => {
    const cxo = { id: 't_test', brand: 'cxo', settings: {} } as unknown as Tenant
    const offered = new Set(toolDefsForTenant(cxo).map((t) => t.name))
    for (const t of ['list_settings', 'explain_setting', 'change_setting', 'do_action', 'setup_progress']) {
      expect(offered.has(t), t).toBe(true)
      expect(TOOL_HANDLERS[t], t).toBeTypeOf('function')
      expect(EMPLOYEE_TOOLS.has(t), t).toBe(true)
    }
  })

  it('only risky fn entries hit the confirm gate', () => {
    expect(isRiskyRegistryCall('do_action', { key: 'team.co_admin.invite' })).toBe(true)
    expect(isRiskyRegistryCall('change_setting', { key: 'people.can_view_comp' })).toBe(true)
    expect(isRiskyRegistryCall('change_setting', { key: 'reminders.email' })).toBe(false)
    expect(isRiskyRegistryCall('change_setting', { key: 'team.co_admin.invite' })).toBe(false)
    expect(isRiskyRegistryCall('do_action', { key: 'nope' })).toBe(false)
  })

  it('coverage does not fall below the floor', () => {
    const c = registryCounts()
    expect(c.settings.total).toBeGreaterThanOrEqual(FLOOR.settings)
    expect(c.actions.total).toBeGreaterThanOrEqual(FLOOR.actions)
    expect(c.settings.covered + c.actions.covered).toBeGreaterThanOrEqual(FLOOR.doable)
  })
})
