/**
 * A connected Claude cannot send or book on its own (owner 10-11).
 *
 * The real MCP server is driven through an in-memory client. Every tool that
 * leaves the person's hands is refused without `confirm: true`, and the
 * handler behind it is never reached. The daily queue save tools need no
 * confirm because they only write drafts, proposals and the person's own
 * to-dos. No database, no Google, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handled: Array<{ tool: string; args: Record<string, unknown> }> = []
const queueCalls: Array<{ fn: string; arg?: unknown }> = []

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no database in this test') } } }))
vi.mock('@/lib/agent/cxoTools', () => ({
  CXO_TOOL_HANDLERS: new Proxy({}, {
    get: (_t, tool: string) => async (_ctx: unknown, args: Record<string, unknown>) => { handled.push({ tool, args }); return { text: JSON.stringify({ ok: true, summary: 'done' }) } },
  }),
}))
vi.mock('@/lib/mira/dailyQueue', () => ({
  pendingForClaude: async () => { queueCalls.push({ fn: 'pending' }); return { messages: [] } },
  saveFromClaude: async (_c: unknown, arg: unknown) => { queueCalls.push({ fn: 'save', arg }); return { saved: true } },
  finishFromClaude: async () => { queueCalls.push({ fn: 'finish' }); return { done: [], needs: [] } },
  approveQueueItem: async (_c: unknown, id: string) => { queueCalls.push({ fn: 'approve', arg: id }); return { note: 'Reply sent.' } },
}))

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildMcpServer } from '@/lib/mcp/server'
import type { McpAuthContext } from '@/lib/mcp/auth'
import { CONFIRM_REFUSAL, isOutbound, outboundRefusal, withoutConfirm } from '@/lib/mcp/confirm'
import { QUEUE_COMMAND } from '@/lib/mira/dailyQueueShared'

const auth = {
  tenant: { id: 'org-a', brand: 'cxo', display_name: 'Acme', company: 'Acme', timezone: 'America/New_York' },
  member: { id: 'm1', rep_id: 'org-a', display_name: 'Dana', email: 'dana@example.com', role: 'admin', timezone: 'America/New_York' },
  tokenId: 't1',
  tokenLabel: 'test',
} as unknown as McpAuthContext

async function connect() {
  const server = buildMcpServer(auth)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}
const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '')

/** Every call that would send or book, with otherwise valid arguments. */
const OUTBOUND: Array<[string, Record<string, unknown>]> = [
  ['send_partner_message', { action_id: 'a1' }],
  ['reply_to_thread', { thread_id: 'th1', body: 'Thanks', mode: 'send' }],
  ['create_calendar_event', { title: 'Review', start: '2026-10-12T15:00:00Z' }],
  ['update_calendar_event', { event_id: 'ev1', title: 'Moved' }],
  ['cancel_calendar_event', { event_id: 'ev1' }],
  ['schedule_call_with_partner', { partner: 'p1', start: '2026-10-12T15:00:00Z' }],
  ['schedule_call_with_partner', { partner: 'p1', pick_first: true }],
]

beforeEach(() => {
  handled.length = 0
  queueCalls.length = 0
})

describe('the rule itself', () => {
  it('only the literal true counts as a yes', () => {
    for (const [tool, args] of OUTBOUND) {
      expect(isOutbound(tool, args)).toBe(true)
      expect(outboundRefusal(tool, args)).toBe(CONFIRM_REFUSAL)
      for (const confirm of [false, 'true', 'yes', 1, null]) expect(outboundRefusal(tool, { ...args, confirm })).toBe(CONFIRM_REFUSAL)
      expect(outboundRefusal(tool, { ...args, confirm: true })).toBeNull()
    }
    expect(outboundRefusal('approve_queue_item', { id: 'x' })).toBe(CONFIRM_REFUSAL)
  })

  it('drafts, lookups and reads are not outbound', () => {
    expect(isOutbound('reply_to_thread', { thread_id: 't', body: 'x' })).toBe(false)
    expect(isOutbound('reply_to_thread', { thread_id: 't', body: 'x', mode: 'draft' })).toBe(false)
    expect(isOutbound('schedule_call_with_partner', { partner: 'p1' })).toBe(false)
    for (const t of ['compose_partner_message', 'list_inbox', 'get_daily_queue', 'file_queue_todo', 'save_reply_draft', 'save_talking_points', 'save_meeting_brief', 'finish_daily_queue']) expect(isOutbound(t, { confirm: false })).toBe(false)
    expect(withoutConfirm({ a: 1, confirm: true })).toEqual({ a: 1 })
  })
})

describe('over the real MCP server', () => {
  it('every send or booking is refused without confirm, and nothing runs', async () => {
    const client = await connect()
    for (const [name, args] of OUTBOUND) {
      const r = await client.callTool({ name, arguments: args })
      expect(r.isError, name).toBe(true)
      expect(textOf(r), name).toContain('needs the person')
      const no = await client.callTool({ name, arguments: { ...args, confirm: false } })
      expect(no.isError, name).toBe(true)
    }
    expect(handled).toEqual([])
  })

  it('with confirm: true it runs once, and the handler never sees confirm', async () => {
    const client = await connect()
    for (const [name, args] of OUTBOUND) {
      const r = await client.callTool({ name, arguments: { ...args, confirm: true } })
      expect(r.isError ?? false, name).toBe(false)
    }
    expect(handled.map((h) => h.tool)).toEqual(OUTBOUND.map(([n]) => n))
    expect(handled.every((h) => !('confirm' in h.args))).toBe(true)
  })

  it('a draft reply needs no confirm and is passed through as a draft', async () => {
    const client = await connect()
    const r = await client.callTool({ name: 'reply_to_thread', arguments: { thread_id: 'th1', body: 'Thanks' } })
    expect(r.isError ?? false).toBe(false)
    expect(handled).toHaveLength(1)
    expect(handled[0].args.mode).not.toBe('send')
  })

  it('the daily queue tools save without sending; approving needs confirm', async () => {
    const client = await connect()
    await client.callTool({ name: 'get_daily_queue', arguments: {} })
    await client.callTool({ name: 'file_queue_todo', arguments: { message_id: 'msg1' } })
    await client.callTool({ name: 'save_reply_draft', arguments: { message_id: 'msg1', body: 'On it.' } })
    await client.callTool({ name: 'save_talking_points', arguments: { one_on_one_id: 'oo1', points: ['Pace'] } })
    await client.callTool({ name: 'save_meeting_brief', arguments: { meeting_id: 'ev1', title: 'Review', brief: 'Two people.' } })
    await client.callTool({ name: 'finish_daily_queue', arguments: {} })
    expect(queueCalls.map((c) => c.fn)).toEqual(['pending', 'save', 'save', 'save', 'save', 'finish'])
    expect(handled).toEqual([]) // none of them reached a send or calendar handler

    const refused = await client.callTool({ name: 'approve_queue_item', arguments: { id: 'item1' } })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('needs the person')
    expect(queueCalls.some((c) => c.fn === 'approve')).toBe(false)

    const ok = await client.callTool({ name: 'approve_queue_item', arguments: { id: 'item1', confirm: true } })
    expect(ok.isError ?? false).toBe(false)
    expect(queueCalls.filter((c) => c.fn === 'approve')).toEqual([{ fn: 'approve', arg: 'item1' }])
  })

  it('the prompt is named Run daily queue and tells the model to ask first', async () => {
    const client = await connect()
    const { prompts } = await client.listPrompts()
    const p = prompts.find((x) => x.name === 'run_daily_queue')
    expect(p?.title).toBe(QUEUE_COMMAND)
    const got = await client.getPrompt({ name: 'run_daily_queue', arguments: {} })
    const text = JSON.stringify(got.messages)
    expect(text).toMatch(/Ask me first/)
    expect(text).toMatch(/Do not send, book, move or cancel/)
    const { tools } = await client.listTools()
    for (const t of ['send_partner_message', 'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner', 'reply_to_thread', 'approve_queue_item']) {
      expect(Object.keys((tools.find((x) => x.name === t)?.inputSchema as { properties: object }).properties), t).toContain('confirm')
    }
  })
})
