/**
 * Personal Mira memory for employee logins (owner 10-10).
 *
 * An employee's "remember this" is theirs alone: stored per member in
 * agent_member_memory and read back only for that member. Employees never
 * read or write plaud_agent_guidance (the exec-level org memory). Every query
 * filters by rep_id AND member_id, so one employee's rules can't reach a
 * coworker or another company. If the table is missing the reads come back
 * empty and the writes fail (closed), never falling back to org memory.
 */
import { supabase } from '@/lib/supabase'

export type MemberMemoryKind = 'avoid' | 'prefer' | 'correction' | 'fact'
export type MemberMemoryRow = { id: string; rule: string; kind: MemberMemoryKind; subject: string | null }

const KINDS: MemberMemoryKind[] = ['avoid', 'prefer', 'correction', 'fact']
const TABLE = 'agent_member_memory'

export function asMemoryKind(v: unknown): MemberMemoryKind {
  return KINDS.includes(v as MemberMemoryKind) ? (v as MemberMemoryKind) : 'prefer'
}

/** The member's active rules, newest first. */
export async function listMemberMemory(repId: string, memberId: string, limit = 40): Promise<MemberMemoryRow[]> {
  if (!repId || !memberId) return []
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, rule, kind, subject')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[memberMemory] list', error.message)
    return []
  }
  return (data ?? []) as MemberMemoryRow[]
}

export async function addMemberMemory(
  repId: string,
  memberId: string,
  rule: string,
  kind: MemberMemoryKind = 'prefer',
  subject: string | null = null,
): Promise<MemberMemoryRow | null> {
  const text = rule.trim().slice(0, 500)
  if (!repId || !memberId || !text) return null
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ rep_id: repId, member_id: memberId, rule: text, kind: asMemoryKind(kind), subject: subject?.trim().slice(0, 120) || null })
    .select('id, rule, kind, subject')
    .single()
  if (error) {
    console.error('[memberMemory] add', error.message)
    return null
  }
  return data as MemberMemoryRow
}

/** Switch off up to 5 of the member's rules matching `query`. Returns what was dropped. */
export async function forgetMemberMemory(repId: string, memberId: string, query: string): Promise<string[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const active = await listMemberMemory(repId, memberId, 200)
  const words = q.split(/\s+/).filter((w) => w.length > 2)
  let hits = active.filter((r) => {
    const rl = r.rule.toLowerCase()
    return rl.includes(q) || q.includes(rl)
  })
  if (hits.length === 0 && words.length > 0) hits = active.filter((r) => words.every((w) => r.rule.toLowerCase().includes(w)))
  hits = hits.slice(0, 5)
  if (!hits.length) return []
  const { error } = await supabase
    .from(TABLE)
    .update({ active: false })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .in('id', hits.map((h) => h.id))
  if (error) {
    console.error('[memberMemory] forget', error.message)
    return []
  }
  return hits.map((h) => h.rule)
}

/** The prompt block for an employee's own rules (empty when none). */
export function renderMemberMemory(rows: MemberMemoryRow[]): string {
  const lines = rows
    .map((r) => (r.subject ? `(about ${r.subject}) ${r.rule}` : r.rule).trim())
    .filter(Boolean)
  if (!lines.length) return ''
  return ['', 'THEIR OWN STANDING RULES (from what they asked you to remember; follow them):', ...lines.map((l) => `  - ${l}`)].join('\n')
}
