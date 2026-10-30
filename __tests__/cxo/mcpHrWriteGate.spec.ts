/**
 * Employee records over MCP are owner or admin only (security audit 2026-10-29, finding 2).
 *
 * The real MCP server is driven through an in-memory client. set_employee_quota,
 * update_employee and log_time_off are refused for a manager, an assistant, an
 * acting assistant and an inactive member, before the handler runs, and the
 * refusal is audited. The owner and an admin still reach the handler. The
 * read (employee_quota_status) stays open to the exec team.
 *
 * Also finding 6: a key whose member row is gone (member_id null) is refused
 * and never falls back to the owner's rights. No database, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handled: Array<{ tool: string; args: Record<string, unknown> }> = []
const audits: Array<{ tool: string; result: string }> = []

vi.mock('@/lib/cxoInbox', () => ({ inboxAllowedForRep: async () => false, inboxBlockedRepIds: async () => [] }))

let repRow: Record<string, unknown> | null = null
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === 'reps' ? repRow : null, error: null }),
      }
      return q
    },
  },
}))
vi.mock('@/lib/ops/audit', () => ({
  recordAudit: async (a: { tool: string; result: string }) => {
    audits.push({ tool: a.tool, result: a.result })
  },
}))
vi.mock('@/lib/agent/cxoTools', () => ({
  CXO_TOOL_HANDLERS: new Proxy({}, {
    get: (_t, tool: string) => async (_ctx: unknown, args: Record<string, unknown>) => {
      handled.push({ tool, args })
      return { text: JSON.stringify({ ok: true, say: 'done' }) }
    },
  }),
}))

let tokenRow: Record<string, unknown> | null = null
let memberRow: Record<string, unknown> | null = null
const ownerLookups: string[] = []
vi.mock('@/lib/mcp/tokens', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  findLiveMcpToken: async () => tokenRow,
}))
vi.mock('@/lib/members', () => ({
  getMemberById: async () => memberRow,
  getOwnerMember: async (repId: string) => {
    ownerLookups.push(repId)
    return { id: 'm-owner', rep_id: repId, role: 'owner', is_active: true }
  },
}))

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildMcpServer } from '@/lib/mcp/server'
import { McpUnauthorized, requireMcpAuth, type McpAuthContext } from '@/lib/mcp/auth'

const TENANT = { id: 'org-a', brand: 'cxo', display_name: 'Acme', company: 'Acme', timezone: 'America/New_York', settings: {} }
const member = (role: string, extra: Record<string, unknown> = {}) => ({
  id: `m-${role}`,
  rep_id: 'org-a',
  display_name: 'Dana',
  email: 'dana@example.com',
  role,
  is_active: true,
  timezone: 'America/New_York',
  ...extra,
})
const authAs = (m: Record<string, unknown>) => ({ tenant: TENANT, member: m, tokenId: 't1', tokenLabel: 'test' }) as unknown as McpAuthContext

async function connect(auth: McpAuthContext) {
  const server = buildMcpServer(auth)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}
const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '')
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true

const HR_WRITES: Array<[string, Record<string, unknown>]> = [
  ['set_employee_quota', { employee: 'Joe', target: 40, type: 'policies', period: 'Q1' }],
  ['update_employee', { employee: 'Joe', title: 'Team lead' }],
  ['log_time_off', { employee: 'Joe', start_date: '2026-11-06' }],
]

beforeEach(() => {
  handled.length = 0
  audits.length = 0
  ownerLookups.length = 0
  tokenRow = null
  memberRow = null
  repRow = null
})

describe('HR writes over MCP: refused below owner or admin', () => {
  const refused: Array<[string, Record<string, unknown>]> = [
    ['manager', member('manager')],
    ['assistant', member('assistant')],
    ['admin acting as an assistant', member('admin', { acting_assistant: true })],
    ['inactive admin', member('admin', { is_active: false })],
  ]
  for (const [label, m] of refused) {
    it(`a ${label} key cannot change records, quotas or time off`, async () => {
      const client = await connect(authAs(m))
      for (const [tool, args] of HR_WRITES) {
        const r = await client.callTool({ name: tool, arguments: args })
        expect(isError(r), tool).toBe(true)
        expect(textOf(r)).toMatch(/Only the owner or an admin/)
      }
      expect(handled).toEqual([])
      expect(audits).toEqual(HR_WRITES.map(([tool]) => ({ tool: `mcp:${tool}`, result: 'refused' })))
    })
  }

  it('a manager key can still read quota status', async () => {
    const client = await connect(authAs(member('manager')))
    const r = await client.callTool({ name: 'employee_quota_status', arguments: { filter: 'behind' } })
    expect(isError(r)).toBe(false)
    expect(handled.map((h) => h.tool)).toEqual(['employee_quota_status'])
  })
})

describe('HR writes over MCP: allowed for owner and admin (CONTROL)', () => {
  for (const role of ['owner', 'admin']) {
    it(`an ${role} key reaches the handler for all three`, async () => {
      const client = await connect(authAs(member(role)))
      for (const [tool, args] of HR_WRITES) {
        const r = await client.callTool({ name: tool, arguments: args })
        expect(isError(r), tool).toBe(false)
      }
      expect(handled.map((h) => h.tool)).toEqual(HR_WRITES.map(([t]) => t))
      expect(audits.every((a) => a.result === 'ok')).toBe(true)
    })
  }

  it('the tool descriptions say who may use them', async () => {
    const client = await connect(authAs(member('owner')))
    const { tools } = await client.listTools()
    for (const [tool] of HR_WRITES) expect(tools.find((t) => t.name === tool)?.description).toMatch(/^Owner or admin only\./)
  })
})

describe('a key whose member is gone (finding 6)', () => {
  const req = () => new Request('https://suitecxo.example/api/mcp', { headers: { authorization: `Bearer cxo_${'a'.repeat(64)}` } })

  it('is refused when member_id is null, and the owner is never looked up', async () => {
    repRow = TENANT
    tokenRow = { id: 't1', rep_id: 'org-a', member_id: null, label: 'old key' }
    await expect(requireMcpAuth(req())).rejects.toBeInstanceOf(McpUnauthorized)
    expect(ownerLookups).toEqual([])
  })

  it('is refused when the member row no longer exists', async () => {
    repRow = TENANT
    tokenRow = { id: 't1', rep_id: 'org-a', member_id: 'm-gone', label: 'old key' }
    memberRow = null
    await expect(requireMcpAuth(req())).rejects.toBeInstanceOf(McpUnauthorized)
    expect(ownerLookups).toEqual([])
  })

  it('CONTROL: a live member key resolves to that member, not the owner', async () => {
    repRow = TENANT
    tokenRow = { id: 't1', rep_id: 'org-a', member_id: 'm-manager', label: 'my key' }
    memberRow = member('manager')
    const ctx = await requireMcpAuth(req())
    expect(ctx.member.id).toBe('m-manager')
    expect(ctx.member.role).toBe('manager')
    expect(ownerLookups).toEqual([])
  })
})
