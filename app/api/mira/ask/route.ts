import { after, NextRequest, NextResponse } from 'next/server'
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
import type { AnswerCheckMeta } from '@/lib/agent/answerCheck'
import { requireSignedMember } from '@/lib/agreementWall'
import { loadChatMemory, maybeFold } from '@/lib/agent/chatMemoryStore'
import { assistantNameFor } from '@/lib/assistantNameServer'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { normalizeReplyFormat, type ReplyFormatPayload } from '@/lib/agent/replyFormatShared'
import type { ReplyFormatMeta } from '@/lib/agent/replyFormatter'

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
 *   POST { text, display?, voice? } → runAgent → execute its intents → persist
 *          the turn → { reply, choice?, error?, format? }
 *          `format` is the reply formatting step's checked layout
 *          (lib/agent/replyFormatter): words, cards and charts to draw in place
 *          of `reply`. `reply` is always the full answer as written (Slack,
 *          older clients and copy use it). `voice: true` = a spoken answer,
 *          never laid out.
 *   GET turns carry `format` too (agent_history.reply_format,
 *          supabase/cxo_ciao_reply_format.sql), so history draws the same.
 *   POST { text: "Run daily queue" } → the fixed daily queue routine, never
 *          the agent loop → { reply, queue } (the report the panel draws)
 *
 * `display` is what the person saw themselves tap (a choice chip's label)
 * when `text` is the chip's machine value; it is what gets stored as their
 * turn so the thread reads back the way it looked.
 */

/** What the panel shows when it opens. */
const PANEL_WINDOW = 40
/**
 * What a turn reads: enough to always cover everything since the summary's
 * cut-off (a fold runs once more than SUMMARY_AFTER = 30 are unsummarized).
 */
const TURN_WINDOW = 60

type HistoryRow = {
  role: 'user' | 'assistant'
  content: string
  listed_tasks?: Array<{ id: string; content: string }> | null
  created_at?: string
  sources?: string | null
  reply_format?: unknown
}

/** A turn as the panel gets it: the layout only when there is a drawable one. */
function wireTurn(r: HistoryRow): { role: 'user' | 'assistant'; content: string; format?: ReplyFormatPayload } {
  const format = r.role === 'assistant' ? normalizeReplyFormat(r.reply_format) : null
  return { role: r.role, content: r.content, ...(format ? { format } : {}) }
}

async function loadHistory(memberId: string, conversation: Pick<Conversation, 'id' | 'started_at'> | null, sessions: boolean, limit = PANEL_WINDOW, withSources = false, withFormat = false): Promise<HistoryRow[]> {
  // Sessions on but no live conversation: the panel opens on a fresh chat.
  if (sessions && !conversation) return []
  const run = (cols: string) => {
    let q = supabase.from('agent_history').select(cols).eq('member_id', memberId)
    if (conversation) q = q.or(historyFilter(conversation))
    return q
      .order('created_at', { ascending: false })
      // A turn's question and answer can share a timestamp (older rows). Newest
      // first, 'assistant' sorts before 'user', so after the reverse the
      // question always comes before its answer.
      .order('role', { ascending: true })
      .limit(limit)
  }
  const base = 'role, content, listed_tasks, created_at'
  const cols = [base, withSources ? 'sources' : '', withFormat ? 'reply_format' : ''].filter(Boolean).join(', ')
  const first = await run(cols)
  let data: unknown = first.data
  // Before supabase/cxo_ciao_chat_memory.sql or cxo_ciao_reply_format.sql: read
  // without the missing column (the layout first, then the digest).
  if (first.error && withFormat) {
    const second = await run([base, withSources ? 'sources' : ''].filter(Boolean).join(', '))
    data = second.data
    if (second.error && withSources) ({ data } = await run(base))
  } else if (first.error && withSources) ({ data } = await run(base))
  return ((data ?? []) as unknown as HistoryRow[]).reverse()
}

export async function GET(req: NextRequest) {
  let member, tenant
  try {
    ;({ member, tenant } = await requireMember())
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  // Not signed the agreement yet (or the check failed): no Ciao until they do.
  const wall = await requireSignedMember({ tenant, member })
  if (wall) return wall
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
    const past = (cols: string) => supabase
      .from('agent_history')
      .select(cols)
      .eq('member_id', member.id)
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .order('role', { ascending: false })
      .limit(200)
    let { data, error } = await past('role, content, created_at, reply_format')
    // Before supabase/cxo_ciao_reply_format.sql: read without the layout.
    if (error) ({ data, error } = await past('role, content, created_at'))
    const rows = (data ?? []) as unknown as HistoryRow[]
    return NextResponse.json({
      ok: true,
      messages: rows.filter((r) => r.content && (r.role === 'user' || r.role === 'assistant')).map(wireTurn),
    })
  }
  const cur = await currentConversation(tenant.id, member.id, { peek: true })
  const rows = await loadHistory(member.id, cur.conversation, cur.available, PANEL_WINDOW, false, true)
  return NextResponse.json({
    ok: true,
    messages: rows.filter((r) => r.content).map(wireTurn),
  })
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; display?: unknown; new_chat?: unknown; voice?: unknown } = {}
  try {
    body = (await req.json()) as { text?: unknown; display?: unknown; new_chat?: unknown; voice?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : ''
  const display = typeof body.display === 'string' ? body.display.trim().slice(0, 500) : ''
  // A spoken answer: the reply formatter never lays it out.
  const voice = body.voice === true
  if (body.new_chat === true) {
    let who
    try {
      who = await requireMember()
    } catch {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    const wallNew = await requireSignedMember(who)
    if (wallNew) return wallNew
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
  const wallAsk = await requireSignedMember(ctx)
  if (wallAsk) return wallAsk
  // The conversation this message belongs to: the live one, or a fresh one after 2h idle.
  const cur = await currentConversation(tenant.id, member.id)
  const conversationId = cur.conversation?.id || null
  const newConversation = cur.isNew
  const persistTurn = async (userText: string, assistantText: string, listed?: Array<{ id: string; content: string }>, check?: AnswerCheckMeta, sources?: string | null, format?: StoredFormat | null) => {
    await persistTurnRows(member.id, tenant.id, conversationId, userText, assistantText, listed, check, sources, format)
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
    const [rows, memory] = await Promise.all([
      loadHistory(member.id, cur.conversation, cur.available, TURN_WINDOW, true),
      loadChatMemory(conversationId),
    ])
    const all: AgentHistoryEntry[] = rows.map((h) => ({
      role: h.role,
      content: h.content,
      listed_tasks: h.listed_tasks ?? undefined,
      at: h.created_at,
      sources: h.sources ?? null,
    }))
    // Turns the summary already covers are not sent again word for word.
    const history = memory.open(all)

    const turn = await runChatTurn({ tenant, member, text, history, channel: 'app', conversationId, conversationSummary: memory.summary, ...(voice ? { voice: true } : {}) })
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
    // The layout is stored with the answer so history draws the same; a
    // refused or skipped layout stores only why (for the weekly review).
    const stored: StoredFormat | null = turn.format
      ? { ...turn.format, meta: result.replyFormatMeta ?? null }
      : result.replyFormatMeta ? { meta: result.replyFormatMeta } : null
    await persistTurn(display || text, reply, turn.listedItems, result.answerCheck, result.sourceDigest ?? null, stored)
    // A long chat: fold its older messages into the running summary after the
    // reply is sent (lib/agent/chatMemoryStore), so the person never waits on it.
    if (conversationId && memory.available) {
      const asked = new Date().toISOString()
      const fold = async () => {
        try {
          await maybeFold({
            conversationId,
            memory,
            turns: [...all, { role: 'user', content: display || text, at: asked }, { role: 'assistant', content: reply, at: asked }],
            assistantName: await assistantNameFor({ tenant, member }).catch(() => ASSISTANT_NAME),
          })
        } catch (e) {
          console.warn('[mira/ask] fold failed', e instanceof Error ? e.message : e)
        }
      }
      // after() needs a request scope; anywhere without one the fold is just
      // skipped this turn (the next turn tries again) and the reply still goes out.
      try {
        after(fold)
      } catch {
        /* no request scope */
      }
    }
    if (turn.listedItems && turn.listedItems.length > 0) {
      await updateMember(member.id, {
        settings: {
          ...(member.settings ?? {}),
          last_listed_tasks: turn.listedItems,
          last_listed_tasks_at: new Date().toISOString(),
        },
      }).catch((e: unknown) => console.error('[mira/ask] settings persist failed', e))
    }

    return NextResponse.json({ ok: true, reply, ...(turn.format ? { format: turn.format } : {}), new_conversation: newConversation || undefined })
  } catch (err) {
    console.error('[mira/ask] failed', err)
    return NextResponse.json(
      { ok: true, reply: 'Something hiccuped on my end. Ask me that again in a moment.', error: 'api_error' },
      { status: 200 },
    )
  }
}

/** agent_history.reply_format: the layout drawn (when one was accepted) plus why it ran or not. */
type StoredFormat = Partial<ReplyFormatPayload> & { meta: ReplyFormatMeta | null }

/** Optional columns added by later migrations; a row is retried without the one PostgREST says is missing. */
const OPTIONAL_COLUMNS = ['reply_format', 'sources', 'answer_check'] as const
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]

async function persistTurnRows(
  memberId: string,
  repId: string,
  conversationId: string | null,
  userText: string,
  assistantText: string,
  listed?: Array<{ id: string; content: string }>,
  check?: AnswerCheckMeta,
  sources?: string | null,
  format?: StoredFormat | null,
): Promise<void> {
  // The answer is stamped 1 ms after the question so the pair never ties.
  const askedAt = Date.now()
  const conv = conversationId ? { conversation_id: conversationId } : {}
  const optional: Partial<Record<OptionalColumn, unknown>> = {
    // The Ciao answer check on this reply (supabase/cxo_ciao_answer_check.sql).
    ...(check ? { answer_check: check } : {}),
    // What the answer read (supabase/cxo_ciao_chat_memory.sql).
    ...(sources ? { sources } : {}),
    // The reply formatting step's layout (supabase/cxo_ciao_reply_format.sql).
    ...(format ? { reply_format: format } : {}),
  }
  const rows = () => [
    { member_id: memberId, rep_id: repId, role: 'user', content: userText, created_at: new Date(askedAt).toISOString(), ...conv },
    {
      member_id: memberId,
      rep_id: repId,
      role: 'assistant',
      content: assistantText,
      listed_tasks: listed && listed.length > 0 ? listed : null,
      created_at: new Date(askedAt + 1).toISOString(),
      ...conv,
      ...optional,
    },
  ]
  let { error } = await supabase.from('agent_history').insert(rows())
  // Before a migration added its column: drop the column the error names (or
  // the newest optional one) and try again. The turn itself is always kept.
  for (let i = 0; error && isMissingColumn(error) && i < OPTIONAL_COLUMNS.length; i++) {
    const msg = error.message ?? ''
    const drop = OPTIONAL_COLUMNS.find((c) => c in optional && msg.includes(c)) ?? OPTIONAL_COLUMNS.find((c) => c in optional)
    if (!drop) break
    delete optional[drop]
    ;({ error } = await supabase.from('agent_history').insert(rows()))
  }
  if (error) console.error('[mira/ask] history persist failed', error.message)
}

function isMissingColumn(e: { code?: string; message?: string }): boolean {
  return e.code === '42703' || e.code === 'PGRST204' || /answer_check|sources|reply_format/.test(e.message ?? '')
}
