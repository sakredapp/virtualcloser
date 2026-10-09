import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import * as B from '@/lib/boards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const boardId = req.nextUrl.searchParams.get('board')
  try {
    if (boardId) return NextResponse.json(await B.boardContents(repId, boardId))
    const [boards, people] = await Promise.all([B.listBoards(repId), B.boardPeople(repId)])
    return NextResponse.json({ boards, people, me: ctx.member.id })
  } catch (err) {
    if (B.boardsMissing(err)) return NextResponse.json({ boards: [], people: [], me: ctx.member.id, notReady: true })
    console.error('[boards] get', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load boards.' }, { status: 400 })
  }
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
      case 'board.create':
        return NextResponse.json({ board: await B.createBoard(repId, memberId, s(b.name)) })
      case 'board.rename':
        await B.renameBoard(repId, s(b.id), s(b.name))
        break
      case 'board.delete':
        await B.deleteBoard(repId, s(b.id))
        break
      case 'board.import':
        return NextResponse.json(await B.importBoard(repId, memberId, b.payload as B.ImportPayload))
      case 'list.create':
        return NextResponse.json({ list: await B.createList(repId, s(b.boardId), s(b.title)) })
      case 'list.rename':
        await B.renameList(repId, s(b.id), s(b.title))
        break
      case 'list.delete':
        await B.deleteList(repId, s(b.id))
        break
      case 'list.order':
        await B.orderLists(repId, Array.isArray(b.ids) ? b.ids.map(String) : [])
        break
      case 'card.create':
        return NextResponse.json({ card: await B.createCard(repId, memberId, s(b.boardId), s(b.listId), s(b.title)) })
      case 'card.update':
        return NextResponse.json({ card: await B.updateCard(repId, s(b.id), (b.patch ?? {}) as B.CardPatch) })
      case 'card.delete':
        await B.deleteCard(repId, s(b.id))
        break
      case 'card.place':
        await B.placeCards(repId, s(b.listId), Array.isArray(b.ids) ? b.ids.map(String) : [])
        break
      case 'card.assign': {
        const m = ctx.member as { display_name?: string | null; email?: string | null }
        const result = await B.setCardAssignees(
          { repId, memberId, senderName: m.display_name || m.email || 'Your executive', senderEmail: m.email ?? null },
          s(b.id),
          Array.isArray(b.keys) ? b.keys.map(String) : [],
        )
        return NextResponse.json(result)
      }
      case 'check.add':
        return NextResponse.json({ item: await B.addChecklistItem(repId, s(b.cardId), s(b.text)) })
      case 'check.set':
        await B.setChecklistItem(repId, s(b.id), { done: typeof b.done === 'boolean' ? b.done : undefined, text: typeof b.text === 'string' ? b.text : undefined })
        break
      case 'check.delete':
        await B.deleteChecklistItem(repId, s(b.id))
        break
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[boards] post', b.op, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'That did not save.' }, { status: 400 })
  }
}
