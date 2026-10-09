/**
 * Which meeting note belongs to a calendar event. One rule for the Calendar
 * popup ("Open notes") and the Meetings page's recording chips:
 *   1. the note was filed against this calendar event (calendar_event_id), or
 *   2. it landed inside the event's window (15 min grace either side), or
 *   3. it carries the same title on the same day.
 * All-day events never match on time (a note is not "the holiday").
 *
 * When 2+ notes land in the window we never pick one blindly: the note whose
 * title shares the most words with the event wins, then the one sharing the
 * most attendees. If they are still level, the caller gets every tied note
 * and shows "Open notes (N)" instead of a single, possibly wrong, note.
 */
export type MatchableNote = {
  id: string
  title: string | null
  occurred_at: string
  calendar_event_id?: string | null
  attendees?: unknown
}

export type MatchEvent = {
  eventId?: string | null
  startIso: string
  endIso: string
  title: string
  allDay?: boolean
  /** Emails and/or display names of the event's guests, when known. */
  attendees?: string[]
}

export type NoteMatch<N> =
  | { kind: 'one'; note: N; by: 'id' | 'only' | 'title' | 'attendees' | 'title-day' }
  | { kind: 'many'; notes: N[] }

const GRACE_MS = 15 * 60_000
const DAY_MS = 86_400_000

// Words that say nothing about WHICH meeting it was.
const STOP = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'with', 'on', 'in', 'at', 'by', 'from', 'about', 're', 'vs',
  'meeting', 'meetings', 'call', 'calls', 'consultation', 'consult', 'sync', 'chat', 'session', 'notes',
  'review', 'discussion', 'zoom', 'teams', 'google', 'meet', 'invite', 'invitation', 'updated',
])

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Meaningful words in a title (no stop words, no bare numbers like a "07-09" date prefix). */
export function titleWords(s: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const w of norm(s ?? '').split(' ')) {
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)
  }
  return out
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n
}

/** Attendee identifiers on a note (array of strings or {email,name} objects). */
function noteAttendees(v: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(v)) return out
  for (const a of v) {
    if (typeof a === 'string') out.add(a.trim().toLowerCase())
    else if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>
      for (const k of ['email', 'name', 'displayName']) if (typeof o[k] === 'string') out.add((o[k] as string).trim().toLowerCase())
    }
  }
  out.delete('')
  return out
}

export function matchNotesForEvent<N extends MatchableNote>(ev: MatchEvent, notes: N[]): NoteMatch<N> | null {
  if (ev.eventId) {
    const byId = notes.find((n) => n.calendar_event_id && n.calendar_event_id === ev.eventId)
    if (byId) return { kind: 'one', note: byId, by: 'id' }
  }
  if (ev.allDay) return null
  const s = Date.parse(ev.startIso)
  const e = Date.parse(ev.endIso || ev.startIso)
  if (!Number.isFinite(s)) return null
  const end = Number.isFinite(e) ? Math.max(e, s) : s

  // A note already filed against a different event is not this one.
  const free = notes.filter((n) => !n.calendar_event_id || !ev.eventId || n.calendar_event_id === ev.eventId)
  const inWindow = free.filter((n) => {
    const t = Date.parse(n.occurred_at)
    return Number.isFinite(t) && t >= s - GRACE_MS && t <= end + GRACE_MS
  })
  if (inWindow.length === 1) return { kind: 'one', note: inWindow[0], by: 'only' }
  if (inWindow.length > 1) {
    const evWords = titleWords(ev.title)
    const evPeople = new Set((ev.attendees ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))
    const scored = inWindow.map((n) => ({
      n,
      title: overlap(evWords, titleWords(n.title)),
      people: evPeople.size ? overlap(evPeople, noteAttendees(n.attendees)) : 0,
    }))
    const bestTitle = Math.max(...scored.map((x) => x.title))
    const byTitle = scored.filter((x) => x.title === bestTitle)
    if (bestTitle > 0 && byTitle.length === 1) return { kind: 'one', note: byTitle[0].n, by: 'title' }
    const bestPeople = Math.max(...byTitle.map((x) => x.people))
    const byPeople = byTitle.filter((x) => x.people === bestPeople)
    if (bestPeople > 0 && byPeople.length === 1) return { kind: 'one', note: byPeople[0].n, by: 'attendees' }
    return { kind: 'many', notes: byPeople.map((x) => x.n) }
  }

  const title = norm(ev.title)
  if (!title) return null
  for (const n of free) {
    const t = Date.parse(n.occurred_at)
    if (!Number.isFinite(t) || Math.abs(t - s) > DAY_MS) continue
    const nt = n.title ? norm(n.title) : ''
    if (nt && (nt === title || (title.length >= 8 && nt.includes(title)) || (nt.length >= 8 && title.includes(nt)))) {
      return { kind: 'one', note: n, by: 'title-day' }
    }
  }
  return null
}

/** Single best note, or null. Used where only "was it recorded?" matters. */
export function noteForEvent<N extends MatchableNote>(ev: MatchEvent, notes: N[]): N | null {
  const m = matchNotesForEvent(ev, notes)
  if (!m) return null
  return m.kind === 'one' ? m.note : m.notes[0]
}

/**
 * A match good enough to file the note against this calendar event for
 * good: the only note in the window, or one picked out by title/attendees.
 * Never a same-day title guess, never a tie.
 */
export function isConfidentMatch<N>(m: NoteMatch<N> | null): m is { kind: 'one'; note: N; by: 'only' | 'title' | 'attendees' } {
  return !!m && m.kind === 'one' && (m.by === 'only' || m.by === 'title' || m.by === 'attendees')
}

/** Where "Open notes" goes: the Meetings page with that note expanded. */
export function noteHref(id: string): string {
  return `/dashboard/meetings?note=${encodeURIComponent(id)}#note-${encodeURIComponent(id)}`
}

/** Where "Open notes (N)" goes: Meetings showing just those notes from that day. */
export function notesListHref(day: string, ids: string[]): string {
  return `/dashboard/meetings?day=${encodeURIComponent(day)}&notes=${ids.map(encodeURIComponent).join(',')}#mtg-past`
}

/** The link + label for an event's notes, or null when it has none. */
export function notesLinkFor<N extends MatchableNote>(m: NoteMatch<N> | null, day: string): { href: string; count: number } | null {
  if (!m) return null
  if (m.kind === 'one') return { href: noteHref(m.note.id), count: 1 }
  return { href: notesListHref(day, m.notes.map((n) => n.id)), count: m.notes.length }
}
