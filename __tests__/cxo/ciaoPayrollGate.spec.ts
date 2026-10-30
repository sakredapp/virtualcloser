/**
 * Ciao's payroll tool is admin-and-up, the same gate as the Accounting page and
 * /api/payroll/assistant (leak audit 2026-10-29). A manager, rep, observer or
 * assistant gets a one-line refusal and the payroll tables are never read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const g = vi.hoisted(() => ({ reads: 0 }))

vi.mock('@/lib/payroll/data', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listCommissions: async () => { g.reads++; return [] },
  listDeposits: async () => { g.reads++; return [] },
}))

import { PAYROLL_NOT_ALLOWED, TOOL_HANDLERS, type AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const TENANT = { id: 'rep_x', brand: 'cxo', timezone: tz, settings: {} } as unknown as Tenant
const ctxAs = (role: string): AgentContext => {
  const caller = { id: `m-${role}`, rep_id: 'rep_x', role, timezone: tz } as unknown as Member
  return { tenant: TENANT, caller, timezone: tz, todayIso: '2026-10-29', ownerMemberId: caller.id, channel: 'app' } as AgentContext
}

beforeEach(() => { g.reads = 0 })

describe('payroll tool role gate', () => {
  it.each(['manager', 'rep', 'observer', 'assistant'])('%s is refused without reading payroll', async (role) => {
    const out = await TOOL_HANDLERS.payroll(ctxAs(role), { view: 'summary' })
    expect(JSON.parse(out.text)).toMatchObject({ ok: false, say: PAYROLL_NOT_ALLOWED })
    expect(g.reads).toBe(0)
  })
  it.each(['admin', 'owner'])('%s gets the payroll result', async (role) => {
    const out = await TOOL_HANDLERS.payroll(ctxAs(role), { view: 'summary' })
    expect(out.text).not.toContain(PAYROLL_NOT_ALLOWED)
    expect(g.reads).toBe(2)
  })
})
