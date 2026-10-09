/** Exec assistant: pick whose work you are doing. Only an active link is accepted. */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/tenant'
import { activeExecLinks, ASSIST_COOKIE } from '@/lib/assistants'
import { assistantPathKind } from '@/lib/assistantsShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentMember().catch(() => null)
  if (!me || me.role !== 'assistant') return NextResponse.json({ error: 'Assistants only.' }, { status: 403 })
  const form = await req.formData().catch(() => null)
  const execId = String(form?.get('exec') ?? '')
  const links = await activeExecLinks(me.rep_id, me.id)
  if (!links.some((l) => l.exec_member_id === execId)) return NextResponse.json({ error: 'You are not their assistant.' }, { status: 403 })
  // Back to the page they were on, when it is one an assistant can open.
  const ret = String(form?.get('return') ?? '')
  const safe = ret.startsWith('/') && !ret.startsWith('//') && assistantPathKind(ret) !== 'blocked' ? ret : '/dashboard'
  // A relative Location keeps them on the tenant host they posted from.
  const res = new NextResponse(null, { status: 303, headers: { location: safe } })
  res.cookies.set(ASSIST_COOKIE, execId, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 180 })
  return res
}
