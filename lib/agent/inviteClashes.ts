/**
 * Meeting invites still waiting on the person's answer, each already checked
 * against their own calendar (Ciao QA 2026-10-18: "What do I need to follow up
 * on" listed an invite and then offered to check the calendar; it should just
 * say whether it clashes). Pure: the caller reads the meetings
 * (lib/today.todaysMeetings, own calendars only, so titles are theirs).
 */
import type { TodayMeeting } from '@/lib/today'
import { fmtInTz } from '@/lib/cxoCalendar'
import { localToUtcMs } from '@/lib/cxoFreeTime'

export type InviteCheck = {
  event_id: string
  title: string
  when: string
  organizer: string | null
  /** The meeting it overlaps, by title and time; null when the time is free. */
  clashes_with: string | null
}

const timeOnly = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const span = (m: { start: string; end: string }) => ({ s: Date.parse(m.start), e: Date.parse(m.end) })

export function inviteClashes(meetings: TodayMeeting[], tz: string, now = Date.now(), limit = 5): InviteCheck[] {
  const timed = meetings.filter((m) => !m.allDay && Number.isFinite(Date.parse(m.start)) && Number.isFinite(Date.parse(m.end)))
  const invites = timed.filter((m) => m.awaitingReply && Date.parse(m.end) > now).slice(0, limit)
  return invites.map((inv) => {
    const a = span(inv)
    const hit = timed.find((o) => o.id !== inv.id && !o.notBusy && !o.awaitingReply && span(o).s < a.e && span(o).e > a.s)
    return {
      event_id: inv.id,
      title: inv.title,
      when: `${fmtInTz(inv.start, tz)} to ${timeOnly(inv.end, tz)}`,
      organizer: inv.organizer ?? null,
      clashes_with: hit ? `"${hit.title}" (${timeOnly(hit.start, tz)} to ${timeOnly(hit.end, tz)})` : null,
    }
  })
}

/** An email that is a calendar invitation ("Invitation: Q4 review @ Tue …"). */
export const INVITE_SUBJECT_RE = /^\s*(?:updated\s+)?invitation(?:\s+from\s+google\s+calendar)?\s*:/i

/** The invite check that belongs to an invitation email, matched on the meeting title in its subject. */
export function inviteForEmail(subject: string | null | undefined, checks: InviteCheck[]): InviteCheck | null {
  const s = (subject ?? '').toLowerCase()
  if (!INVITE_SUBJECT_RE.test(s)) return null
  return checks.find((c) => c.title && s.includes(c.title.toLowerCase())) ?? null
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const ZONES: Record<string, string> = {
  EDT: 'America/New_York', EST: 'America/New_York', CDT: 'America/Chicago', CST: 'America/Chicago',
  MDT: 'America/Denver', MST: 'America/Denver', PDT: 'America/Los_Angeles', PST: 'America/Los_Angeles',
  UTC: 'UTC', GMT: 'UTC',
}

function hm(t: string): [number, number] | null {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12
  return [h, Number(m[2] ?? 0)]
}

/**
 * The meeting in a Google Calendar invitation subject, e.g.
 * "Invitation: Q4 review @ Mon Oct 19, 2026 2pm - 3pm (EDT) (me@x.com)".
 * One-day timed invites only (a repeating or multi-day one returns null). Pure.
 */
export function inviteFromSubject(subject: string | null | undefined, fallbackTz: string): { title: string; startIso: string; endIso: string } | null {
  const s = (subject ?? '').trim()
  if (!INVITE_SUBJECT_RE.test(s)) return null
  const body = s.replace(INVITE_SUBJECT_RE, '').trim()
  const at = body.lastIndexOf(' @ ')
  if (at < 0) return null
  const title = body.slice(0, at).trim()
  const m = body.slice(at + 3).match(/^[A-Za-z]{3},?\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:\(([A-Z]{2,5})\))?/i)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  const a = hm(m[4])
  const b = hm(m[5])
  if (!month || !a || !b) return null
  const tz = (m[6] && ZONES[m[6].toUpperCase()]) || fallbackTz
  const y = Number(m[3])
  const d = Number(m[2])
  const start = localToUtcMs(y, month, d, a[0], a[1], tz)
  let end = localToUtcMs(y, month, d, b[0], b[1], tz)
  if (end <= start) end += 86_400_000
  return { title, startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() }
}

/** Check one parsed invite against busy blocks (its own block, same title, is not a clash). Pure. */
export function checkParsedInvite(
  inv: { title: string; startIso: string; endIso: string },
  busy: Array<{ startIso: string; endIso: string; title?: string }>,
  tz: string,
): Omit<InviteCheck, 'event_id' | 'organizer'> {
  const s = Date.parse(inv.startIso)
  const e = Date.parse(inv.endIso)
  const same = (t?: string) => !!t && t.trim().toLowerCase() === inv.title.trim().toLowerCase()
  const hit = busy.find((b) => !same(b.title) && Date.parse(b.startIso) < e && Date.parse(b.endIso) > s)
  return {
    title: inv.title,
    when: `${fmtInTz(inv.startIso, tz)} to ${timeOnly(inv.endIso, tz)}`,
    clashes_with: hit ? `${hit.title?.trim() ? `"${hit.title.trim()}"` : 'something marked busy'} (${timeOnly(hit.startIso, tz)} to ${timeOnly(hit.endIso, tz)})` : null,
  }
}
