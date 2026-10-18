/**
 * Which calendar events take up the person's time. Pure, no I/O.
 *
 * Google's freeBusy API only counts events marked "busy" (opaque). Events
 * Gmail adds on its own (flights, hotels, restaurant bookings: eventType
 * 'fromGmail') default to "free" (transparent), so freeBusy leaves them out
 * and a 7:30am to 1:27pm flight looked like an open afternoon (10-18 bug).
 * We read the events themselves too and count those as busy.
 *
 * Busy:
 *  - a timed event marked busy (opaque, the default), or any fromGmail event
 *    (a flight or a reservation is time you are not free, whatever its
 *    transparency says);
 *  - an out-of-office block (timed or all-day);
 *  - a focus-time block marked busy.
 * Not busy:
 *  - cancelled, or declined by the person;
 *  - a working-location or birthday entry;
 *  - an all-day event that is not out of office (holidays, "WFH", reminders);
 *  - a timed event the person marked "free" (transparent) that is not from Gmail.
 */
import { localToUtcMs } from '@/lib/cxoFreeTime'

export type RawCalEvent = {
  id?: string
  summary?: string
  status?: string
  eventType?: string
  transparency?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ self?: boolean; responseStatus?: string }>
}

/** A flattened event (the listUpcomingEvents shape): start/end are ISO date-times or YYYY-MM-DD dates. */
export type FlatCalEvent = {
  /** The event's title, when the calendar is the person's own (free/busy reads have none). */
  summary?: string
  status?: string
  eventType?: string
  transparency?: string
  start: string
  end: string
  attendees?: Array<{ self?: boolean; responseStatus?: string }>
}

const NEVER_BUSY_TYPES = new Set(['workingLocation', 'birthday'])

/** Does this event take up the person's time? */
export function isBusyEvent(e: FlatCalEvent): boolean {
  if (e.status === 'cancelled') return false
  if ((e.attendees ?? []).some((a) => a.self && a.responseStatus === 'declined')) return false
  const type = e.eventType || 'default'
  if (NEVER_BUSY_TYPES.has(type)) return false
  const allDay = e.start.length === 10
  if (type === 'outOfOffice') return true
  if (allDay) return false
  if (type === 'fromGmail') return true
  return e.transparency !== 'transparent'
}

export function flatten(e: RawCalEvent): FlatCalEvent {
  return {
    ...(e.summary ? { summary: e.summary } : {}),
    status: e.status,
    eventType: e.eventType,
    transparency: e.transparency,
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    attendees: e.attendees,
  }
}

/** Midnight of a YYYY-MM-DD date in tz, as UTC ms. */
export function dateStartMs(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return localToUtcMs(y, m, d, 0, 0, tz)
}

/** An event's span in UTC ms (all-day dates read in tz; Google's end date is exclusive). */
export function eventSpanMs(e: { start: string; end: string }, tz: string): { s: number; e: number } | null {
  if (!e.start || !e.end) return null
  const s = e.start.length === 10 ? dateStartMs(e.start, tz) : Date.parse(e.start)
  const en = e.end.length === 10 ? dateStartMs(e.end, tz) : Date.parse(e.end)
  if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) return null
  return { s, e: en }
}

/** Busy blocks from a calendar's events, inside [fromIso, toIso). */
export function busyFromEvents(
  events: FlatCalEvent[],
  tz: string,
  fromIso: string,
  toIso: string,
  calendar?: string,
): Array<{ startIso: string; endIso: string; calendar?: string; title?: string }> {
  const lo = Date.parse(fromIso)
  const hi = Date.parse(toIso)
  const out: Array<{ startIso: string; endIso: string; calendar?: string; title?: string }> = []
  for (const ev of events) {
    if (!isBusyEvent(ev)) continue
    const span = eventSpanMs(ev, tz)
    if (!span || span.e <= lo || span.s >= hi) continue
    out.push({ startIso: new Date(Math.max(span.s, lo)).toISOString(), endIso: new Date(Math.min(span.e, hi)).toISOString(), ...(calendar ? { calendar } : {}), ...(ev.summary?.trim() ? { title: ev.summary.trim().slice(0, 120) } : {}) })
  }
  return out
}

/**
 * Union of busy blocks (from freeBusy and from events), sorted, with exact
 * duplicates dropped. A freeBusy block has no title; when an event block for
 * the same span has one, the kept block takes it, so a clash can name the
 * meeting rather than the calendar (Ciao QA 2026-10-18).
 */
export function unionBusy<T extends { startIso: string; endIso: string; title?: string }>(...lists: T[][]): T[] {
  const seen = new Map<string, number>()
  const out: T[] = []
  for (const b of lists.flat()) {
    const k = `${Date.parse(b.startIso)}|${Date.parse(b.endIso)}`
    const at = seen.get(k)
    if (at !== undefined) {
      if (!out[at].title && b.title) out[at] = { ...out[at], title: b.title }
      continue
    }
    seen.set(k, out.length)
    out.push(b)
  }
  return out.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso) || Date.parse(a.endIso) - Date.parse(b.endIso))
}

/** Every overlapping pair among busy timed events, in order. Indexes into the input. */
export function overlappingPairs(spans: Array<{ s: number; e: number }>): Array<[number, number]> {
  const idx = spans.map((_, i) => i).sort((a, b) => spans[a].s - spans[b].s || spans[a].e - spans[b].e)
  const out: Array<[number, number]> = []
  for (let x = 0; x < idx.length; x++) {
    for (let y = x + 1; y < idx.length; y++) {
      const a = spans[idx[x]]
      const b = spans[idx[y]]
      if (b.s >= a.e) break
      out.push([idx[x], idx[y]])
    }
  }
  return out
}
