/**
 * Flag Calendar Conflicts and Overbooked Days (Suite CXO), the pure part.
 * Shared by the daily Hetzner tick (lib/mira/calendarConflicts) and Ciao's
 * on-demand tool (calendar_conflicts), so the notice and the answer agree.
 *
 * Four checks on a person's own upcoming meetings:
 *  - double: two meetings overlap
 *  - no_break: back to back for hours with no real gap
 *  - no_link: a meeting with other people, no video link and no place
 *  - no_agenda: a group meeting with nothing in the invite notes
 * Declined meetings and ones that show as free are skipped. No model.
 */
import { CAL_CONFLICT_PREFIX } from '@/lib/followups/noticeActionsShared'

export const LOOKAHEAD_DAYS = 7
/** Link and agenda checks look this many days out (further out is too early to nag). */
export const PREP_DAYS = 3
/** A gap shorter than this is not a break. */
export const MIN_BREAK_MIN = 15
/** Back to back for this long is a day with no break. */
export const MAX_STRETCH_MIN = 240
/** Group meeting: at least this many other people on the invite. */
export const AGENDA_MIN_OTHERS = 2
export const AGENDA_MIN_MINUTES = 30
/** Most new notices one person gets from one daily check. */
export const MAX_NEW_PER_DAY = 5

export type ConflictKind = 'double' | 'no_break' | 'no_link' | 'no_agenda'
export type CalEvent = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  attendees: Array<{ email: string; name: string | null }>
  videoLink?: string | null
  location?: string | null
  hasAgenda?: boolean
  notBusy?: boolean
}
export type Issue = { kind: ConflictKind; key: string; day: string; eventIds: string[]; title: string; body: string; line: string }

const ORDER: Record<ConflictKind, number> = { double: 0, no_break: 1, no_link: 2, no_agenda: 3 }
const ms = (iso: string) => Date.parse(iso)
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()
const dayLabel = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(iso))
const short = (s: string, n = 70) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim() || 'Untitled meeting'
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** Keys say what and whom: one notice per issue per person. */
export function issueKey(kind: ConflictKind, ref: string, memberId: string): string {
  return `${CAL_CONFLICT_PREFIX}${kind}-${ref}-${memberId}`
}

export function detectIssues(input: { events: CalEvent[]; tz: string; now: Date; selfEmails: string[]; memberId: string }): Issue[] {
  const { tz, now, memberId } = input
  const self = new Set(input.selfEmails.map(lower).filter(Boolean))
  const nowMs = now.getTime()
  const horizon = nowMs + LOOKAHEAD_DAYS * 86_400_000
  const prepHorizon = nowMs + PREP_DAYS * 86_400_000
  const seen = new Set<string>()
  const timed = input.events
    .filter((e) => !e.allDay && !e.notBusy && e.start && e.end && ms(e.end) > ms(e.start) && ms(e.start) > nowMs && ms(e.start) < horizon)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => ms(a.start) - ms(b.start) || ms(a.end) - ms(b.end))
  const others = (e: CalEvent) => e.attendees.filter((a) => !self.has(lower(a.email))).length
  const out: Issue[] = []

  // Double-booked: every overlapping pair.
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]
      const b = timed[j]
      if (ms(b.start) >= ms(a.end)) break
      const ids = [a.id, b.id].sort()
      const when = `${dayLabel(b.start, tz)} at ${timeOf(b.start, tz)}`
      out.push({
        kind: 'double',
        key: issueKey('double', ids.join('~'), memberId),
        day: dayOf(b.start, tz),
        eventIds: [a.id, b.id],
        title: `Double-booked ${when}`,
        body: `"${short(a.title)}" (${timeOf(a.start, tz)} to ${timeOf(a.end, tz)}) overlaps "${short(b.title)}" (${timeOf(b.start, tz)} to ${timeOf(b.end, tz)}).`,
        line: `${when}: "${short(a.title)}" overlaps "${short(b.title)}".`,
      })
    }
  }

  // No break: merge meetings with gaps under MIN_BREAK_MIN; flag a long stretch, once per day.
  const byDay = new Map<string, CalEvent[]>()
  for (const e of timed) byDay.set(dayOf(e.start, tz), [...(byDay.get(dayOf(e.start, tz)) ?? []), e])
  for (const [day, list] of byDay) {
    let s = ms(list[0].start)
    let e = ms(list[0].end)
    let count = 1
    let worst: { s: number; e: number; count: number } | null = null
    const close = () => {
      if (e - s >= MAX_STRETCH_MIN * 60_000 && count >= 3 && (!worst || e - s > worst.e - worst.s)) worst = { s, e, count }
    }
    for (const m of list.slice(1)) {
      if (ms(m.start) - e < MIN_BREAK_MIN * 60_000) {
        e = Math.max(e, ms(m.end))
        count++
      } else {
        close()
        s = ms(m.start)
        e = ms(m.end)
        count = 1
      }
    }
    close()
    if (worst) {
      const w = worst as { s: number; e: number; count: number }
      const from = new Date(w.s).toISOString()
      const to = new Date(w.e).toISOString()
      const hours = Math.round(((w.e - w.s) / 3_600_000) * 10) / 10
      out.push({
        kind: 'no_break',
        key: issueKey('no_break', day, memberId),
        day,
        eventIds: list.filter((m) => ms(m.start) >= w.s && ms(m.start) < w.e).map((m) => m.id),
        title: `No break ${dayLabel(from, tz)}`,
        body: `${w.count} meetings back to back from ${timeOf(from, tz)} to ${timeOf(to, tz)} (${hours} hours) with no gap of ${MIN_BREAK_MIN} minutes.`,
        line: `${dayLabel(from, tz)}: ${w.count} meetings back to back, ${timeOf(from, tz)} to ${timeOf(to, tz)}, no break.`,
      })
    }
  }

  // Prep: video link and agenda, a few days out.
  for (const e of timed) {
    if (ms(e.start) > prepHorizon) continue
    const n = others(e)
    if (!n) continue
    const when = `${dayLabel(e.start, tz)} at ${timeOf(e.start, tz)}`
    if (!e.videoLink && !String(e.location ?? '').trim()) {
      out.push({
        kind: 'no_link',
        key: issueKey('no_link', e.id, memberId),
        day: dayOf(e.start, tz),
        eventIds: [e.id],
        title: `No video link: ${short(e.title, 60)}`,
        body: `"${short(e.title)}" ${when} has ${n} other ${n === 1 ? 'person' : 'people'} invited, no video link and no place.`,
        line: `${when}: "${short(e.title)}" has no video link or place.`,
      })
    }
    if (e.hasAgenda === false && n >= AGENDA_MIN_OTHERS && ms(e.end) - ms(e.start) >= AGENDA_MIN_MINUTES * 60_000) {
      out.push({
        kind: 'no_agenda',
        key: issueKey('no_agenda', e.id, memberId),
        day: dayOf(e.start, tz),
        eventIds: [e.id],
        title: `No agenda: ${short(e.title, 60)}`,
        body: `"${short(e.title)}" ${when} has ${n} other people invited and nothing in the invite notes.`,
        line: `${when}: "${short(e.title)}" has no agenda.`,
      })
    }
  }

  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.day.localeCompare(b.day))
}
