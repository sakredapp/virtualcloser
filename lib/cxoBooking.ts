/**
 * Suite CXO intro calls, booked on the owner's real calendar.
 *
 * The calendar engine is the Virtual Closer booking API (crmbuilds
 * api/booking/[slug]/slots + book). Its `suite-cxo` campaign (VC DB
 * booking_campaigns 38f53926…, host: the owner, 30 minutes) checks the
 * owner's Google calendar for busy times, writes the meeting and sends the
 * calendar invite. The prospect never sees a Virtual Closer page: the Suite
 * CXO request-access page shows the times and books through this file, and
 * every email the prospect gets is a Suite CXO email from suitecxo.com.
 *
 * No phone is posted, so the booking API sends no text. Times offered are
 * Monday to Friday, 9:00 to 17:00 Eastern (the API's own window is wider).
 */

export const CXO_BOOKING_SLUG = 'suite-cxo'
export const CXO_BOOKING_TZ = 'America/New_York'
const BOOKING_API = process.env.CXO_BOOKING_API_ORIGIN || 'https://app.virtualcloser.com'

export type CxoSlot = {
  /** Exactly as the booking API returned it; posted back unchanged. */
  start: string
  end: string
  offer_ref: string | null
  /** e.g. "2026-10-26", Eastern. */
  dayKey: string
  /** e.g. "Mon, Oct 26". */
  dayLabel: string
  /** e.g. "10:30 AM". */
  timeLabel: string
}

function easternParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CXO_BOOKING_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    weekday: get('weekday'),
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/** A start like 14:30:19 shows as 2:30 PM: the API's times carry stray seconds. */
function roundToMinute(d: Date): Date {
  return new Date(Math.round(d.getTime() / 60_000) * 60_000)
}

/** Long Eastern label for emails and the booked screen, e.g. "Monday, October 26 at 10:30 AM ET". */
export function easternLabel(iso: string): string {
  const d = roundToMinute(new Date(iso))
  const day = new Intl.DateTimeFormat('en-US', { timeZone: CXO_BOOKING_TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: CXO_BOOKING_TZ, hour: 'numeric', minute: '2-digit' }).format(d)
  return `${day} at ${time} ET`
}

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

/** Keep weekday times that start at or after 9:00 and end by 17:00 Eastern. Pure; tested. */
export function filterBusinessHours(raw: Array<{ start?: unknown; end?: unknown; offer_ref?: unknown }>, maxDays = 5): CxoSlot[] {
  const out: CxoSlot[] = []
  const days: string[] = []
  const seen = new Set<string>()
  for (const s of raw) {
    if (typeof s?.start !== 'string') continue
    const start = new Date(s.start)
    if (Number.isNaN(start.getTime())) continue
    const end = typeof s.end === 'string' && !Number.isNaN(new Date(s.end).getTime()) ? new Date(s.end) : new Date(start.getTime() + 30 * 60_000)
    const a = easternParts(roundToMinute(start))
    const b = easternParts(roundToMinute(end))
    if (!WEEKDAYS.has(a.weekday)) continue
    if (a.minutes < 9 * 60 || b.dayKey !== a.dayKey || b.minutes > 17 * 60) continue
    const key = `${a.dayKey}:${a.minutes}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!days.includes(a.dayKey)) {
      if (days.length >= maxDays) continue
      days.push(a.dayKey)
    }
    const r = roundToMinute(start)
    out.push({
      start: s.start,
      end: typeof s.end === 'string' ? s.end : end.toISOString(),
      offer_ref: typeof s.offer_ref === 'string' ? s.offer_ref : null,
      dayKey: a.dayKey,
      dayLabel: new Intl.DateTimeFormat('en-US', { timeZone: CXO_BOOKING_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(r),
      timeLabel: new Intl.DateTimeFormat('en-US', { timeZone: CXO_BOOKING_TZ, hour: 'numeric', minute: '2-digit' }).format(r),
    })
  }
  return out
}

/** Open times on the owner's calendar, or null when the calendar could not be read. */
export async function fetchCxoSlots(): Promise<CxoSlot[] | null> {
  try {
    const res = await fetch(`${BOOKING_API}/api/booking/${CXO_BOOKING_SLUG}/slots`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('[cxo booking] slots answered', res.status)
      return null
    }
    const body = (await res.json()) as { slots?: unknown }
    return filterBusinessHours(Array.isArray(body.slots) ? (body.slots as never[]) : [])
  } catch (err) {
    console.error('[cxo booking] slots failed', err instanceof Error ? err.message : String(err))
    return null
  }
}

export type BookResult =
  | { ok: true; start: string; end: string | null; eventCreated: boolean; prospectId: string | null }
  | { ok: false; taken: boolean; error: string }

/** Book one time for a named person. No phone is sent, so no text goes out. */
export async function bookCxoSlot(input: { start: string; offerRef: string | null; name: string; email: string }): Promise<BookResult> {
  try {
    const res = await fetch(`${BOOKING_API}/api/booking/${CXO_BOOKING_SLUG}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // invite_lead: false keeps the event on the host's calendar only; the
      // prospect's calendar entry is the Suite CXO .ics we email (cxoCallIcs).
      body: JSON.stringify({ start: input.start, name: input.name, email: input.email, invite_lead: false, ...(input.offerRef ? { offer_ref: input.offerRef } : {}) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok && body.ok !== false) {
      return {
        ok: true,
        start: typeof body.start === 'string' ? body.start : input.start,
        end: typeof body.end === 'string' ? body.end : null,
        eventCreated: body.event_created === true,
        prospectId: typeof body.prospect_id === 'string' ? body.prospect_id : null,
      }
    }
    return { ok: false, taken: res.status === 409, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, taken: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
function icsText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/**
 * The prospect's calendar entry for a booked intro call: a Suite CXO .ics
 * attached to the confirmation email from suitecxo.com. The VC booking API is
 * told not to invite the prospect (invite_lead: false), so this is the only
 * calendar entry they get and it carries only Suite CXO wording. Pure.
 */
export function cxoCallIcs(input: { start: string; end?: string | null; uid: string; now?: Date }): string {
  const start = new Date(input.start)
  const endMs = input.end ? new Date(input.end).getTime() : NaN
  const end = Number.isFinite(endMs) && endMs > start.getTime() ? new Date(endMs) : new Date(start.getTime() + 30 * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Suite CXO//Intro call//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.uid}@suitecxo.com`,
    `DTSTAMP:${icsStamp(input.now ?? new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText('Suite CXO intro call')}`,
    `DESCRIPTION:${icsText('Your 30 minute Suite CXO intro call. Need a different time? Reply to your confirmation email or write to support@suitecxo.com.')}`,
    'ORGANIZER;CN=Suite CXO:mailto:support@suitecxo.com',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
