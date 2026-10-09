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
