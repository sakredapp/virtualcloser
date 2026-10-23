/**
 * Ciao chat memory, the stored half (lib/agent/chatMemory has the rules).
 * The running summary of a conversation's older messages lives on
 * ciao_conversations.summary, with summary_through = the time of the last
 * message it covers (supabase/cxo_ciao_chat_memory.sql).
 *
 * Tolerant: before the migration runs, loadChatMemory says `available: false`
 * and the chat works on the token-budgeted window alone.
 */
import { supabase } from '@/lib/supabase'
import { missing } from '@/lib/agent/chatSessions'
import { foldSummary, planFold, unsummarized, type FoldCreate } from '@/lib/agent/chatMemory'

type Turn = { role: 'user' | 'assistant'; content: string; at?: string | null }

export type ChatMemory = {
  /** The summary columns exist and the conversation was read. */
  available: boolean
  summary: string | null
  summaryThrough: string | null
  /** The turns the summary does not cover yet (what is sent word for word). */
  open: <T extends Turn>(turns: T[]) => T[]
}

const NONE: ChatMemory = { available: false, summary: null, summaryThrough: null, open: (t) => t }

export async function loadChatMemory(conversationId: string | null | undefined): Promise<ChatMemory> {
  if (!conversationId) return NONE
  const { data, error } = await supabase.from('ciao_conversations').select('summary, summary_through').eq('id', conversationId).limit(1)
  if (error) {
    if (!missing(error)) console.error('[chatMemory] load', error.message)
    return NONE
  }
  const row = ((data ?? [])[0] as { summary?: string | null; summary_through?: string | null } | undefined) ?? null
  const summary = row?.summary?.trim() || null
  const summaryThrough = summary ? row?.summary_through ?? null : null
  return { available: true, summary, summaryThrough, open: (t) => unsummarized(t, summaryThrough) }
}

/**
 * Fold the older messages into the summary when the chat has grown past
 * SUMMARY_AFTER unsummarized ones. The update only lands if nobody else
 * folded first (summary_through unchanged), so two quick turns never fold
 * the same messages twice. Returns true when a new summary was saved.
 */
export async function maybeFold(input: {
  conversationId: string
  memory: ChatMemory
  /** Every turn read for this answer plus the turn just answered, oldest first. */
  turns: Turn[]
  assistantName: string
  create?: FoldCreate
}): Promise<boolean> {
  if (!input.memory.available) return false
  const plan = planFold(input.memory.open(input.turns))
  if (!plan) return false
  const folded = await foldSummary({ previous: input.memory.summary, turns: plan.fold, assistantName: input.assistantName, create: input.create })
  if (!folded) return false
  let q = supabase
    .from('ciao_conversations')
    .update({ summary: folded.summary, summary_through: plan.through })
    .eq('id', input.conversationId)
  q = input.memory.summaryThrough ? q.eq('summary_through', input.memory.summaryThrough) : q.is('summary_through', null)
  const { error } = await q
  if (error) {
    if (!missing(error)) console.error('[chatMemory] save', error.message)
    return false
  }
  return true
}
