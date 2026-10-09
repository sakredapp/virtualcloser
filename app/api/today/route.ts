import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import * as T from '@/lib/today'
import { cardsAssignedTo, updateCard, boardsMissing } from '@/lib/boards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const memberId = ctx.member.id as string
  const tz = (ctx.member as { timezone?: string | null }).timezone || ctx.tenant.timezone || 'America/New_York'
  const withPartners = req.nextUrl.searchParams.get('partners') === '1'
  const [todos, cards, suggestions] = await Promise.all([
    T.listTodos(repId, memberId).catch((err) => (T.todosMissing(err) ? [] : Promise.reject(err))),
    cardsAssignedTo(repId, memberId).catch((err) => (boardsMissing(err) ? [] : [])),
    withPartners ? T.partnerSuggestions(repId, memberId, tz).catch(() => null) : Promise.resolve(undefined),
  ]).catch((err) => {
    console.error('[today] get', err)
    return [[], [], undefined] as const
  })
  return NextResponse.json({ todos, cards, suggestions })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const memberId = ctx.member.id as string
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    switch (b.op) {
      case 'scan':
        return NextResponse.json(await T.scanMeetingNotes(repId, memberId))
      case 'add':
        return NextResponse.json({ todo: await T.addTodo(repId, memberId, s(b.body)) })
      case 'set':
        await T.updateTodo(repId, memberId, s(b.id), { done: typeof b.done === 'boolean' ? b.done : undefined, body: typeof b.body === 'string' ? b.body : undefined })
        break
      case 'delete':
        await T.deleteTodo(repId, memberId, s(b.id))
        break
      case 'fromPartner':
        return NextResponse.json({
          todo: await T.addFromPartner(repId, memberId, { partner_id: s(b.partnerId), partner_name: s(b.partnerName), thread_id: s(b.threadId), body: s(b.body) }),
        })
      case 'cardDone':
        await updateCard(repId, s(b.id), { done: b.done !== false })
        break
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[today] post', b.op, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'That did not save.' }, { status: 400 })
  }
}
