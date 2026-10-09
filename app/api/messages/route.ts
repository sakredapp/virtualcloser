import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { addTodo } from '@/lib/today'
import { supabase } from '@/lib/supabase'
import * as M from '@/lib/memberMessages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}
const s = (v: unknown) => (typeof v === 'string' ? v : '')

/** Messages card + rail badge. ?count=1 returns just the unread count. */
export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const memberId = ctx.member.id as string
  try {
    if (req.nextUrl.searchParams.get('count') === '1') {
      const unread = await M.unreadCount(repId, memberId)
      return NextResponse.json({ unread, latest: unread > 0 ? await M.latestUnread(repId, memberId) : null })
    }
    return NextResponse.json(await M.listMessages(repId, memberId))
  } catch (err) {
    if (M.messagesMissing(err)) return NextResponse.json({ unread: 0, inbox: [], sent: [], members: [] })
    console.error('[messages] get', err)
    return NextResponse.json({ error: 'Could not load messages.' }, { status: 500 })
  }
}

/** op: send | reply | read | todo */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const memberId = ctx.member.id as string
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  try {
    switch (s(b.op)) {
      case 'send': {
        const members = await M.orgMembers(repId)
        const to = members.find((m) => m.id === s(b.to) && m.id !== memberId)
        if (!to) return NextResponse.json({ error: 'Pick someone on your team.' }, { status: 400 })
        const at = M.deliverAtFor(s(b.deliver_at), to.timezone || ctx.tenant.timezone || 'America/New_York')
        const r = await M.sendMemberMessage({ repId, fromId: memberId, toId: to.id, body: s(b.body), kind: b.kind, deliverAt: at })
        return NextResponse.json({ ok: true, message: r.message })
      }
      case 'reply': {
        const m = await M.replyToMessage(repId, memberId, s(b.id), s(b.body))
        return NextResponse.json({ ok: true, message: m })
      }
      case 'read':
        await M.markRead(repId, memberId, s(b.id))
        return NextResponse.json({ ok: true })
      case 'todo': {
        const { data } = await supabase.from('member_messages').select('id, body, from_member_id, to_member_id').eq('rep_id', repId).eq('id', s(b.id)).maybeSingle()
        if (!data || data.to_member_id !== memberId) return NextResponse.json({ error: 'Message not found.' }, { status: 404 })
        const from = (await M.orgMembers(repId)).find((m) => m.id === data.from_member_id)
        const todo = await addTodo(repId, memberId, String(data.body).slice(0, 500), { source: 'message', source_label: M.memberLabel(from), kind: 'task', link_kind: 'message', link_id: data.id })
        await M.markRead(repId, memberId, data.id)
        return NextResponse.json({ ok: true, todo })
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
  } catch (err) {
    console.error('[messages] post', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not do that.' }, { status: 500 })
  }
}
