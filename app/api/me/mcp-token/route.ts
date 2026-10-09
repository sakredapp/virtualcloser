/**
 * Keys for "Connect your AI" (Integrations page).
 *
 *   POST   { label? }  → { ok, token, key }   the plaintext token, shown ONCE
 *   GET                → { ok, keys: [...] }  live keys: label, created, last used
 *   DELETE { id }      → { ok }               revoke
 *
 * Signed-in member only. Fails soft with 503 + the migration to run when
 * mcp_tokens does not exist yet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { createMcpToken, listMcpTokens, McpTokensNotReady, revokeMcpToken } from '@/lib/mcp/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ctx() {
  try {
    return await requireMember()
  } catch {
    return null
  }
}

function softFail(err: unknown) {
  if (err instanceof McpTokensNotReady) {
    return NextResponse.json({ ok: false, error: err.message, not_ready: true }, { status: 503 })
  }
  const msg = err instanceof Error ? err.message : String(err)
  return NextResponse.json({ ok: false, error: msg }, { status: 500 })
}

export async function GET() {
  const c = await ctx()
  if (!c) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  try {
    const keys = await listMcpTokens(c.tenant.id)
    return NextResponse.json({ ok: true, keys })
  } catch (err) {
    return softFail(err)
  }
}

export async function POST(req: NextRequest) {
  const c = await ctx()
  if (!c) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { label?: unknown }
  const label = typeof body.label === 'string' ? body.label : undefined
  try {
    const live = await listMcpTokens(c.tenant.id)
    if (live.length >= 10) {
      return NextResponse.json({ ok: false, error: 'This account already has 10 live keys. Revoke one first.' }, { status: 400 })
    }
    const { token, row } = await createMcpToken({ repId: c.tenant.id, memberId: c.member.id, label })
    return NextResponse.json({ ok: true, token, key: row })
  } catch (err) {
    return softFail(err)
  }
}

export async function DELETE(req: NextRequest) {
  const c = await ctx()
  if (!c) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { id?: unknown }
  const id = typeof body.id === 'string' ? body.id : req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  try {
    const revoked = await revokeMcpToken(c.tenant.id, id)
    if (!revoked) return NextResponse.json({ ok: false, error: 'Key not found or already revoked.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return softFail(err)
  }
}
