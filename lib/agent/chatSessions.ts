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

const missing = (e: { code?: string; message?: string } | null) =>
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
