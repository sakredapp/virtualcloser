/**
 * Mira tools that only ever touch the caller's own work (Suite CXO): their
 * to-dos (cxo_todos), their board cards, and their own meeting notes. Every
 * read and write is keyed by the caller's member id from the session, never
 * by an id the model passes, so nobody can reach a coworker's list through
 * these. Offered to execs and employees alike.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { supabase } from '@/lib/supabase'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const handle_list_my_todos: Handler = async (ctx, args) => {
  const { listTodos } = await import('@/lib/today')
  const rows = await listTodos(ctx.tenant.id, ctx.caller.id)
  const showDone = args.include_done === true
  const items = rows
    .filter((t) => showDone || !t.done_at)
    .slice(0, 60)
    .map((t) => ({ id: t.id, body: t.body, kind: t.kind, priority: t.priority, due_date: t.due_date, done: Boolean(t.done_at), from: t.source, meeting: t.meeting_title }))
  return j({ total: items.length, items })
}

const handle_add_my_todo: Handler = async (ctx, args) => {
  const body = str(args.body, 500)
  if (!body) return j({ ok: false, error: 'body required' })
  const due = str(args.due_date, 10)
  const { addTodo } = await import('@/lib/today')
  const t = await addTodo(ctx.tenant.id, ctx.caller.id, body, { source: 'mira', ...(/^\d{4}-\d{2}-\d{2}$/.test(due) ? { due_date: due } : {}) })
  return j({ ok: true, id: t.id, body: t.body, due_date: t.due_date, say: `Added to your to-dos: ${t.body}` })
}

const handle_complete_my_todo: Handler = async (ctx, args) => {
  const id = str(args.id, 60)
  if (!id) return j({ ok: false, error: 'id required (from list_my_todos)' })
  const { listTodos, updateTodo } = await import('@/lib/today')
  // Only a to-do on the caller's own list can be ticked.
  const mine = (await listTodos(ctx.tenant.id, ctx.caller.id)).find((t) => t.id === id)
  if (!mine) return j({ ok: false, error: 'not_found', say: 'I could not find that on your to-do list.' })
  await updateTodo(ctx.tenant.id, ctx.caller.id, id, { done: args.done !== false })
  return j({ ok: true, id, done: args.done !== false, say: `${args.done === false ? 'Reopened' : 'Done'}: ${mine.body}` })
}

const handle_list_my_cards: Handler = async (ctx) => {
  const { cardsAssignedTo } = await import('@/lib/boards')
  const cards = await cardsAssignedTo(ctx.tenant.id, ctx.caller.id)
  return j({
    total: cards.length,
    items: cards.slice(0, 60).map((c) => ({ id: c.id, title: c.title, board: c.board_name, list: c.list_title, due: (c as { due_date?: string | null }).due_date ?? null })),
  })
}

const handle_list_my_meeting_notes: Handler = async (ctx, args) => {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25)
  const q = str(args.q, 120).toLowerCase()
  const { data, error } = await supabase
    .from('plaud_notes')
    .select('id, title, summary, occurred_at')
    .eq('rep_id', ctx.tenant.id)
    .eq('owner_member_id', ctx.caller.id)
    .order('occurred_at', { ascending: false })
    .limit(q ? 100 : limit)
  if (error) return j({ ok: false, error: 'notes_unavailable' })
  type Row = { id: string; title: string | null; summary: string | null; occurred_at: string | null }
  const rows = ((data ?? []) as Row[])
    .filter((n) => !q || `${n.title ?? ''} ${n.summary ?? ''}`.toLowerCase().includes(q))
    .slice(0, limit)
    .map((n) => ({ id: n.id, title: n.title ?? 'Meeting', when: n.occurred_at, summary: (n.summary ?? '').slice(0, 1500) }))
  return j({ total: rows.length, items: rows })
}

export const SELF_TOOL_HANDLERS: Record<string, Handler> = {
  list_my_todos: handle_list_my_todos,
  add_my_todo: handle_add_my_todo,
  complete_my_todo: handle_complete_my_todo,
  list_my_cards: handle_list_my_cards,
  list_my_meeting_notes: handle_list_my_meeting_notes,
}

export const SELF_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'list_my_todos',
    description: "The caller's own to-do list (Today › To-dos), including requests coworkers sent them. Returns id, body, kind, priority, due date. Only ever the caller's own list.",
    input_schema: { type: 'object', properties: { include_done: { type: 'boolean', description: 'Also include items ticked in the last day.' } }, additionalProperties: false },
  },
  {
    name: 'add_my_todo',
    description: 'Add a to-do to the caller\'s own list ("remind me to send the deck Thursday"). Only the caller\'s own list.',
    input_schema: {
      type: 'object',
      properties: { body: { type: 'string', description: 'The to-do, short.' }, due_date: { type: 'string', description: 'YYYY-MM-DD in their timezone, optional.' } },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_my_todo',
    description: 'Tick (or reopen with done=false) one of the caller\'s own to-dos by id from list_my_todos.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, done: { type: 'boolean' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'list_my_cards',
    description: "Open board cards assigned to the caller (and cards on their own To-do board), with board and column. Only boards they're on.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_my_meeting_notes',
    description: "The caller's own recorded meeting notes (title, when, summary), newest first. q filters by words in the title or summary.",
    input_schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
  },
]
