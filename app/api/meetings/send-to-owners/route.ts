import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { sendNoteToOwners } from '@/lib/meetings/sendToOwners'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST { noteId } → each action item onto its owner's Today. See lib/meetings/sendToOwners. */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { noteId?: unknown }
  const noteId = typeof body.noteId === 'string' && /^[0-9a-f-]{36}$/i.test(body.noteId) ? body.noteId : null
  if (!noteId) return NextResponse.json({ error: 'Which meeting?' }, { status: 400 })
  try {
    const result = await sendNoteToOwners(ctx.tenant.id, { id: ctx.member.id as string, display_name: (ctx.member.display_name as string | null) ?? null }, noteId)
    if (!result) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[meetings/send-to-owners]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not send. Try again.' }, { status: 500 })
  }
}
