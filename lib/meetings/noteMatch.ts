/**
 * Which meeting note belongs to a calendar event. One rule for the Calendar
 * popup ("Open notes") and the Meetings page's recording chips:
 *   1. the note was filed against this calendar event (calendar_event_id), or
 *   2. it landed inside the event's window (15 min grace either side), or
 *   3. it carries the same title on the same day.
 * All-day events never match on time (a note is not "the holiday").
 */
export type MatchableNote = {
  id: string
  title: string | null
  occurred_at: string
  calendar_event_id?: string | null
}

const GRACE_MS = 15 * 60_000
const DAY_MS = 86_400_000

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function noteForEvent<N extends MatchableNote>(
  ev: { eventId?: string | null; startIso: string; endIso: string; title: string; allDay?: boolean },
  notes: N[],
): N | null {
  if (ev.eventId) {
    const byId = notes.find((n) => n.calendar_event_id && n.calendar_event_id === ev.eventId)
    if (byId) return byId
  }
  if (ev.allDay) return null
  const s = Date.parse(ev.startIso)
  const e = Date.parse(ev.endIso || ev.startIso)
  if (!Number.isFinite(s)) return null
  const end = Number.isFinite(e) ? Math.max(e, s) : s
  for (const n of notes) {
    const t = Date.parse(n.occurred_at)
    if (Number.isFinite(t) && t >= s - GRACE_MS && t <= end + GRACE_MS) return n
  }
  const title = norm(ev.title)
  if (!title) return null
  for (const n of notes) {
    const t = Date.parse(n.occurred_at)
    if (!Number.isFinite(t) || Math.abs(t - s) > DAY_MS) continue
    const nt = n.title ? norm(n.title) : ''
    if (nt && (nt === title || (title.length >= 8 && nt.includes(title)) || (nt.length >= 8 && title.includes(nt)))) return n
  }
  return null
}

/** Where "Open notes" goes: the Meetings page with that note expanded. */
export function noteHref(id: string): string {
  return `/dashboard/meetings?note=${encodeURIComponent(id)}#note-${encodeURIComponent(id)}`
}
