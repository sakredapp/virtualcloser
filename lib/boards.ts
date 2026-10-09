/**
 * Boards — server side (service-role). Every read and write is scoped to the
 * workspace (rep_id); the API route checks the signed-in exec first.
 * Ported from crmbuilds native boards.
 */
import { supabase } from '@/lib/supabase'
import { deliverPartnerEmail, recordPartnerAction } from '@/lib/partners'
import type { Board, BoardCard, BoardList, BoardPerson, CardAssignee, ChecklistItem, CardUrgency } from '@/lib/boardsShared'
import { CARD_STAGES } from '@/lib/boardsShared'

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function fail(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`)
}

/** A table that has not been created yet (migration not run). */
export function boardsMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /cxo_board/.test(e.message ?? '') && /does not exist|schema cache/.test(e.message ?? ''))
}

export async function listBoards(repId: string): Promise<Board[]> {
  const { data, error } = await supabase
    .from('cxo_boards')
    .select('id, name, position, created_by, imported_from, created_at, updated_at')
    .eq('rep_id', repId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  fail(error, 'boards')
  return (data ?? []) as Board[]
}

async function ownBoard(repId: string, boardId: string): Promise<Board> {
  const { data, error } = await supabase
    .from('cxo_boards')
    .select('id, name, position, created_by, imported_from, created_at, updated_at')
    .eq('rep_id', repId)
    .eq('id', boardId)
    .maybeSingle()
  fail(error, 'board')
  if (!data) throw new Error('That board is not on this account.')
  return data as Board
}

export async function boardContents(repId: string, boardId: string) {
  await ownBoard(repId, boardId)
  const [lists, cards, assignees, checklist] = await Promise.all([
    supabase.from('cxo_board_lists').select('id, board_id, title, position').eq('board_id', boardId).order('position'),
    supabase
      .from('cxo_board_cards')
      .select('id, board_id, list_id, title, notes, label_color, due_date, urgency, tags, position, done_at, created_at, updated_at')
      .eq('board_id', boardId)
      .order('position'),
    supabase.from('cxo_board_card_assignees').select('card_id, member_id, partner_id, notified_at').eq('board_id', boardId),
    supabase.from('cxo_board_checklist_items').select('id, card_id, text, done, position').eq('board_id', boardId).order('position'),
  ])
  fail(lists.error, 'lists')
  fail(cards.error, 'cards')
  fail(assignees.error, 'assignees')
  fail(checklist.error, 'checklist')
  return {
    lists: (lists.data ?? []) as BoardList[],
    cards: (cards.data ?? []) as BoardCard[],
    assignees: (assignees.data ?? []) as CardAssignee[],
    checklist: (checklist.data ?? []) as ChecklistItem[],
  }
}

/** Who a card can go to: the workspace's members, then the exec's partners. */
export async function boardPeople(repId: string): Promise<BoardPerson[]> {
  const [members, partners] = await Promise.all([
    supabase.from('members').select('id, display_name, email').eq('rep_id', repId).eq('is_active', true).order('display_name'),
    supabase.from('cxo_partners').select('id, name, email, org').eq('rep_id', repId).order('name'),
  ])
  const out: BoardPerson[] = []
  for (const m of (members.data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
    out.push({ key: `m:${m.id}`, kind: 'member', id: m.id, name: m.display_name || m.email || 'Teammate', email: m.email })
  }
  for (const p of (partners.data ?? []) as Array<{ id: string; name: string; email: string | null; org: string | null }>) {
    out.push({ key: `p:${p.id}`, kind: 'partner', id: p.id, name: p.name, email: p.email, org: p.org })
  }
  return out
}

// ── Boards ──────────────────────────────────────────────────────────────────

export async function createBoard(repId: string, memberId: string | null, name: string, importedFrom: string | null = null): Promise<Board> {
  const boards = await listBoards(repId)
  const { data, error } = await supabase
    .from('cxo_boards')
    .insert({ rep_id: repId, name: clean(name, 120) || 'Untitled board', position: boards.length, created_by: memberId, imported_from: importedFrom })
    .select('id, name, position, created_by, imported_from, created_at, updated_at')
    .single()
  fail(error, 'create board')
  const board = data as Board
  if (!importedFrom) {
    // A new board starts with the three columns everyone makes first.
    await supabase.from('cxo_board_lists').insert(
      ['To do', 'In progress', 'Done'].map((title, i) => ({ board_id: board.id, rep_id: repId, title, position: i })),
    )
  }
  return board
}

/** Marks the ready-made to-do board; its open unassigned cards feed the creator's Today list. */
export const STARTER_BOARD = 'starter:todo'

/**
 * Never an empty Boards page: an account with no boards gets a ready-made
 * "To-do" board (To do / In progress / Done) with two example cards.
 * Returns true when it was just made (the page focuses the title to name it).
 */
export async function ensureStarterBoard(repId: string, memberId: string | null): Promise<boolean> {
  const { count, error } = await supabase.from('cxo_boards').select('id', { count: 'exact', head: true }).eq('rep_id', repId)
  fail(error, 'count boards')
  if ((count ?? 0) > 0) return false
  const { data, error: bErr } = await supabase
    .from('cxo_boards')
    .insert({ rep_id: repId, name: 'To-do', position: 0, created_by: memberId, imported_from: STARTER_BOARD })
    .select('id')
    .single()
  fail(bErr, 'create starter board')
  const boardId = (data as { id: string }).id
  const { data: lists, error: lErr } = await supabase
    .from('cxo_board_lists')
    .insert(['To do', 'In progress', 'Done'].map((title, i) => ({ board_id: boardId, rep_id: repId, title, position: i })))
    .select('id, position')
  fail(lErr, 'starter lists')
  const todo = ((lists ?? []) as Array<{ id: string; position: number }>).find((l) => l.position === 0)
  if (todo) {
    await supabase.from('cxo_board_cards').insert(
      ['Add your first task', 'Assign a task to a partner'].map((title, i) => ({
        board_id: boardId, list_id: todo.id, rep_id: repId, title, position: i, created_by: memberId,
      })),
    )
  }
  return true
}

export async function renameBoard(repId: string, boardId: string, name: string) {
  const { error } = await supabase.from('cxo_boards').update({ name: clean(name, 120) || 'Untitled board' }).eq('rep_id', repId).eq('id', boardId)
  fail(error, 'rename board')
}

export async function deleteBoard(repId: string, boardId: string) {
  const { error } = await supabase.from('cxo_boards').delete().eq('rep_id', repId).eq('id', boardId)
  fail(error, 'delete board')
}

// ── Lists ───────────────────────────────────────────────────────────────────

export async function createList(repId: string, boardId: string, title: string): Promise<BoardList> {
  await ownBoard(repId, boardId)
  const { count } = await supabase.from('cxo_board_lists').select('id', { count: 'exact', head: true }).eq('board_id', boardId)
  const { data, error } = await supabase
    .from('cxo_board_lists')
    .insert({ board_id: boardId, rep_id: repId, title: clean(title, 80) || 'New list', position: count ?? 0 })
    .select('id, board_id, title, position')
    .single()
  fail(error, 'create list')
  return data as BoardList
}

export async function renameList(repId: string, listId: string, title: string) {
  const { error } = await supabase.from('cxo_board_lists').update({ title: clean(title, 80) || 'New list' }).eq('rep_id', repId).eq('id', listId)
  fail(error, 'rename list')
}

export async function deleteList(repId: string, listId: string) {
  const { error } = await supabase.from('cxo_board_lists').delete().eq('rep_id', repId).eq('id', listId)
  fail(error, 'delete list')
}

export async function orderLists(repId: string, ids: string[]) {
  const results = await Promise.all(ids.map((id, i) => supabase.from('cxo_board_lists').update({ position: i }).eq('rep_id', repId).eq('id', id)))
  for (const r of results) fail(r.error, 'order lists')
}

// ── Cards ───────────────────────────────────────────────────────────────────

const CARD_COLS = 'id, board_id, list_id, title, notes, label_color, due_date, urgency, tags, position, done_at, created_at, updated_at'

export async function createCard(repId: string, memberId: string | null, boardId: string, listId: string, title: string): Promise<BoardCard> {
  await ownBoard(repId, boardId)
  const { count } = await supabase.from('cxo_board_cards').select('id', { count: 'exact', head: true }).eq('list_id', listId)
  const { data, error } = await supabase
    .from('cxo_board_cards')
    .insert({ board_id: boardId, list_id: listId, rep_id: repId, title: clean(title, 300), position: count ?? 0, created_by: memberId })
    .select(CARD_COLS)
    .single()
  fail(error, 'create card')
  return data as BoardCard
}

export type CardPatch = {
  title?: string
  notes?: string | null
  label_color?: string | null
  due_date?: string | null
  urgency?: CardUrgency | null
  tags?: string[]
  done?: boolean
}

export async function updateCard(repId: string, cardId: string, patch: CardPatch): Promise<BoardCard> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = clean(patch.title, 300)
  if (patch.notes !== undefined) row.notes = clean(patch.notes ?? '', 8000) || null
  if (patch.label_color !== undefined) row.label_color = CARD_STAGES.some((s) => s.color === patch.label_color) ? patch.label_color : null
  if (patch.due_date !== undefined) row.due_date = patch.due_date && /^\d{4}-\d{2}-\d{2}$/.test(patch.due_date) ? patch.due_date : null
  if (patch.urgency !== undefined) row.urgency = patch.urgency === 'now' || patch.urgency === 'week' || patch.urgency === 'later' ? patch.urgency : null
  if (patch.tags !== undefined) row.tags = (patch.tags ?? []).map((t) => clean(t, 40).replace(/^#/, '')).filter(Boolean).slice(0, 12)
  if (patch.done !== undefined) row.done_at = patch.done ? new Date().toISOString() : null
  const { data, error } = await supabase.from('cxo_board_cards').update(row).eq('rep_id', repId).eq('id', cardId).select(CARD_COLS).single()
  fail(error, 'update card')
  return data as BoardCard
}

export async function deleteCard(repId: string, cardId: string) {
  const { error } = await supabase.from('cxo_board_cards').delete().eq('rep_id', repId).eq('id', cardId)
  fail(error, 'delete card')
}

/** After a drag: put these cards in this list, numbered 0..n in this order. */
export async function placeCards(repId: string, listId: string, ids: string[]) {
  const results = await Promise.all(
    ids.map((id, i) => supabase.from('cxo_board_cards').update({ list_id: listId, position: i }).eq('rep_id', repId).eq('id', id)),
  )
  for (const r of results) fail(r.error, 'move card')
}

// ── Checklist ───────────────────────────────────────────────────────────────

export async function addChecklistItem(repId: string, cardId: string, text: string): Promise<ChecklistItem> {
  const { data: card, error: cErr } = await supabase.from('cxo_board_cards').select('board_id').eq('rep_id', repId).eq('id', cardId).maybeSingle()
  fail(cErr, 'card')
  if (!card) throw new Error('That card is gone.')
  const { count } = await supabase.from('cxo_board_checklist_items').select('id', { count: 'exact', head: true }).eq('card_id', cardId)
  const { data, error } = await supabase
    .from('cxo_board_checklist_items')
    .insert({ card_id: cardId, board_id: (card as { board_id: string }).board_id, rep_id: repId, text: clean(text, 300), position: count ?? 0 })
    .select('id, card_id, text, done, position')
    .single()
  fail(error, 'add checklist item')
  return data as ChecklistItem
}

export async function setChecklistItem(repId: string, itemId: string, patch: { done?: boolean; text?: string }) {
  const row: Record<string, unknown> = {}
  if (patch.done !== undefined) row.done = !!patch.done
  if (patch.text !== undefined) row.text = clean(patch.text, 300)
  const { error } = await supabase.from('cxo_board_checklist_items').update(row).eq('rep_id', repId).eq('id', itemId)
  fail(error, 'checklist item')
}

export async function deleteChecklistItem(repId: string, itemId: string) {
  const { error } = await supabase.from('cxo_board_checklist_items').delete().eq('rep_id', repId).eq('id', itemId)
  fail(error, 'delete checklist item')
}

// ── Assignees ───────────────────────────────────────────────────────────────

export type AssignResult = { notified: string[]; notNotified: Array<{ name: string; reason: string }> }

/**
 * Replace a card's assignees with exactly this set (`m:<id>` / `p:<id>`).
 * A partner newly put on the card is emailed as the exec (Gmail, then SES);
 * the message is logged on the partner's history like every partner send.
 */
export async function setCardAssignees(
  ctx: { repId: string; memberId: string; senderName: string; senderEmail: string | null },
  cardId: string,
  keys: string[],
): Promise<AssignResult> {
  const { data: card, error: cErr } = await supabase
    .from('cxo_board_cards')
    .select('id, board_id, title, notes, due_date, cxo_boards(name)')
    .eq('rep_id', ctx.repId)
    .eq('id', cardId)
    .maybeSingle()
  fail(cErr, 'card')
  if (!card) throw new Error('That card is gone.')
  const c = card as unknown as { id: string; board_id: string; title: string; notes: string | null; due_date: string | null; cxo_boards: { name: string } | { name: string }[] | null }
  const boardName = Array.isArray(c.cxo_boards) ? c.cxo_boards[0]?.name : c.cxo_boards?.name

  const { data: before } = await supabase.from('cxo_board_card_assignees').select('member_id, partner_id').eq('card_id', cardId)
  const had = new Set(((before ?? []) as Array<{ member_id: string | null; partner_id: string | null }>).map((a) => (a.member_id ? `m:${a.member_id}` : `p:${a.partner_id}`)))

  const wanted = Array.from(new Set(keys.filter((k) => /^[mp]:[0-9a-f-]{36}$/i.test(k)))).slice(0, 20)
  // Only people on this account.
  const people = await boardPeople(ctx.repId)
  const byKey = new Map(people.map((p) => [p.key, p]))
  const valid = wanted.filter((k) => byKey.has(k))

  // Clear then insert: a half-applied change leaves fewer names, never a stale one.
  const del = await supabase.from('cxo_board_card_assignees').delete().eq('card_id', cardId)
  fail(del.error, 'clear assignees')
  if (valid.length) {
    const rows = valid.map((k) => ({
      card_id: cardId,
      board_id: c.board_id,
      rep_id: ctx.repId,
      member_id: k.startsWith('m:') ? k.slice(2) : null,
      partner_id: k.startsWith('p:') ? k.slice(2) : null,
    }))
    const ins = await supabase.from('cxo_board_card_assignees').insert(rows)
    fail(ins.error, 'assign')
  }

  const result: AssignResult = { notified: [], notNotified: [] }
  for (const k of valid) {
    if (!k.startsWith('p:') || had.has(k)) continue
    const p = byKey.get(k)!
    const subject = `${c.title || 'A card'}${boardName ? ` · ${boardName}` : ''}`
    const lines = [
      `Hi ${p.name.split(/\s+/)[0]},`,
      '',
      `I've put this on your plate: ${c.title || 'a card'}${boardName ? ` (${boardName})` : ''}.`,
    ]
    if (c.due_date) lines.push(`Due ${new Date(c.due_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`)
    if (c.notes) lines.push('', c.notes)
    lines.push('', 'Reply here with any questions.', '', ctx.senderName)
    const body = lines.join('\n')
    const sent = await deliverPartnerEmail({
      repId: ctx.repId,
      memberId: ctx.memberId,
      senderName: ctx.senderName,
      senderEmail: ctx.senderEmail,
      to: p.email,
      subject,
      body,
    }).catch((err: unknown) => ({ sent: false as const, channel: 'none' as const, reason: err instanceof Error ? err.message : 'send failed' }))
    await recordPartnerAction({
      repId: ctx.repId,
      partnerId: p.id,
      kind: 'task',
      subject,
      body,
      status: sent.sent ? 'sent' : 'draft',
      sentTo: p.email,
      channel: sent.sent ? (sent as { channel: 'gmail' | 'ses' }).channel : null,
      providerId: sent.sent ? ((sent as { providerId?: string | null }).providerId ?? null) : null,
      createdBy: ctx.memberId,
      dueAt: c.due_date ? `${c.due_date}T17:00:00Z` : null,
    }).catch(() => null)
    if (sent.sent) {
      result.notified.push(p.name)
      await supabase.from('cxo_board_card_assignees').update({ notified_at: new Date().toISOString() }).eq('card_id', cardId).eq('partner_id', p.id)
    } else {
      result.notNotified.push({ name: p.name, reason: (sent as { reason?: string }).reason ?? 'not sent' })
    }
  }
  return result
}

// ── Import ──────────────────────────────────────────────────────────────────

export type ImportPayload = {
  name: string
  source: string
  lists: Array<{
    title: string
    cards: Array<{ title: string; notes?: string | null; due?: string | null; tags?: string[]; done?: boolean; checklist?: Array<{ text: string; done: boolean }> }>
  }>
}

/** Make a board from a parsed export (the page parses the file). */
export async function importBoard(repId: string, memberId: string | null, payload: ImportPayload): Promise<{ board: Board; cards: number }> {
  const lists = (payload.lists ?? []).slice(0, 60)
  const board = await createBoard(repId, memberId, payload.name || 'Imported board', clean(payload.source, 40) || 'file')
  let cardCount = 0
  for (let li = 0; li < lists.length; li++) {
    const l = lists[li]
    const { data: listRow, error } = await supabase
      .from('cxo_board_lists')
      .insert({ board_id: board.id, rep_id: repId, title: clean(l.title, 80) || 'List', position: li })
      .select('id')
      .single()
    fail(error, 'import list')
    const listId = (listRow as { id: string }).id
    const cards = (l.cards ?? []).slice(0, 500)
    for (let start = 0; start < cards.length; start += 200) {
      const chunk = cards.slice(start, start + 200)
      const { data: inserted, error: cErr } = await supabase
        .from('cxo_board_cards')
        .insert(
          chunk.map((c, i) => ({
            board_id: board.id,
            list_id: listId,
            rep_id: repId,
            title: clean(c.title, 300) || 'Untitled',
            notes: clean(c.notes ?? '', 8000) || null,
            due_date: c.due && /^\d{4}-\d{2}-\d{2}/.test(c.due) ? c.due.slice(0, 10) : null,
            tags: (c.tags ?? []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 12),
            done_at: c.done ? new Date().toISOString() : null,
            position: start + i,
            created_by: memberId,
          })),
        )
        .select('id')
      fail(cErr, 'import cards')
      cardCount += chunk.length
      const ids = ((inserted ?? []) as Array<{ id: string }>).map((r) => r.id)
      const items = chunk.flatMap((c, i) =>
        (c.checklist ?? []).slice(0, 50).map((it, pos) => ({ card_id: ids[i], board_id: board.id, rep_id: repId, text: clean(it.text, 300), done: !!it.done, position: pos })),
      ).filter((r) => r.card_id && r.text)
      if (items.length) {
        const { error: iErr } = await supabase.from('cxo_board_checklist_items').insert(items)
        fail(iErr, 'import checklist')
      }
    }
  }
  return { board, cards: cardCount }
}

// ── Today ───────────────────────────────────────────────────────────────────

export type AssignedCard = BoardCard & { board_name: string; list_title: string }

/** Open cards assigned to this member, across every board, for Today. */
export async function cardsAssignedTo(repId: string, memberId: string): Promise<AssignedCard[]> {
  const { data: links, error } = await supabase.from('cxo_board_card_assignees').select('card_id').eq('rep_id', repId).eq('member_id', memberId)
  fail(error, 'assigned')
  const ids = ((links ?? []) as Array<{ card_id: string }>).map((l) => l.card_id)
  // The member's own To-do board feeds Today too: its open cards nobody else holds.
  const { data: own } = await supabase.from('cxo_boards').select('id').eq('rep_id', repId).eq('imported_from', STARTER_BOARD).eq('created_by', memberId)
  const ownBoards = ((own ?? []) as Array<{ id: string }>).map((b) => b.id)
  if (ownBoards.length) {
    const { data: ownCards } = await supabase.from('cxo_board_cards').select('id').eq('rep_id', repId).in('board_id', ownBoards).is('done_at', null).limit(200)
    const ownIds = ((ownCards ?? []) as Array<{ id: string }>).map((c) => c.id)
    if (ownIds.length) {
      const { data: held } = await supabase.from('cxo_board_card_assignees').select('card_id, member_id').in('card_id', ownIds)
      const heldByOthers = new Set(((held ?? []) as Array<{ card_id: string; member_id: string | null }>).filter((h) => h.member_id !== memberId).map((h) => h.card_id))
      for (const id of ownIds) if (!heldByOthers.has(id) && !ids.includes(id)) ids.push(id)
    }
  }
  if (!ids.length) return []
  const { data, error: cErr } = await supabase
    .from('cxo_board_cards')
    .select(`${CARD_COLS}, cxo_boards(name), cxo_board_lists(title)`)
    .eq('rep_id', repId)
    .in('id', ids.slice(0, 200))
    .is('done_at', null)
  fail(cErr, 'assigned cards')
  type Row = BoardCard & { cxo_boards: { name: string } | null; cxo_board_lists: { title: string } | null }
  return ((data ?? []) as unknown as Row[])
    .map(({ cxo_boards, cxo_board_lists, ...c }) => ({ ...c, board_name: cxo_boards?.name ?? 'Board', list_title: cxo_board_lists?.title ?? '' }))
    // A card sitting in a "Done" column is done even if nobody ticked it.
    .filter((c) => !/^done$|^complete/i.test(c.list_title.trim()))
}
