/**
 * The agreement wall fails closed and is checked on the server (task
 * 2026-10-20). The helper, one real route (/api/mira/ask), and MCP: an
 * unsigned member gets the sign link, never Ciao. No database, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signed = vi.fn<(memberId: string, brand?: string | null) => Promise<boolean>>()
const requireMember = vi.fn()
const runChatTurn = vi.fn()

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no database in this test') } } }))
vi.mock('@/lib/liabilityAgreement', () => ({ hasMemberSignedCurrent: (id: string, brand?: string | null) => signed(id, brand) }))
vi.mock('@/lib/tenant', async (orig) => ({ ...(await orig<Record<string, unknown>>()), requireMember: () => requireMember() }))
vi.mock('@/lib/agent/chatTurn', () => ({ runChatTurn: (...a: unknown[]) => runChatTurn(...a) }))
vi.mock('@/lib/cxoInbox', () => ({ inboxAllowedForRep: async () => false, inboxBlockedRepIds: async () => [] }))
vi.mock('@/lib/agent/cxoTools', () => ({
  CXO_TOOL_HANDLERS: new Proxy({}, { get: () => async () => { throw new Error('a tool handler ran behind the wall') } }),
}))

import { NextRequest } from 'next/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { _resetAgreementCache, agreementSignUrl, checkAgreement, requireSignedMember, signerIdFor } from '@/lib/agreementWall'
import { STORE_REVIEW } from '@/lib/storeDemo'
import { buildMcpServer } from '@/lib/mcp/server'
import type { McpAuthContext } from '@/lib/mcp/auth'

const tenant = { id: 'rep_acme', slug: 'acme', brand: 'cxo' as const, host_aliases: [], display_name: 'Acme', company: 'Acme', settings: {} }
const exec = { id: 'm_exec', rep_id: 'rep_acme', role: 'owner', email: 'exec@example.com', display_name: 'Dana', is_active: true }

beforeEach(() => {
  _resetAgreementCache()
  signed.mockReset()
  requireMember.mockReset()
  runChatTurn.mockReset()
})

describe('checkAgreement', () => {
  it('signed member goes on', async () => {
    signed.mockResolvedValue(true)
    expect(await checkAgreement({ tenant, member: exec })).toEqual({ ok: true })
    expect(signed).toHaveBeenCalledWith('m_exec', 'cxo')
  })

  it('unsigned member is told where to sign, in plain words', async () => {
    signed.mockResolvedValue(false)
    const s = await checkAgreement({ tenant, member: exec })
    expect(s.ok).toBe(false)
    if (s.ok) return
    expect(s.reason).toBe('unsigned')
    expect(s.signUrl).toBe('https://acme.suitecxo.com/dashboard')
    expect(s.message).toBe('Sign the Suite CXO agreement at https://acme.suitecxo.com/dashboard to keep using Ciao.')
  })

  it('fails CLOSED when the lookup errors', async () => {
    signed.mockRejectedValue(new Error('db down'))
    const s = await checkAgreement({ tenant, member: exec })
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.reason).toBe('check_failed')
  })

  it('an assistant acting for an exec is checked on their own signature', async () => {
    signed.mockImplementation(async (id) => id === 'm_exec')
    const acting = { ...exec, acting_assistant: { id: 'm_pa', display_name: 'Pat', email: 'pa@example.com' } }
    expect(signerIdFor(acting)).toBe('m_pa')
    expect((await checkAgreement({ tenant, member: acting })).ok).toBe(false)
  })

  it('store review logins skip the wall and never hit the database', async () => {
    for (const id of [STORE_REVIEW.suite, STORE_REVIEW.pinnacle]) {
      expect(await checkAgreement({ tenant: { ...tenant, id }, member: exec })).toEqual({ ok: true })
    }
    expect(signed).not.toHaveBeenCalled()
  })

  it('caches yes briefly, never no: signing takes effect at once', async () => {
    signed.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect((await checkAgreement({ tenant, member: exec })).ok).toBe(false)
    expect((await checkAgreement({ tenant, member: exec })).ok).toBe(true)
    expect((await checkAgreement({ tenant, member: exec })).ok).toBe(true)
    expect(signed).toHaveBeenCalledTimes(2)
  })

  it('employees sign on their own page', () => {
    expect(agreementSignUrl(tenant, { id: 'e1', role: 'rep' })).toBe('https://acme.suitecxo.com/dashboard/me')
  })
})

describe('requireSignedMember', () => {
  it('403 agreement_required with a human error and the link', async () => {
    signed.mockResolvedValue(false)
    const res = await requireSignedMember({ tenant, member: exec })
    expect(res?.status).toBe(403)
    const body = await res!.json()
    expect(body.code).toBe('agreement_required')
    expect(body.signUrl).toBe('https://acme.suitecxo.com/dashboard')
    expect(body.error).toMatch(/^Sign the Suite CXO agreement at https:\/\/acme\.suitecxo\.com\/dashboard/)
  })
  it('503 when the check fails, null when signed', async () => {
    signed.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(true)
    expect((await requireSignedMember({ tenant, member: exec }))?.status).toBe(503)
    expect(await requireSignedMember({ tenant, member: exec })).toBeNull()
  })
})

describe('/api/mira/ask behind the wall', () => {
  it('unsigned: 403 and Ciao never runs; GET history is closed too', async () => {
    signed.mockResolvedValue(false)
    requireMember.mockResolvedValue({ tenant, member: exec })
    const { POST, GET } = await import('@/app/api/mira/ask/route')
    const post = await POST(new NextRequest('https://acme.suitecxo.com/api/mira/ask', { method: 'POST', body: JSON.stringify({ text: 'What is on today?' }) }))
    expect(post.status).toBe(403)
    expect((await post.json()).code).toBe('agreement_required')
    expect(runChatTurn).not.toHaveBeenCalled()
    const get = await GET(new NextRequest('https://acme.suitecxo.com/api/mira/ask'))
    expect(get.status).toBe(403)
  })
})

describe('MCP behind the wall', () => {
  it('connects and lists tools, but every call answers with the sign link', async () => {
    const auth = { tenant, member: exec, tokenId: 't1', tokenLabel: 'test' } as unknown as McpAuthContext
    const server = buildMcpServer(auth, { agreementBlocked: { message: 'Sign the Suite CXO agreement at https://acme.suitecxo.com/dashboard to keep using Ciao.', signUrl: 'https://acme.suitecxo.com/dashboard' } })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([server.connect(a), client.connect(b)])
    const tools = await client.listTools()
    expect(tools.tools.length).toBeGreaterThan(5)
    const r = (await client.callTool({ name: 'get_company_snapshot', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> }
    expect(r.isError).toBe(true)
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe('agreement_required')
    expect(body.sign_url).toBe('https://acme.suitecxo.com/dashboard')
    const res = await client.readResource({ uri: 'cxo://snapshot' })
    expect((res.contents[0] as { text: string }).text).toMatch(/^Sign the Suite CXO agreement/)
  })
})
