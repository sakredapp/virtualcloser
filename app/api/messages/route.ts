import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { addTodo, findLinkedTodo } from '@/lib/today'
import { supabase } from '@/lib/supabase'
import * as M from '@/lib/memberMessages'
import * as R from '@/lib/dueReminders'
import { dueWords } from '@/lib/dueRemindersShared'

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
      const tz = (ctx.member as { timezone?: string | null }).timezone || ctx.tenant.timezone || 'America/New_York'
      const [msgs, due] = await Promise.all([M.unreadCount(repId, memberId), R.unreadReminderCount(repId, memberId)])
      let latest: { from: string; body: string; kind?: string } | null = msgs > 0 ? await M.latestUnread(repId, memberId) : null
      if (!latest && due > 0) {
        const r = (await R.listReminders(repId, memberId, tz).catch(() => []))[0]
        if (r) latest = { from: 'Boards', body: `${r.title}: ${dueWords(r.days_left)}`, kind: 'reminder' }
      }
      return NextResponse.json({ unread: msgs + due, latest })
    }
    const tz = (ctx.member as { timezone?: string | null }).timezone || ctx.tenant.timezone || 'America/New_York'
    const [list, reminders] = await Promise.all([M.listMessages(repId, memberId), R.listReminders(repId, memberId, tz).catch(() => [])])
    return NextResponse.json({ ...list, reminders })
  } catch (err) {
    if (M.messagesMissing(err)) return NextResponse.json({ unread: 0, inbox: [], sent: [], members: [] })
    console.error('[messages] get', err)
    return NextResponse.json({ error: 'Could not load messages.' }, { status: 500 })
  }
}

/** op: send | reply | read | todo | reminder.read */
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
        let at: Date
        try {
          at = M.deliverAtFor(s(b.deliver_at), to.timezone || ctx.tenant.timezone || 'America/New_York')
        } catch (e) {
          if (e instanceof M.DeliveryTimeError) return NextResponse.json({ error: e.message }, { status: 400 })
          throw e
        }
        const r = await M.sendMemberMessage({ repId, fromId: memberId, toId: to.id, body: s(b.body), kind: b.kind, deliverAt: at })
        return NextResponse.json({ ok: true, message: r.message })
      }
      case 'reply': {
        const m = await M.replyToMessage(repId, memberId, s(b.id), s(b.body))
        return NextResponse.json({ ok: true, message: m })
      }
      case 'reminder.read':
        await R.markReminderRead(repId, memberId, s(b.id))
        return NextResponse.json({ ok: true })
      case 'read':
        await M.markRead(repId, memberId, s(b.id))
        return NextResponse.json({ ok: true })
      case 'todo': {
        const { data } = await supabase.from('member_messages').select('id, body, from_member_id, to_member_id').eq('rep_id', repId).eq('id', s(b.id)).maybeSingle()
        if (!data || data.to_member_id !== memberId) return NextResponse.json({ error: 'Message not found.' }, { status: 404 })
        const from = (await M.orgMembers(repId)).find((m) => m.id === data.from_member_id)
        // One to-do per message: return the existing one (also the request
        // to-do made on send); a unique index catches a race.
        let todo = await findLinkedTodo(repId, memberId, 'message', data.id)
        if (!todo) {
          try {
            todo = await addTodo(repId, memberId, String(data.body).slice(0, 500), { source: 'message', source_label: M.memberLabel(from), kind: 'task', link_kind: 'message', link_id: data.id })
          } catch (e) {
            if ((e as { code?: string })?.code !== '23505') throw e
            todo = await findLinkedTodo(repId, memberId, 'message', data.id)
          }
        }
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
