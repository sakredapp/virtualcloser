/**
 * The email inbox is the Pinnacle edition only (owner 2026-10-17).
 *
 * Every other Suite CXO tenant gets no Inbox tab, no Gmail OAuth scopes, no
 * Gmail tools for Ciao and no Gmail tools over MCP. The Pinnacle edition (the
 * Pinnacle org and its store-review login) keeps all of it, and a tenant on
 * any other brand keeps exactly what it had. No database, no Google, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/lib/entitlements', () => ({ getActiveAddonKeys: async () => new Set<string>() }))

import { cxoInboxEnabled, inboxAllowed } from '@/lib/cxoFeatures'
import { buildAuthUrl, GOOGLE_SCOPE, GOOGLE_SCOPE_NO_GMAIL } from '@/lib/google'
import { toolDefsForTenant } from '@/lib/agent/tools'
import { CXO_TOOL_HANDLERS, INBOX_TOOL_NAMES } from '@/lib/agent/cxoTools'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import { buildMcpServer } from '@/lib/mcp/server'
import type { McpAuthContext } from '@/lib/mcp/auth'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const PINNACLE = ['rep_spence', 'rep_store_review_pinnacle']
const NOT_PINNACLE = ['rep_store_review', 'rep-acme']

const cxoTenant = (id: string) =>
  ({ id, slug: id, display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: 'America/New_York', settings: {} }) as unknown as Tenant
const owner = (repId: string) =>
  ({ id: 'm-owner', rep_id: repId, display_name: 'Dana', email: 'dana@example.com', role: 'owner', timezone: 'America/New_York' }) as unknown as Member

beforeEach(() => {
  delete process.env.PINNACLE_VIEWER_REP_IDS
  repRow = null
})

describe('the gate', () => {
  it('is on for the Pinnacle edition only on Suite CXO', () => {
    for (const id of PINNACLE) {
      expect(cxoInboxEnabled(id)).toBe(true)
      expect(inboxAllowed({ id, brand: 'cxo' })).toBe(true)
    }
    for (const id of NOT_PINNACLE) {
      expect(cxoInboxEnabled(id)).toBe(false)
      expect(inboxAllowed({ id, brand: 'cxo' })).toBe(false)
    }
    expect(inboxAllowed(null)).toBe(false)
  })

  it('leaves every other brand unchanged', () => {
    expect(inboxAllowed({ id: 'rep_jace', brand: 'virtualcloser' })).toBe(true)
    expect(inboxAllowed({ id: 'rep_store_review', brand: null })).toBe(true)
  })
})

describe('Google connect', () => {
  it('asks for calendar scopes only when there is no inbox', () => {
    const url = new URL(buildAuthUrl('state', { gmail: false }, { clientId: 'c', clientSecret: 's', redirectUri: 'https://x.example/cb' } as never))
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toBe(GOOGLE_SCOPE_NO_GMAIL)
    expect(scope).not.toMatch(/gmail/i)
    expect(scope).toMatch(/calendar/)
    // No incremental auth: an earlier Gmail grant must not ride along.
    expect(url.searchParams.get('include_granted_scopes')).toBeNull()
  })

  it('keeps Gmail for the Pinnacle edition (and every caller that does not say)', () => {
    const url = new URL(buildAuthUrl('state', { gmail: true }, { clientId: 'c', clientSecret: 's', redirectUri: 'https://x.example/cb' } as never))
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPE)
    expect(url.searchParams.get('scope')).toMatch(/gmail/)
    expect(new URL(buildAuthUrl('state', {}, null)).searchParams.get('scope')).toBe(GOOGLE_SCOPE)
  })
})

describe("Ciao's tools", () => {
  it('no Gmail tools outside the Pinnacle edition', () => {
    for (const id of NOT_PINNACLE) {
      const names = toolDefsForTenant(cxoTenant(id)).map((t) => t.name)
      for (const n of INBOX_TOOL_NAMES) expect(names, id).not.toContain(n)
      expect(names).toContain('create_calendar_event')
    }
  })

  it('the Pinnacle edition keeps them', () => {
    for (const id of PINNACLE) {
      const names = toolDefsForTenant(cxoTenant(id)).map((t) => t.name)
      for (const n of INBOX_TOOL_NAMES) expect(names, id).toContain(n)
    }
  })

  it('a Gmail call that still arrives is refused before it touches Gmail', async () => {
    for (const tool of INBOX_TOOL_NAMES) {
      const r = await CXO_TOOL_HANDLERS[tool]({ tenant: cxoTenant('rep_store_review'), caller: owner('rep_store_review') } as never, { thread_id: 't1', body: 'x' })
      expect(JSON.parse(r.text)).toMatchObject({ ok: false, error: 'inbox_not_available' })
    }
  })
})

describe('the Inbox tab', () => {
  it('is not in the menu outside the Pinnacle edition', async () => {
    for (const id of NOT_PINNACLE) {
      repRow = { brand: 'cxo', tier: 'enterprise', settings: {}, integrations: {} }
      const nav = await buildDashboardTabs(id, owner(id))
      expect(nav.tabs.map((t) => t.label), id).not.toContain('Inbox')
      expect(nav.tabs.map((t) => t.label)).toContain('Today')
    }
  })

  it('is in the menu on the Pinnacle edition', async () => {
    for (const id of PINNACLE) {
      repRow = { brand: 'cxo', tier: 'enterprise', settings: {}, integrations: {} }
      const nav = await buildDashboardTabs(id, owner(id))
      expect(nav.tabs.map((t) => t.label), id).toContain('Inbox')
    }
  })
})

describe('MCP', () => {
  async function toolNames(repId: string) {
    const auth = { tenant: cxoTenant(repId), member: owner(repId), tokenId: 't1', tokenLabel: 'test' } as unknown as McpAuthContext
    const server = buildMcpServer(auth)
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([server.connect(a), client.connect(b)])
    const { tools } = await client.listTools()
    await client.close()
    return tools.map((t) => t.name)
  }

  it('lists no Gmail tools outside the Pinnacle edition, and keeps them on it', async () => {
    const plain = await toolNames('rep_store_review')
    for (const n of INBOX_TOOL_NAMES) expect(plain).not.toContain(n)
    const pinnacle = await toolNames('rep_store_review_pinnacle')
    expect(pinnacle).toContain('list_inbox')
    expect(pinnacle).toContain('read_thread')
  })
})
