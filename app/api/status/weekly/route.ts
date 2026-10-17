/**
 * The signed-in member's own weekly status (lib/status/weekly): read it,
 * confirm Ciao's draft, or save their edit. Only their own row, by rep_id and
 * member id from the session; nobody else's status is readable here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { confirmMyStatus, getMyStatus, saveMyStatus } from '@/lib/status/weekly'
import { cleanStatus } from '@/lib/status/weeklyShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ctxOr401() {
  try {
    return await requireMember()
  } catch {
    return null
  }
}

export async function GET() {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  const tz = ctx.member.timezone || ctx.tenant.timezone || 'America/New_York'
  const status = await getMyStatus(ctx.tenant.id, ctx.member.id, new Date(), tz).catch((err) => {
    console.error('[status/weekly] get', err instanceof Error ? err.message : err)
    return null
  })
  return NextResponse.json({ status })
}

/** op: confirm | save (moved, next, blockers: arrays of lines) */
export async function POST(req: NextRequest) {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; id?: unknown }
  if (typeof b.id !== 'string' || !b.id || (b.op !== 'confirm' && b.op !== 'save')) return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
  try {
    const row = b.op === 'confirm' ? await confirmMyStatus(ctx.tenant.id, ctx.member.id, b.id) : await saveMyStatus(ctx.tenant.id, ctx.member.id, b.id, cleanStatus(b))
    if (!row) return NextResponse.json({ error: 'That status is gone.' }, { status: 404 })
    return NextResponse.json({ ok: true, status: row })
  } catch (err) {
    console.error('[status/weekly] save', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
