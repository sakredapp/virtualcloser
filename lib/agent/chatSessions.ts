/**
 * Ciao chat sessions (owner 10-18). A conversation is what Ciao reads back as
 * context and what the chat panel shows. "New chat" starts a fresh one; so
 * does coming back after CIAO_IDLE_MS without a message. Old turns stay in
 * agent_history (tagged with their conversation_id), they are just no longer
 * fed to the model or shown.
 *
 * Tolerant: before the migration (supabase/cxo_ciao_sessions_confirm.sql)
 * every function falls back to "no conversation" and the chat works as before.
 */
import { supabase } from '@/lib/supabase'

export const CIAO_IDLE_MS = 2 * 60 * 60_000

export type Conversation = { id: string; started_at: string; last_at: string }

/** Keep the latest conversation, or start a fresh one (none yet, idle too long, or asked for). */
export function pickConversation(latest: Pick<Conversation, 'last_at'> | null, nowMs: number, fresh = false): 'reuse' | 'new' {
  if (fresh || !latest) return 'new'
  return nowMs - Date.parse(latest.last_at) < CIAO_IDLE_MS ? 'reuse' : 'new'
}

/** A table or column the migration has not made yet (tolerated everywhere here). */
export const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204' || /does not exist|schema cache/i.test(e.message ?? ''))

async function latestConversation(memberId: string): Promise<Conversation | null | undefined> {
  const { data, error } = await supabase.from('ciao_conversations').select('id, started_at, last_at').eq('member_id', memberId).order('last_at', { ascending: false }).limit(1)
  if (error) {
    if (!missing(error)) console.error('[chatSessions] latest', error.message)
    return undefined
  }
  return ((data ?? [])[0] as Conversation | undefined) ?? null
}

async function insertConversation(repId: string, memberId: string, startedAt: Date): Promise<Conversation | null> {
  const iso = startedAt.toISOString()
  const { data, error } = await supabase.from('ciao_conversations').insert({ rep_id: repId, member_id: memberId, started_at: iso, last_at: new Date().toISOString() }).select('id, started_at, last_at').limit(1)
  if (error) {
    if (!missing(error)) console.error('[chatSessions] insert', error.message)
    return null
  }
  return ((data ?? [])[0] as Conversation | undefined) ?? null
}

/**
 * The conversation to use now. `peek` (the panel loading) never creates one:
 * it returns null when the last one has gone idle, so the panel opens empty.
 * Returns isNew when this call started a fresh conversation.
 */
export async function currentConversation(
  repId: string,
  memberId: string,
  opts: { fresh?: boolean; peek?: boolean; now?: number } = {},
): Promise<{ conversation: Conversation | null; isNew: boolean; available: boolean }> {
  const now = opts.now ?? Date.now()
  const latest = await latestConversation(memberId)
  if (latest === undefined) return { conversation: null, isNew: false, available: false }
  if (pickConversation(latest, now, opts.fresh) === 'reuse') return { conversation: latest, isNew: false, available: true }
  if (opts.peek) {
    // First time ever: the turns from before sessions existed still count if recent.
    if (!latest) return { conversation: { id: '', started_at: new Date(now - CIAO_IDLE_MS).toISOString(), last_at: new Date(now).toISOString() }, isNew: false, available: true }
    return { conversation: null, isNew: false, available: true }
  }
  // The very first conversation picks up the last two hours of older, untagged turns.
  const startedAt = new Date(!latest && !opts.fresh ? now - CIAO_IDLE_MS : now)
  const created = await insertConversation(repId, memberId, startedAt)
  if (!created && opts.fresh && latest) {
    // "New chat" could not open a conversation: close the old one so the next
    // message never picks it (and its turns) back up.
    const { error } = await supabase.from('ciao_conversations').update({ last_at: new Date(now - CIAO_IDLE_MS - 60_000).toISOString() }).eq('id', latest.id)
    if (error && !missing(error)) console.error('[chatSessions] close', error.message)
  }
  // Sessions exist (the read above worked), so a failed insert still means a
  // fresh chat: no history, never the old conversation's turns.
  return { conversation: created, isNew: !!latest, available: true }
}

export async function touchConversation(id: string): Promise<void> {
  if (!id) return
  const { error } = await supabase.from('ciao_conversations').update({ last_at: new Date().toISOString() }).eq('id', id)
  if (error && !missing(error)) console.error('[chatSessions] touch', error.message)
}

/** The agent_history filter for one conversation: its own turns, plus untagged turns since it started. */
export function historyFilter(c: Pick<Conversation, 'id' | 'started_at'>): string {
  const since = `created_at.gte.${c.started_at}`
  return c.id ? `conversation_id.eq.${c.id},and(conversation_id.is.null,${since})` : `and(conversation_id.is.null,${since})`
}

/** One past chat in the Ciao screen's left list. */
export type ConversationSummary = {
  id: string
  last_at: string
  title: string
  /** Pinned to the top of Recent (cxo_ciao_chat_folders.sql). */
  pinned?: boolean
  /** The person's folder it sits in, or null. */
  folder_id?: string | null
}

type ConvRow = { id: string; last_at: string; title?: string | null; pinned_at?: string | null; folder_id?: string | null; deleted_at?: string | null }

/** Columns the folders migration adds; read when they exist. */
const ORGANIZE_COLS = 'id, last_at, title, pinned_at, folder_id, deleted_at'

/**
 * The member's recent conversations, newest first, each titled with the name
 * they gave it or else its first question. Deleted chats are left out.
 * `organize` is false before cxo_ciao_chat_folders.sql ran (no pins, folders
 * or names yet; the list still loads). Read-only: never starts, touches or
 * closes a conversation. Empty before the sessions migration ran.
 */
export async function listConversationsRich(memberId: string, limit = 100): Promise<{ chats: ConversationSummary[]; organize: boolean }> {
  const select = (cols: string) => supabase.from('ciao_conversations').select(cols).eq('member_id', memberId).order('last_at', { ascending: false }).limit(limit)
  let organize = true
  let { data, error } = await select(ORGANIZE_COLS)
  if (error && missing(error)) {
    organize = false
    ;({ data, error } = await select('id, last_at'))
  }
  if (error) {
    if (!missing(error)) console.error('[chatSessions] list', error.message)
    return { chats: [], organize: false }
  }
  const convs = ((data ?? []) as unknown as ConvRow[]).filter((c) => !c.deleted_at)
  if (convs.length === 0) return { chats: [], organize }
  const { data: firsts, error: e2 } = await supabase
    .from('agent_history')
    .select('conversation_id, content, created_at')
    .eq('member_id', memberId)
    .eq('role', 'user')
    .in('conversation_id', convs.map((c) => c.id))
    .order('created_at', { ascending: true })
    .limit(2000)
  if (e2 && !missing(e2)) console.error('[chatSessions] titles', e2.message)
  const first = new Map<string, string>()
  for (const r of (firsts ?? []) as Array<{ conversation_id: string; content: string | null }>) {
    if (r.content && !first.has(r.conversation_id)) first.set(r.conversation_id, r.content.replace(/\s+/g, ' ').trim().slice(0, 80))
  }
  // A conversation nobody asked anything in yet (a "New chat" left empty) is not listed.
  const chats = convs
    .filter((c) => first.has(c.id))
    .map((c) => ({
      id: c.id,
      last_at: c.last_at,
      title: c.title?.trim() || first.get(c.id)!,
      ...(organize ? { pinned: !!c.pinned_at, folder_id: c.folder_id ?? null } : {}),
    }))
  return { chats, organize }
}

/** The list alone (older callers). */
export async function listConversations(memberId: string, limit = 30): Promise<ConversationSummary[]> {
  return (await listConversationsRich(memberId, limit)).chats
}

/** One of the member's own conversations by id (null when it is not theirs, was deleted, or does not exist). */
export async function ownConversation(memberId: string, id: string): Promise<Conversation | null> {
  const select = (cols: string) => supabase.from('ciao_conversations').select(cols).eq('member_id', memberId).eq('id', id).limit(1)
  let { data, error } = await select('id, started_at, last_at, deleted_at')
  if (error && missing(error)) ({ data, error } = await select('id, started_at, last_at'))
  if (error) {
    if (!missing(error)) console.error('[chatSessions] own', error.message)
    return null
  }
  const row = ((data ?? [])[0] as unknown as (Conversation & { deleted_at?: string | null }) | undefined) ?? null
  if (!row || row.deleted_at) return null
  return { id: row.id, started_at: row.started_at, last_at: row.last_at }
}
