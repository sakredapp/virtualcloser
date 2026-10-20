import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import type { AgentHistoryEntry } from '@/lib/agent/runAgent'
import { runChatTurn } from '@/lib/agent/chatTurn'
import { supabase } from '@/lib/supabase'
import { updateMember } from '@/lib/members'
import { isImpersonatedSession, recordHit } from '@/lib/cxoUsage'
import { IMPERSONATED_MIRA_KEY } from '@/lib/cxoAdoptionShared'
import { QueueRefused, runDailyQueue } from '@/lib/mira/dailyQueue'
import { isRunQueueText, summaryLine } from '@/lib/mira/dailyQueueShared'
import { currentConversation, historyFilter, listConversationsRich, ownConversation, touchConversation, type Conversation } from '@/lib/agent/chatSessions'
import { listFolders } from '@/lib/agent/chatOrganize'
import { clearPending } from '@/lib/agent/confirmGate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Mira in the dashboard. runAgent plus the intent dispatcher, behind an
 * HTTP route the MiraDock panel calls:
 *
 *   GET  → the turns of the member's current conversation, oldest first
 *          (empty once it has been idle for 2h: a fresh chat starts)
 *   GET ?list=1 → the member's past chats for the Ciao screen's left list
 *          → { chats: [{ id, last_at, title, pinned?, folder_id? }],
 *              folders: [{ id, name }], organize, current_id }
 *          (organize false = cxo_ciao_chat_folders.sql not run yet: no
 *          folders or pins, the list still loads; actions are in
 *          /api/mira/chats)
 *   GET ?conversation=<id> → the turns of one of the member's own past
 *          chats, read-only (sending still goes to the current conversation)
 *   POST { new_chat: true } → start a fresh conversation, drop any pending
 *          proposal → { ok, new_chat: true }
 *   POST { text, display? } → runAgent → execute its intents → persist the
 *          turn → { reply, choice?, error? }
 *   POST { text: "Run daily queue" } → the fixed daily queue routine, never
 *          the agent loop → { reply, queue } (the report the panel draws)
 *
 * `display` is what the person saw themselves tap (a choice chip's label)
 * when `text` is the chip's machine value; it is what gets stored as their
 * turn so the thread reads back the way it looked.
 */

const HISTORY_WINDOW = 40

type HistoryRow = { role: 'user' | 'assistant'; content: string; listed_tasks?: Array<{ id: string; content: string }> | null; created_at?: string }

async function loadHistory(memberId: string, conversation: Pick<Conversation, 'id' | 'started_at'> | null, sessions: boolean): Promise<HistoryRow[]> {
  // Sessions on but no live conversation: the panel opens on a fresh chat.
  if (sessions && !conversation) return []
  let q = supabase
    .from('agent_history')
    .select('role, content, listed_tasks, created_at')
    .eq('member_id', memberId)
  if (conversation) q = q.or(historyFilter(conversation))
  const { data } = await q
    .order('created_at', { ascending: false })
    // A turn's question and answer can share a timestamp (older rows). Newest
    // first, 'assistant' sorts before 'user', so after the reverse the
    // question always comes before its answer.
    .order('role', { ascending: true })
    .limit(HISTORY_WINDOW)
  return ((data ?? []) as HistoryRow[]).reverse()
}

export async function GET(req?: NextRequest) {
  let member, tenant
  try {
    ;({ member, tenant } = await requireMember())
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const params = req?.nextUrl?.searchParams
  if (params?.get('list') === '1') {
    const [list, folders, cur] = await Promise.all([
      listConversationsRich(member.id),
      listFolders(member.id),
      currentConversation(tenant.id, member.id, { peek: true }),
    ])
    const organize = list.organize && folders !== null
    return NextResponse.json({ ok: true, chats: list.chats, folders: folders ?? [], organize, current_id: cur.conversation?.id || null })
  }
  const pastId = params?.get('conversation')
  if (pastId) {
    const conv = await ownConversation(member.id, pastId)
    if (!conv) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    const { data } = await supabase
      .from('agent_history')
      .select('role, content, created_at')
      .eq('member_id', member.id)
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .order('role', { ascending: false })
      .limit(200)
    const rows = (data ?? []) as HistoryRow[]
    return NextResponse.json({
      ok: true,
      messages: rows.filter((r) => r.content && (r.role === 'user' || r.role === 'assistant')).map((r) => ({ role: r.role, content: r.content })),
    })
  }
  const cur = await currentConversation(tenant.id, member.id, { peek: true })
  const rows = await loadHistory(member.id, cur.conversation, cur.available)
  return NextResponse.json({
    ok: true,
    messages: rows.filter((r) => r.content).map((r) => ({ role: r.role, content: r.content })),
  })
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; display?: unknown; new_chat?: unknown } = {}
  try {
    body = (await req.json()) as { text?: unknown; display?: unknown; new_chat?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : ''
  const display = typeof body.display === 'string' ? body.display.trim().slice(0, 500) : ''
  if (body.new_chat === true) {
    let who
    try {
      who = await requireMember()
    } catch {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    // A fresh conversation, and a proposal from the old one can never be confirmed in the new one.
    await clearPending(who.tenant.id, who.member.id)
    await currentConversation(who.tenant.id, who.member.id, { fresh: true })
    return NextResponse.json({ ok: true, new_chat: true })
  }
  if (!text) return NextResponse.json({ ok: false, error: 'missing text' }, { status: 400 })

  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { tenant, member } = ctx
  // The conversation this message belongs to: the live one, or a fresh one after 2h idle.
  const cur = await currentConversation(tenant.id, member.id)
  const conversationId = cur.conversation?.id || null
  const newConversation = cur.isNew
  const persistTurn = async (userText: string, assistantText: string, listed?: Array<{ id: string; content: string }>) => {
    await persistTurnRows(member.id, tenant.id, conversationId, userText, assistantText, listed)
    if (conversationId) await touchConversation(conversationId)
  }

  // "Run daily queue" is a fixed server routine, not a free-form agent turn:
  // the person pressed send, so it runs once, for them only.
  if (isRunQueueText(text)) {
    try {
      const report = await runDailyQueue({ tenant, member }, { via: 'app' })
      const reply = summaryLine(report)
      await persistTurn(display || text, reply)
      return NextResponse.json({ ok: true, reply, queue: report, new_conversation: newConversation || undefined })
    } catch (err) {
      if (err instanceof QueueRefused) return NextResponse.json({ ok: true, reply: err.message, error: 'refused' })
      console.error('[mira/ask] daily queue failed', err)
      return NextResponse.json({ ok: true, reply: 'The daily queue did not finish. Nothing was sent. Run it again in a moment.', error: 'api_error' })
    }
  }

  try {
    const history: AgentHistoryEntry[] = (await loadHistory(member.id, cur.conversation, cur.available)).map((h) => ({
      role: h.role,
      content: h.content,
      listed_tasks: h.listed_tasks ?? undefined,
      at: h.created_at,
    }))

    const turn = await runChatTurn({ tenant, member, text, history, channel: 'app', conversationId })
    const result = turn.raw
    // Our admin asking while viewing as this member: billing counts it, adoption must not.
    if (result.error !== 'no_api_key' && result.error !== 'quota_exceeded' && (await isImpersonatedSession())) {
      await recordHit(tenant.id, member.id, IMPERSONATED_MIRA_KEY, { tz: member.timezone || tenant.timezone, bump: true }).catch(() => {})
    }

    // A choice: show the prompt and the chips, run nothing yet. The tap comes
    // back as the next POST with the chosen value as `text`.
    if (turn.choice) {
      await persistTurn(display || text, turn.choice.prompt)
      return NextResponse.json({ ok: true, reply: turn.choice.prompt, choice: turn.choice, new_conversation: newConversation || undefined })
    }
    // Never write on a failed turn (runChatTurn ran nothing).
    if (turn.error) return NextResponse.json({ ok: true, reply: turn.reply, error: turn.error })

    const reply = turn.reply
    await persistTurn(display || text, reply, turn.listedItems)
    if (turn.listedItems && turn.listedItems.length > 0) {
      await updateMember(member.id, {
        settings: {
          ...(member.settings ?? {}),
          last_listed_tasks: turn.listedItems,
          last_listed_tasks_at: new Date().toISOString(),
        },
      }).catch((e: unknown) => console.error('[mira/ask] settings persist failed', e))
    }

    return NextResponse.json({ ok: true, reply, new_conversation: newConversation || undefined })
  } catch (err) {
    console.error('[mira/ask] failed', err)
    return NextResponse.json(
      { ok: true, reply: 'Something hiccuped on my end. Ask me that again in a moment.', error: 'api_error' },
      { status: 200 },
    )
  }
}

async function persistTurnRows(
  memberId: string,
  repId: string,
  conversationId: string | null,
  userText: string,
  assistantText: string,
  listed?: Array<{ id: string; content: string }>,
): Promise<void> {
  // The answer is stamped 1 ms after the question so the pair never ties.
  const askedAt = Date.now()
  const conv = conversationId ? { conversation_id: conversationId } : {}
  const { error } = await supabase.from('agent_history').insert([
    { member_id: memberId, rep_id: repId, role: 'user', content: userText, created_at: new Date(askedAt).toISOString(), ...conv },
    { member_id: memberId, rep_id: repId, role: 'assistant', content: assistantText, listed_tasks: listed && listed.length > 0 ? listed : null, created_at: new Date(askedAt + 1).toISOString(), ...conv },
  ])
  if (error) console.error('[mira/ask] history persist failed', error.message)
}
