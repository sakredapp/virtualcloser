/**
 * Meetings -> to-dos -> boards, one loop (owner 10-09). Every meeting note
 * (Wispr, Plaud, Fathom, Fireflies, Zapier inbound… all land in plaud_notes)
 * is read once by Mira into:
 *   - action items  -> the exec's to-do list, the meeting as source
 *   - projects (multi-step, or owned by someone else) -> a card on the exec's
 *     To-do board, assigned to the partner the transcript names
 *   - decisions and notes -> kept on the meeting (plaud_notes.mira_digest)
 *   - follow-ups owed to partners -> a "Draft email" suggestion; a draft is
 *     written only when the exec taps, and never sent from here
 * The same thing raised again updates the existing to-do/card instead of
 * adding one. A transcript saying something is finished ticks the matching
 * item when Mira is sure, and asks on Today when she is not.
 * Corrections the exec makes (moved, reassigned, deleted) are logged and
 * shown to Mira on the next read so she files the same way next time.
 */
import type * as AI from '@/lib/aiTypes'
import { getAI, hasAIKey } from '@/lib/ai'
import { supabase } from '@/lib/supabase'
import { STARTER_BOARD, cardsAssignedTo, ensureStarterBoard, type AssignedCard } from '@/lib/boards'
import { asKind, asPriority } from '@/lib/today'
import { textModelId } from '@/lib/aiProvider'

const MODEL = textModelId()
const SURE = 0.8

export type Followup = { partner_id: string; partner_name: string; about: string; drafted_at?: string | null; dismissed?: boolean }
export type DoneSuggestion = { kind: 'todo' | 'card'; id: string; text: string; evidence: string; dismissed?: boolean }
/** One action item from the meeting, whoever owns it. `owner` is the name as
 *  said in the meeting (null = nobody named); `due` is YYYY-MM-DD when a date
 *  was said or clearly implied, else null. Sent to each owner's Today from
 *  the Meetings page. */
export type MeetingItem = { text: string; owner: string | null; due: string | null }
export type MeetingDigest = {
  /** Every action item with its owner and due date (absent on notes read before 10-10). */
  items?: MeetingItem[]
  decisions: string[]
  notes: string[]
  followups: Followup[]
  done_suggestions: DoneSuggestion[]
  auto_done: Array<{ kind: 'todo' | 'card'; id: string; text: string }>
  filed: { todos: number; updated: number; cards: number }
  processed_at: string
}

type Partner = { id: string; name: string; org: string | null; email: string | null; phone: string | null }
type OpenTodo = { id: string; body: string }

export async function logCorrection(repId: string, memberId: string | null, kind: string, item: string, detail: string | null = null) {
  await supabase.from('cxo_mira_corrections').insert({ rep_id: repId, member_id: memberId, kind, item: item.slice(0, 300), detail: detail?.slice(0, 300) ?? null })
}

async function recentCorrections(repId: string): Promise<string[]> {
  const { data } = await supabase.from('cxo_mira_corrections').select('kind, item, detail').eq('rep_id', repId).order('created_at', { ascending: false }).limit(25)
  const words: Record<string, string> = {
    todo_to_card: 'was filed as a to-do; the exec moved it to the board (treat this kind as a project)',
    card_to_todo: 'was filed as a board card; the exec moved it to the to-do list (treat this kind as a simple to-do)',
    reassign: 'was assigned wrongly; the exec reassigned it',
    deleted_todo: 'was filed as a to-do and the exec deleted it (do not file this kind of thing)',
    deleted_card: 'was filed as a card and the exec deleted it (do not file this kind of thing)',
    not_done: 'was marked done by Mira; the exec said it is not done',
  }
  return ((data ?? []) as Array<{ kind: string; item: string; detail: string | null }>).map((c) => `"${c.item}" ${words[c.kind] ?? c.kind}${c.detail ? ` (${c.detail})` : ''}`)
}

/** The exec's own To-do board and its first column (made if missing). */
export async function ownBoard(repId: string, memberId: string): Promise<{ boardId: string; listId: string } | null> {
  await ensureStarterBoard(repId, memberId).catch(() => false)
  const { data: own } = await supabase.from('cxo_boards').select('id').eq('rep_id', repId).eq('imported_from', STARTER_BOARD).eq('created_by', memberId).order('created_at').limit(5)
  let boardId = ((own ?? []) as Array<{ id: string }>)[0]?.id
  if (!boardId) {
    const { data: any1 } = await supabase.from('cxo_boards').select('id').eq('rep_id', repId).order('position').limit(1)
    boardId = ((any1 ?? []) as Array<{ id: string }>)[0]?.id
  }
  if (!boardId) return null
  const { data: lists } = await supabase.from('cxo_board_lists').select('id, title, position').eq('board_id', boardId).order('position')
  const ls = (lists ?? []) as Array<{ id: string; title: string }>
  const list = ls.find((l) => /^to ?do$/i.test(l.title.trim())) ?? ls[0]
  return list ? { boardId, listId: list.id } : null
}

export async function addCard(repId: string, memberId: string, title: string, notes: string | null, partnerId: string | null): Promise<string | null> {
  const where = await ownBoard(repId, memberId)
  if (!where) return null
  const { count } = await supabase.from('cxo_board_cards').select('id', { count: 'exact', head: true }).eq('list_id', where.listId)
  const { data, error } = await supabase
    .from('cxo_board_cards')
    .insert({ board_id: where.boardId, list_id: where.listId, rep_id: repId, title: title.slice(0, 200), notes, position: count ?? 0, created_by: memberId })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (partnerId) await supabase.from('cxo_board_card_assignees').insert({ card_id: id, board_id: where.boardId, rep_id: repId, partner_id: partnerId })
  return id
}

function parseJson(raw: string): Record<string, unknown> | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
}
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : [])
const strs = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((s) => s.length > 2).slice(0, n) : [])
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** A YYYY-MM-DD due date that is a real calendar day, else null. */
export function asDue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : null
}

/** The model's "items" list, cleaned: text required, owner/due optional. */
export function asItems(v: unknown): MeetingItem[] {
  return arr(v)
    .map((x) => {
      const owner = str(x.owner, 80)
      return { text: str(x.text, 400), owner: owner && !/^(null|none|unknown|n\/a)$/i.test(owner) ? owner : null, due: asDue(x.due) }
    })
    .filter((x) => x.text.length > 2)
    .slice(0, 15)
}

type Note = { id: string; title: string | null; summary: string | null; transcript: string | null; action_items: string[] | null; occurred_at: string; attendees: unknown }

/** Read one meeting note into the loop. Idempotent per note via cxo_todo_note_scans. */
export async function processMeetingNote(repId: string, memberId: string, n: Note, ctx: { partners: Partner[]; todos: OpenTodo[]; cards: AssignedCard[]; corrections: string[] }): Promise<MeetingDigest> {
  const title = n.title || 'Meeting'
  const text = [n.summary, n.transcript].filter(Boolean).join('\n\n')
  const digest: MeetingDigest = { decisions: [], notes: [], followups: [], done_suggestions: [], auto_done: [], filed: { todos: 0, updated: 0, cards: 0 }, processed_at: new Date().toISOString() }
  if (!hasAIKey() || (text.trim().length < 40 && !(n.action_items ?? []).length)) return digest

  const T = ctx.todos.slice(0, 60)
  const C = ctx.cards.slice(0, 60)
  const P = ctx.partners.slice(0, 120)
  const attendees = Array.isArray(n.attendees) ? (n.attendees as Array<Record<string, unknown>>).map((a) => str(a.name ?? a.displayName ?? a.email, 80)).filter(Boolean).join(', ') : ''
  const prompt = `You file an executive's meeting into their command center. Meeting: "${title.slice(0, 140)}" on ${n.occurred_at.slice(0, 10)}${attendees ? `, attendees: ${attendees}` : ''}.

Their OPEN to-dos:
${T.map((t, i) => `T${i + 1}: ${t.body}`).join('\n') || '(none)'}

Their OPEN board cards:
${C.map((c, i) => `C${i + 1}: ${c.title}`).join('\n') || '(none)'}

Partners (people outside the company they work with):
${P.map((p, i) => `P${i + 1}: ${p.name}${p.org ? ` (${p.org})` : ''}`).join('\n') || '(none)'}
${ctx.corrections.length ? `\nHow the executive corrected your past filing (follow these):\n${ctx.corrections.map((c) => `- ${c}`).join('\n')}\n` : ''}${(n.action_items ?? []).length ? `\nAction items the note-taker already listed:\n${(n.action_items ?? []).map((a) => `- ${a}`).join('\n')}\n` : ''}
Sort what the meeting produced:
- "items": EVERY action item agreed in the meeting, whoever owns it. "text": short, starts with a verb. "owner": the person's name exactly as said in the meeting (first name is fine), or null when nobody was named. "due": the due date as YYYY-MM-DD when one was said or clearly implied relative to the meeting date (e.g. "by Friday"), else null. At most 15.
- "todos": single concrete actions the executive owns (send, call, decide, check). Short, start with a verb, name the person/company. If one matches an open to-do above, give its id in "existing" instead of repeating it. "type": email (send someone an email), call (phone someone), prep (get ready for a meeting), team (an agent or agency issue), personal, or task. "priority": high only when it is time-critical or money is at stake, low when it can wait, else normal. "partner": the P id when it is about a partner above.
- "projects": multi-step work, or work someone else owns. Title + one-line detail. If a partner above owns it, give their P id in "partner". If it matches an open card, give the C id in "existing".
- "decisions": what was decided. "notes": other facts worth keeping (max 5).
- "followups": things the executive owes a partner above by email ("partner" = P id, "about" = what to send).
- "done": open to-dos or cards (T/C ids) the meeting says are finished, with "confidence" 0-1 and short "evidence".
Skip small talk, anything vague, and anything already done. At most 8 todos, 5 projects.
Return ONLY JSON: {"items":[{"text":"","owner":null,"due":null}],"todos":[{"text":"","type":"task","priority":"normal","partner":null,"existing":null,"due":null}],"projects":[{"title":"","detail":"","partner":null,"existing":null}],"decisions":[],"notes":[],"followups":[{"partner":"P1","about":""}],"done":[{"id":"T1","confidence":0.9,"evidence":""}]}

Meeting notes:
${text.slice(0, 14000)}`
  const msg = await getAI().messages.create({ model: MODEL, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] })
  const out = parseJson(msg.content[0]?.type === 'text' ? msg.content[0].text : '')
  if (!out) return digest

  const pick = <X,>(id: unknown, prefix: string, list: X[]): X | null => {
    const m = typeof id === 'string' ? id.trim().match(new RegExp(`^${prefix}(\\d+)$`, 'i')) : null
    return m ? list[Number(m[1]) - 1] ?? null : null
  }
  const stamp = `${title.slice(0, 80)}, ${new Date(n.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  // To-dos: new ones in, repeats bump the existing item to this meeting.
  const newTodos: Array<Record<string, unknown>> = []
  const mentioned: string[] = []
  for (const [i, t] of arr(out.todos).slice(0, 8).entries()) {
    const hit = pick(t.existing, 'T', T)
    if (hit) {
      mentioned.push(hit.id)
      digest.filed.updated++
      continue
    }
    const body = str(t.text, 500)
    const partner = pick(t.partner, 'P', P)
    if (body)
      newTodos.push({
        rep_id: repId,
        member_id: memberId,
        body,
        source: 'meeting',
        note_id: n.id,
        meeting_title: title.slice(0, 200),
        meeting_at: n.occurred_at,
        source_key: `note:${n.id}:${i}`,
        kind: asKind(t.type),
        priority: asPriority(t.priority),
        due_date: asDue(t.due),
        ...(partner
          ? { partner_id: partner.id, partner_name: partner.name, link_kind: 'partner', link_id: partner.id, link_label: partner.name, link_phone: partner.phone, link_email: partner.email }
          : {}),
      })
  }
  // Repeats: one atomic increment for all of them (no read-then-write race).
  if (mentioned.length) {
    const { error } = await supabase.rpc('cxo_bump_todo_mentions', {
      p_rep_id: repId,
      p_member_id: memberId,
      p_ids: mentioned,
      p_note_id: n.id,
      p_title: title.slice(0, 200),
      p_at: n.occurred_at,
    })
    if (error) throw error
  }
  if (newTodos.length) {
    const { error } = await supabase.from('cxo_todos').insert(newTodos)
    if (error && error.code !== '23505') throw error
    if (!error) digest.filed.todos += newTodos.length
  }

  // Projects: board cards, assigned to the partner named; repeats add a line.
  for (const p of arr(out.projects).slice(0, 5)) {
    const hit = pick(p.existing, 'C', C)
    const detail = str(p.detail, 400)
    if (hit) {
      const { data: cur } = await supabase.from('cxo_board_cards').select('notes').eq('id', hit.id).maybeSingle()
      const prev = (cur as { notes?: string | null } | null)?.notes ?? ''
      await supabase.from('cxo_board_cards').update({ notes: `${prev ? prev + '\n' : ''}Raised again in ${stamp}${detail ? `: ${detail}` : ''}`.slice(0, 4000) }).eq('id', hit.id).eq('rep_id', repId)
      digest.filed.updated++
      continue
    }
    const t = str(p.title, 200)
    if (!t) continue
    const partner = pick(p.partner, 'P', P)
    await addCard(repId, memberId, t, `From ${stamp}${detail ? `: ${detail}` : ''}`, partner?.id ?? null)
    digest.filed.cards++
  }

  digest.items = asItems(out.items)
  digest.decisions = strs(out.decisions, 8)
  digest.notes = strs(out.notes, 5)
  for (const f of arr(out.followups).slice(0, 5)) {
    const partner = pick(f.partner, 'P', P)
    const about = str(f.about, 300)
    if (partner && about) digest.followups.push({ partner_id: partner.id, partner_name: partner.name, about })
  }

  // Done: sure -> tick it (shown as "Mira ticked"); unsure -> ask on Today.
  for (const d of arr(out.done).slice(0, 8)) {
    const conf = Number(d.confidence) || 0
    const evidence = str(d.evidence, 200)
    const todo = pick(d.id, 'T', T)
    const card = pick(d.id, 'C', C)
    const item = todo ? { kind: 'todo' as const, id: todo.id, text: todo.body } : card ? { kind: 'card' as const, id: card.id, text: card.title } : null
    if (!item) continue
    if (conf >= SURE) {
      const now = new Date().toISOString()
      if (item.kind === 'todo') await supabase.from('cxo_todos').update({ done_at: now }).eq('id', item.id).eq('rep_id', repId)
      else await supabase.from('cxo_board_cards').update({ done_at: now }).eq('id', item.id).eq('rep_id', repId)
      digest.auto_done.push(item)
    } else {
      digest.done_suggestions.push({ ...item, evidence })
    }
  }
  return digest
}

const CLAIMED = -1
const CLAIM_STALE_MS = 10 * 60_000

/**
 * Claim a note for processing: INSERT … ON CONFLICT DO NOTHING RETURNING, or
 * take over a claim whose holder died. Only one caller can win either.
 */
async function claimNote(repId: string, noteId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const { data: fresh } = await supabase
    .from('cxo_todo_note_scans')
    .upsert({ note_id: noteId, rep_id: repId, items: CLAIMED, scanned_at: now }, { onConflict: 'note_id', ignoreDuplicates: true })
    .select('note_id')
  if (fresh?.length) return true
  const { data: stolen } = await supabase
    .from('cxo_todo_note_scans')
    .update({ scanned_at: now })
    .eq('note_id', noteId)
    .eq('items', CLAIMED)
    .lt('scanned_at', new Date(Date.now() - CLAIM_STALE_MS).toISOString())
    .select('note_id')
  return !!stolen?.length
}

/**
 * Read new meeting notes into the loop, a few per call (the Today page calls
 * until caught up). Looks back 21 days.
 */
export async function scanMeetingNotes(repId: string, memberId: string, max = 3): Promise<{ scanned: number; added: number; pending: number }> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString()
  const { data: notes, error } = await supabase
    .from('plaud_notes')
    .select('id, title, summary, transcript, action_items, occurred_at, attendees')
    .eq('rep_id', repId)
    .gte('occurred_at', since)
    .or(`owner_member_id.is.null,owner_member_id.eq.${memberId}`)
    .order('occurred_at', { ascending: true })
    .limit(60)
  if (error) throw error
  const all = (notes ?? []) as Note[]
  if (!all.length) return { scanned: 0, added: 0, pending: 0 }
  const { data: done } = await supabase.from('cxo_todo_note_scans').select('note_id, items, scanned_at').in('note_id', all.map((n) => n.id))
  const staleClaim = Date.now() - CLAIM_STALE_MS
  // A note is done once scanned; a claim (items = -1) blocks it unless the
  // process holding it died more than CLAIM_STALE_MS ago.
  const seen = new Set(
    ((done ?? []) as Array<{ note_id: string; items: number; scanned_at: string }>)
      .filter((d) => d.items !== CLAIMED || new Date(d.scanned_at).getTime() > staleClaim)
      .map((d) => d.note_id),
  )
  const todo = all.filter((n) => !seen.has(n.id))
  const batch = todo.slice(0, max)
  let added = 0
  // Oldest first, one at a time: a later meeting dedupes against what an
  // earlier one just filed.
  for (const n of batch) {
    // Claim the note atomically so two Today loads never process it twice.
    if (!(await claimNote(repId, n.id))) continue
    const [partners, todos, cards, corrections] = await Promise.all([
      supabase.from('cxo_partners').select('id, name, org, email, phone').eq('rep_id', repId).order('name').then((r) => (r.data ?? []) as Partner[]),
      supabase.from('cxo_todos').select('id, body').eq('rep_id', repId).eq('member_id', memberId).is('deleted_at', null).is('done_at', null).limit(80).then((r) => (r.data ?? []) as OpenTodo[]),
      cardsAssignedTo(repId, memberId).catch(() => [] as AssignedCard[]),
      recentCorrections(repId).catch(() => [] as string[]),
    ])
    const digest = await processMeetingNote(repId, memberId, n, { partners, todos, cards, corrections }).catch((err) => {
      console.error('[meetingLoop] note', n.id, err instanceof Error ? err.message : err)
      return null
    })
    if (!digest) {
      // Failed: release the claim so a later load retries it.
      await supabase.from('cxo_todo_note_scans').delete().eq('note_id', n.id).eq('items', CLAIMED)
      continue
    }
    added += digest.filed.todos + digest.filed.cards
    await supabase.from('plaud_notes').update({ mira_digest: digest }).eq('id', n.id).eq('rep_id', repId)
    await supabase.from('cxo_todo_note_scans').upsert({ note_id: n.id, rep_id: repId, items: digest.filed.todos + digest.filed.cards })
  }
  return { scanned: batch.length, added, pending: Math.max(0, todo.length - batch.length) }
}

// ── What Today shows from the loop ─────────────────────────────────────────

export type LoopInbox = {
  followups: Array<Followup & { note_id: string; meeting: string; idx: number }>
  doneAsks: Array<DoneSuggestion & { note_id: string; meeting: string; idx: number }>
  ticked: Array<{ kind: 'todo' | 'card'; id: string; text: string; meeting: string }>
}

export async function loopInbox(repId: string, memberId: string): Promise<LoopInbox> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('plaud_notes')
    .select('id, title, mira_digest, occurred_at')
    .eq('rep_id', repId)
    .gte('occurred_at', since)
    .or(`owner_member_id.is.null,owner_member_id.eq.${memberId}`)
    .not('mira_digest', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(30)
  const out: LoopInbox = { followups: [], doneAsks: [], ticked: [] }
  for (const n of (data ?? []) as Array<{ id: string; title: string | null; mira_digest: MeetingDigest }>) {
    const d = n.mira_digest
    const meeting = n.title || 'Meeting'
    ;(d.followups ?? []).forEach((f, idx) => !f.drafted_at && !f.dismissed && out.followups.push({ ...f, note_id: n.id, meeting, idx }))
    ;(d.done_suggestions ?? []).forEach((s, idx) => !s.dismissed && out.doneAsks.push({ ...s, note_id: n.id, meeting, idx }))
    for (const t of d.auto_done ?? []) out.ticked.push({ ...t, meeting })
  }
  return { followups: out.followups.slice(0, 6), doneAsks: out.doneAsks.slice(0, 6), ticked: out.ticked.slice(0, 6) }
}

/** Mark a follow-up drafted/dismissed, or a done-ask dismissed, on its meeting. */
export async function patchDigest(
  repId: string,
  noteId: string,
  list: 'followups' | 'done_suggestions',
  idx: number,
  patch: Record<string, unknown>,
  memberId: string,
) {
  // Only a shared note (no owner) or the member's own note.
  const { data } = await supabase
    .from('plaud_notes')
    .select('mira_digest')
    .eq('id', noteId)
    .eq('rep_id', repId)
    .or(`owner_member_id.is.null,owner_member_id.eq.${memberId}`)
    .maybeSingle()
  const d = (data as { mira_digest: MeetingDigest | null } | null)?.mira_digest
  if (!d || !d[list]?.[idx]) return
  ;(d[list] as Array<Record<string, unknown>>)[idx] = { ...(d[list] as Array<Record<string, unknown>>)[idx], ...patch }
  await supabase.from('plaud_notes').update({ mira_digest: d }).eq('id', noteId).eq('rep_id', repId)
}
