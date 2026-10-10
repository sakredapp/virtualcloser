/**
 * "Send to each owner's Today" on the Meetings page: every action item Mira
 * read out of a meeting (owner + due date, plaud_notes.mira_digest.items)
 * becomes a real to-do on that owner's Today list (cxo_todos, the same table
 * Today reads), when the owner's name matches exactly one active team member.
 * Anyone it cannot match is returned by name so the page can say so; nothing
 * is guessed. Sending twice never duplicates: each to-do has a stable
 * source_key and the table's (rep_id, member_id, source_key) unique index
 * turns a repeat into "already sent".
 */
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import type { MeetingDigest, MeetingItem } from '@/lib/meetingLoop'

export type TeamMember = { id: string; display_name: string | null; email: string | null }

export type OwnerMatch =
  | { kind: 'member'; member: TeamMember }
  | { kind: 'none'; reason: 'no-owner' | 'not-on-team' | 'ambiguous' }

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The one team member a spoken owner name means, or why there is none.
 * Full name first, then a unique first name, then the email's local part.
 */
export function matchOwner(owner: string | null | undefined, members: TeamMember[]): OwnerMatch {
  const o = norm(owner)
  if (!o) return { kind: 'none', reason: 'no-owner' }
  const full = members.filter((m) => norm(m.display_name) === o)
  if (full.length === 1) return { kind: 'member', member: full[0] }
  if (full.length > 1) return { kind: 'none', reason: 'ambiguous' }
  const first = o.split(' ')[0]
  const oneWord = !o.includes(' ')
  // "Mike" matches "Mike Spencer"; "Mike S" matches "Mike Spencer" too.
  const byFirst = members.filter((m) => {
    const parts = norm(m.display_name).split(' ')
    if (parts[0] !== first) return false
    if (oneWord) return true
    const rest = o.split(' ').slice(1).join(' ')
    return parts.slice(1).join(' ').startsWith(rest)
  })
  if (byFirst.length === 1) return { kind: 'member', member: byFirst[0] }
  if (byFirst.length > 1) return { kind: 'none', reason: 'ambiguous' }
  const compact = o.replace(/ /g, '')
  const byEmail = members.filter((m) => {
    const local = norm((m.email ?? '').split('@')[0]).replace(/ /g, '')
    return !!local && (local === compact || local === first)
  })
  if (byEmail.length === 1) return { kind: 'member', member: byEmail[0] }
  if (byEmail.length > 1) return { kind: 'none', reason: 'ambiguous' }
  return { kind: 'none', reason: 'not-on-team' }
}

/** Stable per meeting + item text, so a second send is a no-op. */
export function ownerSourceKey(noteId: string, text: string): string {
  return `note:${noteId}:owner:${createHash('sha1').update(norm(text)).digest('hex').slice(0, 12)}`
}

/** The meeting's items: Mira's (owner + due) when read, else the note-taker's own list (no owner). */
export function noteItems(digest: MeetingDigest | null | undefined, actionItems: unknown): MeetingItem[] {
  if (digest?.items?.length) return digest.items
  if (!Array.isArray(actionItems)) return []
  return actionItems
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : ''))
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
    .slice(0, 15)
    .map((text) => ({ text, owner: null, due: null }))
}

export type SendResult = {
  sent: number
  already: number
  people: Array<{ name: string; count: number }>
  unmatched: Array<{ owner: string | null; text: string; reason: 'no-owner' | 'not-on-team' | 'ambiguous' }>
}

export async function activeTeam(repId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, display_name, email')
    .eq('rep_id', repId)
    .eq('is_active', true)
    .neq('role', 'assistant')
  if (error) throw error
  return (data ?? []) as TeamMember[]
}

export async function sendNoteToOwners(
  repId: string,
  sender: { id: string; display_name: string | null },
  noteId: string,
): Promise<SendResult | null> {
  const { data: note, error } = await supabase
    .from('plaud_notes')
    .select('id, title, occurred_at, action_items, mira_digest')
    .eq('id', noteId)
    .eq('rep_id', repId)
    .or(`owner_member_id.is.null,owner_member_id.eq.${sender.id}`)
    .maybeSingle()
  if (error) throw error
  if (!note) return null
  const n = note as { id: string; title: string | null; occurred_at: string; action_items: unknown; mira_digest: MeetingDigest | null }
  const items = noteItems(n.mira_digest, n.action_items)
  const team = await activeTeam(repId)
  const out: SendResult = { sent: 0, already: 0, people: [], unmatched: [] }
  const perPerson = new Map<string, { name: string; count: number }>()
  for (const it of items) {
    const m = matchOwner(it.owner, team)
    if (m.kind === 'none') {
      out.unmatched.push({ owner: it.owner, text: it.text, reason: m.reason })
      continue
    }
    const row = {
      rep_id: repId,
      member_id: m.member.id,
      body: it.text.slice(0, 500),
      source: 'meeting',
      note_id: n.id,
      meeting_title: (n.title || 'Meeting').slice(0, 200),
      meeting_at: n.occurred_at,
      source_key: ownerSourceKey(n.id, it.text),
      due_date: it.due,
      assignee_name: it.owner,
      acted_by_member_id: sender.id,
      acted_by_name: sender.display_name,
    }
    const { error: insErr } = await supabase.from('cxo_todos').insert(row)
    if (insErr) {
      if (insErr.code === '23505') {
        out.already++
        continue
      }
      throw insErr
    }
    out.sent++
    const name = m.member.display_name || m.member.email || 'Team member'
    const p = perPerson.get(m.member.id) ?? { name, count: 0 }
    p.count++
    perPerson.set(m.member.id, p)
  }
  out.people = [...perPerson.values()]
  return out
}
