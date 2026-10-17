/**
 * The monthly board update (lib/boardUpdate): open it, save the exec's edit,
 * redraw it from fresh numbers, or note that they sent it themselves. Owners
 * and admins with money access only, scoped to the session's rep_id. Ciao
 * never sends it; nothing here sends anything.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { currentBoardMonth, draftBoardUpdate, getBoardUpdate, markBoardUpdateSent, saveBoardUpdate } from '@/lib/boardUpdate/data'
import { canSeeBoardUpdate, cleanBody, parseMonthKey } from '@/lib/boardUpdate/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function execOr() {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return { error: NextResponse.json({ error: 'Sign in again.' }, { status: 401 }) }
  }
  if (ctx.tenant.brand !== 'cxo' || !canSeeBoardUpdate(ctx.member) || ctx.member.role === 'assistant') {
    return { error: NextResponse.json({ error: 'The board update is for the owner and admins only.' }, { status: 403 }) }
  }
  return { ctx }
}

export async function GET(req: NextRequest) {
  const r = await execOr()
  if (!r.ctx) return r.error
  const raw = req.nextUrl.searchParams.get('month') ?? ''
  const month = parseMonthKey(raw) ? raw : null
  const update = await getBoardUpdate(r.ctx.tenant.id, month).catch((err) => {
    console.error('[board-update] get', err instanceof Error ? err.message : err)
    return null
  })
  return NextResponse.json({ update, current_month: currentBoardMonth(new Date(), r.ctx.tenant.timezone) })
}

/** op: save (id, body) | regenerate (month, keep_edits) | sent (id, sent) */
export async function POST(req: NextRequest) {
  const r = await execOr()
  if (!r.ctx) return r.error
  const { tenant, member } = r.ctx
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; id?: unknown; body?: unknown; month?: unknown; keep_edits?: unknown; sent?: unknown }
  try {
    if (b.op === 'save' || b.op === 'sent') {
      if (typeof b.id !== 'string' || !b.id) return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
      const row = b.op === 'save' ? await saveBoardUpdate(tenant.id, member.id, b.id, cleanBody(b.body)) : await markBoardUpdateSent(tenant.id, b.id, b.sent !== false)
      if (!row) return NextResponse.json({ error: 'That update is gone.' }, { status: 404 })
      return NextResponse.json({ ok: true, update: row })
    }
    if (b.op === 'regenerate') {
      const month = typeof b.month === 'string' && parseMonthKey(b.month) ? b.month : currentBoardMonth(new Date(), tenant.timezone)
      const res = await draftBoardUpdate(
        { id: tenant.id, timezone: tenant.timezone, company: tenant.company, display_name: tenant.display_name },
        month,
        { regenerate: true, keepEdits: b.keep_edits !== false, by: member.id },
      )
      if (!res.row) return NextResponse.json({ error: 'The board update is not set up yet.' }, { status: 503 })
      return NextResponse.json({ ok: true, update: res.row })
    }
    return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
  } catch (err) {
    console.error('[board-update] post', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
