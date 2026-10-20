import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { organize, parseOrganize } from '@/lib/agent/chatOrganize'
import { currentConversation } from '@/lib/agent/chatSessions'
import { clearPending } from '@/lib/agent/confirmGate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The Ciao screen's list tools, for the signed-in person's own chats only
 * (lib/agent/chatOrganize.ts). The list itself is GET /api/mira/ask?list=1.
 *
 *   POST { action: 'rename_chat', id, title }      blank title = first question again
 *   POST { action: 'pin_chat', id, pinned }
 *   POST { action: 'move_chat', id, folder_id }    null = back to Recent
 *   POST { action: 'delete_chat', id }             soft: leaves the list
 *   POST { action: 'create_folder', name }         → { folder }
 *   POST { action: 'rename_folder', id, name }     → { folder }
 *   POST { action: 'delete_folder', id }           its chats go back to Recent
 *
 * Someone else's chat or folder → 404. Before cxo_ciao_chat_folders.sql
 * runs → 503 not_ready.
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Bad JSON.' }, { status: 400 })
  }
  const parsed = parseOrganize(body)
  if ('ok' in parsed) return NextResponse.json(parsed, { status: parsed.ok ? 200 : parsed.status })

  const { tenant, member } = ctx
  // Deleting the chat that is still live: the next question starts a fresh one,
  // and a proposal from the deleted chat can never be confirmed later.
  const live = parsed.action === 'delete_chat' ? await currentConversation(tenant.id, member.id, { peek: true }) : null

  const r = await organize(tenant.id, member.id, parsed)
  if (!r.ok) return NextResponse.json(r, { status: r.status })

  if (live?.conversation?.id && live.conversation.id === r.deleted_chat) {
    await clearPending(tenant.id, member.id)
    await currentConversation(tenant.id, member.id, { fresh: true })
    return NextResponse.json({ ...r, new_chat: true })
  }
  return NextResponse.json(r)
}
