/**
 * POST /api/mira/chats (owner 2026-10-20): signed-in only, bad bodies are a
 * 400, errors pass through with their status, and deleting the chat that is
 * still live starts a fresh one so it is never resumed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  member: { id: 'm1' } as { id: string } | null,
  live: 'aaaaaaaa-0000-4000-8000-000000000001' as string | null,
  result: { ok: true } as Record<string, unknown>,
  calls: [] as string[],
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in tests') } } }))
vi.mock('@/lib/tenant', () => ({
  requireMember: vi.fn(async () => {
    if (!h.member) throw new Error('no session')
    return { tenant: { id: 'rep-1' }, member: h.member }
  }),
}))
vi.mock('@/lib/agent/chatSessions', () => ({
  currentConversation: vi.fn(async (_r: string, _m: string, o: { peek?: boolean; fresh?: boolean }) => {
    h.calls.push(o.fresh ? 'fresh' : 'peek')
    return { conversation: h.live ? { id: h.live } : null, isNew: false, available: true }
  }),
  missing: () => false,
}))
vi.mock('@/lib/agent/confirmGate', () => ({ clearPending: vi.fn(async () => { h.calls.push('clear') }) }))
vi.mock('@/lib/agent/chatOrganize', async (orig) => {
  const real = await orig<typeof import('@/lib/agent/chatOrganize')>()
  return { ...real, organize: vi.fn(async (_r: string, _m: string, a: { action: string; id?: string }) => (a.action === 'delete_chat' && h.result.ok ? { ok: true, deleted_chat: a.id } : h.result)) }
})

import { POST } from '@/app/api/mira/chats/route'

const req = (body: unknown) => new Request('http://x/api/mira/chats', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }) as never

beforeEach(() => {
  h.member = { id: 'm1' }
  h.live = 'aaaaaaaa-0000-4000-8000-000000000001'
  h.result = { ok: true }
  h.calls = []
})

describe('POST /api/mira/chats', () => {
  it('401 when not signed in', async () => {
    h.member = null
    const r = await POST(req({ action: 'pin_chat', id: 'aaaaaaaa-0000-4000-8000-000000000001' }))
    expect(r.status).toBe(401)
  })
  it('400 for bad JSON or an unknown action', async () => {
    expect((await POST(req('{nope'))).status).toBe(400)
    expect((await POST(req({ action: 'nuke' }))).status).toBe(400)
  })
  it('passes not_found and not_ready through with their status', async () => {
    h.result = { ok: false, status: 404, error: 'not_found', message: 'That chat was not found.' }
    expect((await POST(req({ action: 'pin_chat', id: 'aaaaaaaa-0000-4000-8000-000000000002' }))).status).toBe(404)
    h.result = { ok: false, status: 503, error: 'not_ready', message: 'Folders and pins are not switched on yet.' }
    const r = await POST(req({ action: 'create_folder', name: 'Board' }))
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ error: 'not_ready' })
  })
  it('deleting the live chat clears its pending proposal and starts a fresh chat', async () => {
    const r = await POST(req({ action: 'delete_chat', id: 'aaaaaaaa-0000-4000-8000-000000000001' }))
    expect(await r.json()).toEqual({ ok: true, deleted_chat: 'aaaaaaaa-0000-4000-8000-000000000001', new_chat: true })
    expect(h.calls).toEqual(['peek', 'clear', 'fresh'])
  })
  it('deleting an older chat leaves the live one alone', async () => {
    const r = await POST(req({ action: 'delete_chat', id: 'aaaaaaaa-0000-4000-8000-000000000009' }))
    expect(await r.json()).toEqual({ ok: true, deleted_chat: 'aaaaaaaa-0000-4000-8000-000000000009' })
    expect(h.calls).toEqual(['peek'])
  })
})
