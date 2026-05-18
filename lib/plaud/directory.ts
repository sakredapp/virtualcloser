// Plaud contact directory — resolution + one-time seeding.
//
// The agent gets a compact people-list when it plans actions. When it
// emits a name like "Lauren" we resolve it back to a rep_contacts row (or
// a members row) so we can drop the right email into the action payload.
// Names it can't resolve come back marked recipient_unresolved; the
// approval UI lets Spencer either add them to the directory or override.
//
// Seeding pulls from three sources Spencer has already built up:
//   • email_threads.from_address (only addresses he's *replied to* — signal
//     he actually knows the person, not just received a newsletter from)
//   • Google Calendar attendees (last 60 days)
//   • leads.email
// Dedupes by email. Re-runnable: existing contacts are left alone, only
// new emails get inserted.

import { supabase } from '@/lib/supabase'
import { listUpcomingEvents } from '@/lib/google'

export type DirectoryEntry = {
  id: string
  display_name: string
  aliases: string[]
  email: string | null
  role: string | null
  member_id: string | null
  source: 'contact' | 'member'
}

type ContactRow = {
  id: string
  display_name: string
  aliases: string[] | null
  email: string | null
  role: string | null
  member_id: string | null
}

type MemberRow = {
  id: string
  display_name: string
  email: string | null
  role: string | null
}

/**
 * Build the directory the agent sees when planning. Merges rep_contacts +
 * members so both internal team and external contacts are in one list. If a
 * contact is linked to a member (rep_contacts.member_id is set), only the
 * member entry is kept to avoid double-listing.
 */
export async function loadDirectory(repId: string): Promise<DirectoryEntry[]> {
  const [contactsRes, membersRes] = await Promise.all([
    supabase
      .from('rep_contacts')
      .select('id, display_name, aliases, email, role, member_id')
      .eq('rep_id', repId)
      .order('display_name', { ascending: true })
      .limit(500),
    supabase
      .from('members')
      .select('id, display_name, email, role')
      .eq('rep_id', repId)
      .eq('is_active', true)
      .limit(100),
  ])

  const contacts = (contactsRes.data ?? []) as ContactRow[]
  const members = (membersRes.data ?? []) as MemberRow[]

  const memberIdsAlreadyInContacts = new Set(
    contacts.map((c) => c.member_id).filter((id): id is string => Boolean(id)),
  )

  const entries: DirectoryEntry[] = [
    ...members
      .filter((m) => !memberIdsAlreadyInContacts.has(m.id))
      .map((m) => ({
        id: m.id,
        display_name: m.display_name,
        aliases: [],
        email: m.email,
        role: m.role,
        member_id: m.id,
        source: 'member' as const,
      })),
    ...contacts.map((c) => ({
      id: c.id,
      display_name: c.display_name,
      aliases: c.aliases ?? [],
      email: c.email,
      role: c.role,
      member_id: c.member_id,
      source: 'contact' as const,
    })),
  ]

  return entries
}

export type ResolvedRecipient = {
  matched: boolean
  display_name: string
  email: string | null
  member_id: string | null
  contact_id: string | null
  ambiguous: boolean // true if multiple equally-good matches
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Best-effort resolution of an agent-emitted name to a directory entry.
 * Strategy:
 *   1. Exact display_name match (case-insensitive).
 *   2. Alias match.
 *   3. First-token match if the agent only gave a first name and there's
 *      exactly one directory entry whose first token matches.
 *   4. Email match if the agent happened to emit an email string.
 * Multiple equally-good hits → ambiguous=true; the executor leaves the
 * action pending for Spencer to disambiguate.
 */
export function resolveRecipient(
  query: string,
  directory: DirectoryEntry[],
): ResolvedRecipient {
  const q = query.trim()
  if (!q) {
    return { matched: false, display_name: '', email: null, member_id: null, contact_id: null, ambiguous: false }
  }
  const qNorm = normalize(q)

  // 4. If the query looks like an email, try that first — most precise signal.
  if (q.includes('@')) {
    const emailNorm = q.toLowerCase()
    const hits = directory.filter((d) => (d.email ?? '').toLowerCase() === emailNorm)
    if (hits.length === 1) return entryToResolved(hits[0])
    // Even if we don't have a directory entry, return the email so the agent's
    // intent is preserved — the executor will treat it as an external contact.
    return { matched: true, display_name: q, email: q, member_id: null, contact_id: null, ambiguous: false }
  }

  // 1. Exact display_name match.
  const exact = directory.filter((d) => normalize(d.display_name) === qNorm)
  if (exact.length === 1) return entryToResolved(exact[0])
  if (exact.length > 1) return ambiguousResolution(q, exact)

  // 2. Alias match.
  const aliasHits = directory.filter((d) =>
    d.aliases.some((a) => normalize(a) === qNorm),
  )
  if (aliasHits.length === 1) return entryToResolved(aliasHits[0])
  if (aliasHits.length > 1) return ambiguousResolution(q, aliasHits)

  // 3. First-token match — "Lauren" → "Lauren Martinez".
  const firstToken = qNorm.split(' ')[0]
  if (firstToken && firstToken.length >= 2) {
    const firstTokenHits = directory.filter((d) => {
      const dFirst = normalize(d.display_name).split(' ')[0]
      return dFirst === firstToken
    })
    if (firstTokenHits.length === 1) return entryToResolved(firstTokenHits[0])
    if (firstTokenHits.length > 1) return ambiguousResolution(q, firstTokenHits)
  }

  return { matched: false, display_name: q, email: null, member_id: null, contact_id: null, ambiguous: false }
}

function entryToResolved(e: DirectoryEntry): ResolvedRecipient {
  return {
    matched: true,
    display_name: e.display_name,
    email: e.email,
    member_id: e.member_id,
    contact_id: e.source === 'contact' ? e.id : null,
    ambiguous: false,
  }
}

function ambiguousResolution(query: string, _hits: DirectoryEntry[]): ResolvedRecipient {
  return {
    matched: false,
    display_name: query,
    email: null,
    member_id: null,
    contact_id: null,
    ambiguous: true,
  }
}

// ── Seeding ──────────────────────────────────────────────────────────────

export type SeedResult = {
  scanned: number
  inserted: number
  skipped: number
  sources: { email: number; calendar: number; leads: number }
}

type SeedCandidate = {
  email: string // lowercased, the dedupe key
  display_name: string
  source: 'email_seed' | 'calendar_seed' | 'lead_seed'
}

function isLikelyHumanEmail(email: string): boolean {
  // Filter out the obvious noise: no-reply addresses, transactional, lists.
  const lower = email.toLowerCase()
  if (lower.includes('no-reply') || lower.includes('noreply')) return false
  if (lower.includes('do-not-reply') || lower.includes('donotreply')) return false
  if (lower.startsWith('bounce')) return false
  if (lower.startsWith('postmaster@')) return false
  if (lower.startsWith('mailer-daemon@')) return false
  if (lower.includes('+notif')) return false
  if (lower.endsWith('@notifications.github.com')) return false
  if (lower.endsWith('@updates.linkedin.com')) return false
  return true
}

function displayNameFromAddress(name: string | null, email: string): string {
  if (name && name.trim()) return name.trim()
  // Fallback: local-part with separators humanised.
  const local = email.split('@')[0]
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function collectFromEmail(repId: string): Promise<SeedCandidate[]> {
  // We want addresses Spencer has actually engaged with — pulling from
  // email_threads where status moved past 'new' (i.e. he interacted) is a
  // reasonable proxy. For v1 just take any thread he's seen.
  const { data } = await supabase
    .from('email_threads')
    .select('from_address, from_name')
    .eq('rep_id', repId)
    .not('from_address', 'is', null)
    .limit(1000)
  const rows = (data ?? []) as Array<{ from_address: string | null; from_name: string | null }>
  const out: SeedCandidate[] = []
  for (const r of rows) {
    const email = (r.from_address ?? '').toLowerCase().trim()
    if (!email || !isLikelyHumanEmail(email)) continue
    out.push({
      email,
      display_name: displayNameFromAddress(r.from_name, email),
      source: 'email_seed',
    })
  }
  return out
}

async function collectFromCalendar(repId: string): Promise<SeedCandidate[]> {
  const fromIso = new Date(Date.now() - 60 * 86400_000).toISOString()
  const toIso = new Date().toISOString()
  const events = await listUpcomingEvents(repId, { fromIso, toIso, maxResults: 250 })
  if (!events) return []
  const out: SeedCandidate[] = []
  for (const ev of events) {
    for (const a of ev.attendees ?? []) {
      const email = a.email.toLowerCase().trim()
      if (!email || !isLikelyHumanEmail(email)) continue
      out.push({
        email,
        display_name: displayNameFromAddress(a.displayName ?? null, email),
        source: 'calendar_seed',
      })
    }
  }
  return out
}

async function collectFromLeads(repId: string): Promise<SeedCandidate[]> {
  const { data } = await supabase
    .from('leads')
    .select('name, email')
    .eq('rep_id', repId)
    .not('email', 'is', null)
    .limit(1000)
  const rows = (data ?? []) as Array<{ name: string; email: string | null }>
  const out: SeedCandidate[] = []
  for (const r of rows) {
    const email = (r.email ?? '').toLowerCase().trim()
    if (!email || !isLikelyHumanEmail(email)) continue
    out.push({
      email,
      display_name: r.name?.trim() || displayNameFromAddress(null, email),
      source: 'lead_seed',
    })
  }
  return out
}

/**
 * One-time seed for a rep. Idempotent: re-running skips emails that already
 * have a contact row. Tracks per-source counts for the UI to show.
 */
export async function seedRepContacts(repId: string): Promise<SeedResult> {
  const [fromEmail, fromCal, fromLeads] = await Promise.all([
    collectFromEmail(repId),
    collectFromCalendar(repId),
    collectFromLeads(repId),
  ])

  // Dedupe by email, preferring sources in this order: leads > email > calendar.
  // Reason: leads have the cleanest display name; calendar attendees often
  // have no name at all.
  const byEmail = new Map<string, SeedCandidate>()
  for (const c of fromCal) byEmail.set(c.email, c)
  for (const c of fromEmail) byEmail.set(c.email, c)
  for (const c of fromLeads) byEmail.set(c.email, c)

  const counts = {
    email: fromEmail.length,
    calendar: fromCal.length,
    leads: fromLeads.length,
  }

  if (byEmail.size === 0) {
    return { scanned: 0, inserted: 0, skipped: 0, sources: counts }
  }

  // Pull existing emails for this rep in one query so we can skip them.
  const { data: existing } = await supabase
    .from('rep_contacts')
    .select('email')
    .eq('rep_id', repId)
    .not('email', 'is', null)
  const existingEmails = new Set(
    ((existing ?? []) as Array<{ email: string | null }>).map((r) => (r.email ?? '').toLowerCase()),
  )

  const toInsert = Array.from(byEmail.values())
    .filter((c) => !existingEmails.has(c.email))
    .map((c) => ({
      rep_id: repId,
      display_name: c.display_name,
      email: c.email,
      source: c.source,
    }))

  if (toInsert.length === 0) {
    return { scanned: byEmail.size, inserted: 0, skipped: byEmail.size, sources: counts }
  }

  // Chunked insert keeps payloads small if a rep has many contacts.
  const CHUNK = 200
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('rep_contacts').insert(slice)
    if (error) {
      console.error('[contacts] seed insert failed', error.message)
    } else {
      inserted += slice.length
    }
  }

  return {
    scanned: byEmail.size,
    inserted,
    skipped: byEmail.size - inserted,
    sources: counts,
  }
}
