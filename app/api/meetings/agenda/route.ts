/**
 * The next leadership meeting agenda (lib/meetings/agenda) for the Today
 * card: read it, or save an exec's edit. Owner and admins only, by rep_id
 * from the session. Putting it on the invite is never done here: that goes
 * through Ciao, after the exec's yes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getAgenda, isAgendaRole, nextDraftedAgenda, saveAgendaBody, type AgendaRow } from '@/lib/meetings/agenda'
import { startLabel } from '@/lib/meetings/agendaShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function execOrNull() {
  try {
    const ctx = await requireMember()
    return isAgendaRole(ctx.member.role) ? ctx : null
  } catch {
    return null
  }
}

const out = (row: AgendaRow, tz: string) => ({ id: row.id, title: row.title, when: startLabel(row.starts_at, tz), body: row.body, edited: !!row.edited_at, on_invite: !!row.added_at })

export async function GET() {
  const ctx = await execOrNull()
  if (!ctx) return NextResponse.json({ agenda: null })
  const tz = ctx.member.timezone || ctx.tenant.timezone || 'America/New_York'
  const row = await nextDraftedAgenda(ctx.tenant.id).catch((err) => {
    console.error('[meetings/agenda] get', err instanceof Error ? err.message : err)
    return null
  })
  return NextResponse.json({ agenda: row && row.body.trim() ? out(row, tz) : null })
}

/** op: save { id, body } */
export async function POST(req: NextRequest) {
  const ctx = await execOrNull()
  if (!ctx) return NextResponse.json({ error: 'Only the owner and admins can edit the agenda.' }, { status: 403 })
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; id?: unknown; body?: unknown }
  if (b.op !== 'save' || typeof b.id !== 'string' || !b.id || typeof b.body !== 'string' || !b.body.trim()) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  const tz = ctx.member.timezone || ctx.tenant.timezone || 'America/New_York'
  try {
    if (!(await getAgenda(ctx.tenant.id, b.id))) return NextResponse.json({ error: 'That agenda is gone.' }, { status: 404 })
    const row = await saveAgendaBody(ctx.tenant.id, ctx.member.id, b.id, b.body)
    if (!row) return NextResponse.json({ error: 'That agenda is gone.' }, { status: 404 })
    return NextResponse.json({ ok: true, agenda: out(row, tz) })
  } catch (err) {
    console.error('[meetings/agenda] save', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
