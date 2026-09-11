// POST /api/roleplay/dialed
//
// Body: { sessionId }. The browser reports THAT it dialed; the server stamps
// WHEN. dialed_at is the upper bound of the call-bind window — keeping it on
// the server's clock keeps the window seconds wide, which is the whole
// defence against binding another member's practice call.

import { NextRequest, NextResponse } from 'next/server'
import { resolveRoleplayMember, markDialed } from '@/lib/roleplay-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await resolveRoleplayMember()
  if (!auth) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  let body: { sessionId?: string }
  try {
    body = (await req.json()) as { sessionId?: string }
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }
  if (!body.sessionId) return NextResponse.json({ ok: false, reason: 'missing_session' }, { status: 400 })
  try {
    await markDialed(auth.tenant, auth.member, body.sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[roleplay/dialed]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, reason: 'mark_failed' }, { status: 500 })
  }
}
