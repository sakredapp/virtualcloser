/**
 * Boards — types and vocabulary shared by the Boards page, Today and the API.
 * Ported from crmbuilds native boards (client/src/lib/boards.ts).
 */

export type Board = {
  id: string
  name: string
  position: number
  created_by: string | null
  imported_from: string | null
  created_at: string
  updated_at: string
}

export type BoardList = { id: string; board_id: string; title: string; position: number }

/** WHEN it has to happen — not how bad it is. Red is reserved for "now". */
export type CardUrgency = 'now' | 'week' | 'later'

export const CARD_URGENCY: { value: CardUrgency; label: string }[] = [
  { value: 'now', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'later', label: 'Can wait' },
]

export function urgencyLabel(u: CardUrgency | null | undefined): string | null {
  return CARD_URGENCY.find((x) => x.value === u)?.label ?? null
}

export type BoardCard = {
  id: string
  board_id: string
  list_id: string
  title: string
  notes: string | null
  label_color: string | null
  due_date: string | null
  urgency: CardUrgency | null
  tags: string[]
  position: number
  done_at: string | null
  created_at: string
  updated_at: string
  created_by?: string | null
  /** Set when an executive assistant added the card for its owner. */
  acted_by_name?: string | null
}

export type CardAssignee = {
  card_id: string
  member_id: string | null
  partner_id: string | null
  notified_at: string | null
}

export type ChecklistItem = { id: string; card_id: string; text: string; done: boolean; position: number }

export type BoardPerson = {
  /** `m:<member id>` or `p:<partner id>` — one picker for both kinds. */
  key: string
  kind: 'member' | 'partner'
  id: string
  name: string
  email: string | null
  org?: string | null
  /** Member role (owner/admin/…) or the partner's title. */
  role?: string | null
}

// THE SWATCH IS THE STAGE, AND IT HAS A NAME (owner 2026-09-14): the card
// always shows the word next to the swatch. Charcoal tints only (brand: red is
// the action colour and stays off the swatches).
export const CARD_STAGES: { color: string; label: string }[] = [
  { color: '#1C1B1A', label: 'In progress' },
  { color: '#4A4846', label: 'Stalemate' },
  { color: '#77746F', label: 'Waiting on someone' },
  { color: '#A39F98', label: 'Planned' },
  { color: '#C9C3B6', label: 'Needs review' },
  { color: '#E4DDCD', label: 'Approved' },
]

export function stageLabel(color: string | null | undefined): string | null {
  return CARD_STAGES.find((s) => s.color === color)?.label ?? null
}

export function personKey(a: { member_id: string | null; partner_id: string | null }): string {
  return a.member_id ? `m:${a.member_id}` : `p:${a.partner_id}`
}

export function initialsFor(name: string | null | undefined): string {
  const n = (name || '').trim()
  if (!n) return '?'
  const parts = n.split(/[\s@.]+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || n.slice(0, 2).toUpperCase()
}

/** A board ready to insert: from a link, pasted text or a file. */
export type ImportPayload = {
  name: string
  source: string
  lists: Array<{
    title: string
    cards: Array<{ title: string; notes?: string | null; due?: string | null; tags?: string[]; done?: boolean; checklist?: Array<{ text: string; done: boolean }> }>
  }>
}

const ROLE_WORD: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', exec: 'Executive' }

/**
 * The small grey line under a name in the Who-has-it picker. Two people with
 * the same name show their email so they can be told apart; otherwise members
 * show their role and partners their organisation.
 */
export function personSubline(p: BoardPerson, all: BoardPerson[]): string {
  const norm = (s: string) => s.trim().toLowerCase()
  const dup = all.some((o) => o.key !== p.key && norm(o.name) === norm(p.name))
  const role = p.role ? ROLE_WORD[p.role.toLowerCase()] ?? p.role : null
  if (dup) return p.email || [role, p.kind === 'partner' ? p.org : null].filter(Boolean).join(' · ') || (p.kind === 'partner' ? 'Partner' : 'Teammate')
  if (p.kind === 'partner') return ['Partner', p.org || p.role].filter(Boolean).join(' · ')
  return role || 'Teammate'
}

/** True when a YYYY-MM-DD due date is before today (local). */
export function isOverdue(due: string | null | undefined, today = new Date()): boolean {
  if (!due) return false
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return due < t
}

/**
 * The question "Ask Mira" on a card pre-fills in the Mira panel: the card as
 * context (title, list, board, description, due, checklist), then an open ask.
 * The person edits or sends it; nothing is sent from here.
 */
export function cardMiraPrompt(c: {
  title: string
  list?: string | null
  board?: string | null
  notes?: string | null
  due?: string | null
  checklist?: Array<{ text: string; done: boolean }>
}): string {
  const where = [c.list && `“${c.list.trim()}”`, c.board && (/\bboard$/i.test(c.board.trim()) ? `on the ${c.board.trim()}` : `on the ${c.board.trim()} board`)].filter(Boolean).join(' ')
  const lines = [`About the card “${c.title.trim()}”${where ? ` in ${where}` : ''}.`]
  const notes = (c.notes ?? '').replace(/\s+/g, ' ').trim()
  if (notes) lines.push(`Description: ${notes.length > 600 ? `${notes.slice(0, 600)}…` : notes}`)
  if (c.due) lines.push(`Due ${c.due}.`)
  const items = c.checklist ?? []
  if (items.length) {
    const open = items.filter((i) => !i.done).map((i) => i.text.trim()).filter(Boolean)
    lines.push(`Checklist: ${items.length - open.length} of ${items.length} done${open.length ? `; still open: ${open.slice(0, 8).join('; ')}` : ''}.`)
  }
  lines.push('What should happen next on this?')
  return lines.join('\n')
}
