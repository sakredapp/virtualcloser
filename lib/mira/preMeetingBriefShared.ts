/**
 * Brief Before Every Meeting (Suite CXO): the pure half. Which meetings get a
 * brief, the key that keeps it to one brief per meeting per person, which
 * earlier note is "last time", and the brief's words. No database, no model,
 * no clock of its own, so the rules are pinned by tests.
 *
 * Rules kept here:
 *  - A meeting is briefed once, roughly 30 to 90 minutes before it starts.
 *    The key is the SAME key the daily queue and a connected Claude use
 *    (`mtg:<event id>:<day>`), so whichever writes first wins and the others
 *    never write a second brief for that meeting.
 *  - Deterministic and model-free: the words are built from what is on file.
 *  - Nothing useful beyond the title (no earlier note with decisions or open
 *    items, no open to-dos or cards with those people, no recent email) means
 *    no brief at all. A head count alone is not worth a line on Today.
 *  - At most MAX_LINES short lines.
 */
import { titleWords } from '@/lib/meetings/noteMatch'

export const WINDOW_MIN_MINUTES = 30
export const WINDOW_MAX_MINUTES = 90
export const MAX_LINES = 6
/** At most this many meetings are briefed for one person in one check. */
export const MAX_PER_CHECK = 6

const MIN = 60_000
const oneLine = (s: string, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()

export type BriefEvent = {
  id: string
  title: string
  start: string
  end?: string | null
  allDay?: boolean
  attendees: Array<{ email: string; name: string | null }>
}

/** The one key per meeting per person (shared with lib/mira/dailyQueue.ts). */
export function briefKey(eventId: string, day: string): string {
  return `mtg:${eventId}:${day}`.slice(0, 200)
}

/** True when the meeting starts between 30 and 90 minutes from now. */
export function inBriefWindow(startIso: string, nowMs: number): boolean {
  const s = Date.parse(startIso)
  if (!Number.isFinite(s)) return false
  const ahead = s - nowMs
  return ahead >= WINDOW_MIN_MINUTES * MIN && ahead <= WINDOW_MAX_MINUTES * MIN
}

/**
 * The meetings to brief in this check: timed (not all-day), starting in the
 * window, not already briefed (by any writer), each event once, soonest first.
 */
export function pickMeetings<E extends BriefEvent>(events: E[], nowMs: number, dayOf: (iso: string) => string, have: Set<string>): Array<E & { key: string; day: string }> {
  const out: Array<E & { key: string; day: string }> = []
  const seen = new Set<string>()
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    if (!e.id || e.allDay || e.start.length === 10) continue
    if (!inBriefWindow(e.start, nowMs)) continue
    const day = dayOf(e.start)
    const key = briefKey(e.id, day)
    if (have.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ ...e, key, day })
    if (out.length >= MAX_PER_CHECK) break
  }
  return out
}

// ── Who is coming ───────────────────────────────────────────────────────────

export type DirMember = { id: string; email: string | null; display_name: string | null }
export type DirPartner = { id: string; name: string; org: string | null; email: string | null }
export type Attendee =
  | { kind: 'member'; id: string; name: string; email: string }
  | { kind: 'partner'; id: string; name: string; org: string | null; email: string }
  | { kind: 'guest'; email: string; name: string | null }

/** Each guest (never the person themselves) matched to a team member or a directory partner by email. */
export function resolveAttendees(ev: Pick<BriefEvent, 'attendees'>, selfEmails: string[], members: DirMember[], partners: DirPartner[]): Attendee[] {
  const self = new Set(selfEmails.map(lower).filter(Boolean))
  const byMember = new Map(members.filter((m) => m.email).map((m) => [lower(m.email), m]))
  const byPartner = new Map(partners.filter((p) => p.email).map((p) => [lower(p.email), p]))
  const out: Attendee[] = []
  const seen = new Set<string>()
  for (const a of ev.attendees) {
    const email = lower(a.email)
    if (!email || self.has(email) || seen.has(email)) continue
    seen.add(email)
    const m = byMember.get(email)
    if (m) {
      out.push({ kind: 'member', id: m.id, name: (m.display_name || '').trim() || email.split('@')[0], email })
      continue
    }
    const p = byPartner.get(email)
    if (p) {
      out.push({ kind: 'partner', id: p.id, name: p.name.trim() || email.split('@')[0], org: p.org?.trim() || null, email })
      continue
    }
    out.push({ kind: 'guest', email, name: a.name?.trim() || null })
  }
  return out
}

export function attendeeLine(people: Attendee[]): string {
  const named = people.filter((p) => p.kind !== 'guest').map((p) => (p.kind === 'partner' && p.org && lower(p.org) !== lower(p.name) ? `${p.name} (${p.org})` : p.name))
  const guests = people.filter((p) => p.kind === 'guest').length
  if (!named.length && !guests) return 'Just you on the invite.'
  const shown = named.slice(0, 3)
  const rest = named.length - shown.length + guests
  const restWords = rest > 0 ? `${rest} ${shown.length ? 'more' : rest === 1 ? 'guest' : 'guests'}` : ''
  const parts = [...shown, ...(restWords ? [restWords] : [])]
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `With ${list}.`
}

// ── Last time ───────────────────────────────────────────────────────────────

export type PastNote = {
  id: string
  title: string | null
  occurred_at: string
  calendar_event_id?: string | null
  attendees?: unknown
  mira_digest?: { decisions?: unknown; items?: unknown } | null
}

/** Attendee identifiers on a note (array of strings or {email,name} objects), lower-cased. */
function noteEmails(v: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(v)) return out
  for (const a of v) {
    if (typeof a === 'string') out.add(lower(a))
    else if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>
      for (const k of ['email', 'name', 'displayName']) if (typeof o[k] === 'string') out.add(lower(o[k]))
    }
  }
  out.delete('')
  return out
}

/** A recurring event's instances share the id before the `_<instant>` suffix. */
export function seriesId(eventId: string | null | undefined): string | null {
  const id = String(eventId ?? '')
  const m = id.match(/^(.+)_\d{8}(T\d{6}Z)?$/)
  return m ? m[1] : null
}

/**
 * The most recent earlier note that is about this meeting: an earlier
 * instance of the same recurring event, most of the title's words (the
 * daily queue's rule), or the same guests (at least two of them, or the only
 * one when it is a one-on-one). Notes from the last 15 minutes are this
 * meeting's own recording starting early, not "last time".
 */
export function lastNoteFor<N extends PastNote>(ev: Pick<BriefEvent, 'id' | 'title' | 'start'>, guestEmails: string[], notes: N[]): N | null {
  const start = Date.parse(ev.start)
  const words = titleWords(ev.title)
  const series = seriesId(ev.id)
  const guests = new Set(guestEmails.map(lower).filter(Boolean))
  const needPeople = Math.min(2, guests.size)
  let best: N | null = null
  for (const n of notes) {
    const t = Date.parse(n.occurred_at)
    if (!Number.isFinite(t) || t >= start - 15 * MIN) continue
    if (best && t <= Date.parse(best.occurred_at)) continue
    const sameSeries = !!series && seriesId(n.calendar_event_id) === series
    let hit = 0
    for (const x of titleWords(n.title)) if (words.has(x)) hit++
    const sameTitle = words.size > 0 && hit >= Math.min(2, words.size) && hit >= Math.ceil(words.size / 2)
    let people = 0
    if (needPeople > 0) for (const e of noteEmails(n.attendees)) if (guests.has(e)) people++
    const samePeople = needPeople > 0 && people >= needPeople
    if (sameSeries || sameTitle || samePeople) best = n
  }
  return best
}

const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as { text?: unknown }).text ?? '') : '')).map((s) => oneLine(s, max)).filter(Boolean)

/** Decisions on file for a note (mira_digest.decisions). */
export const noteDecisions = (n: PastNote | null): string[] => (n ? strings(n.mira_digest?.decisions, 140) : [])
/** Action items the note's digest named (mira_digest.items), used only when none were filed as to-dos. */
export const noteItems = (n: PastNote | null): string[] => (n ? strings(n.mira_digest?.items, 120) : [])

// ── The brief ───────────────────────────────────────────────────────────────

export type BriefInput = {
  title: string
  /** "2:30pm" in the person's own time zone. */
  time: string
  people: Attendee[]
  last: { date: string; title: string | null; decisions: string[] } | null
  /** Open to-dos filed from that last note (or its digest items when none were filed). */
  stillOpen: string[]
  /** Open to-dos the person holds that name or link one of these people. */
  todos: string[]
  /** Open board cards the person can see that one of these people holds. */
  cards: string[]
  /** The newest email thread from a partner on the invite, from the person's own mailbox. */
  lastEmail: { from: string; subject: string; date: string } | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-02…" → "Oct 2". */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`
}

function listWords(items: string[], show: number): string {
  const shown = items.slice(0, show)
  const more = items.length - shown.length
  return `${shown.join('; ')}${more > 0 ? ` (+${more} more)` : ''}`
}

/**
 * The brief, or null when there is nothing useful to say beyond who is
 * coming. Title like the daily queue's ("Carrier review · 2:30pm").
 */
export function composeBrief(b: BriefInput): { title: string; body: string } | null {
  const lines: string[] = []
  const decisions = b.last?.decisions ?? []
  if (b.last && decisions.length) {
    const about = b.last.title && lower(b.last.title) !== lower(b.title) ? `, ${oneLine(b.last.title, 60)}` : ''
    lines.push(`Last time (${shortDate(b.last.date)}${about}): ${listWords(decisions, 2)}.`)
  }
  if (b.last && b.stillOpen.length) lines.push(`Still open from it: ${listWords(b.stillOpen, 2)}.`)
  const fromNote = new Set(b.stillOpen.map(lower))
  const todos = b.todos.filter((t) => !fromNote.has(lower(t)))
  if (todos.length) lines.push(`Your open to-dos with them: ${listWords(todos, 2)}.`)
  if (b.cards.length) lines.push(`On the boards: ${listWords(b.cards, 2)}.`)
  if (b.lastEmail) lines.push(`Last email from ${b.lastEmail.from}: "${oneLine(b.lastEmail.subject, 80)}" (${shortDate(b.lastEmail.date)}).`)
  if (!lines.length) return null
  const body = [attendeeLine(b.people), ...lines].slice(0, MAX_LINES).map((l) => oneLine(l, 240)).join('\n')
  const title = `${oneLine(b.title || 'Meeting', 120)} · ${b.time}`
  return { title, body }
}

/** Does a to-do name or link one of these people? Links win; a full name (two words or more) in its text also counts. */
export function todoMentions(t: { body: string; partner_id?: string | null; assignee_partner_id?: string | null; link_id?: string | null; partner_name?: string | null; assignee_name?: string | null }, people: Attendee[]): boolean {
  const ids = new Set(people.filter((p) => p.kind !== 'guest').map((p) => (p as { id: string }).id))
  if ([t.partner_id, t.assignee_partner_id, t.link_id].some((x) => !!x && ids.has(x))) return true
  const text = lower(`${t.body} ${t.partner_name ?? ''} ${t.assignee_name ?? ''}`).replace(/\s+/g, ' ')
  return people.some((p) => {
    if (p.kind === 'guest') return false
    const name = lower(p.name).replace(/\s+/g, ' ')
    return name.split(' ').length >= 2 && text.includes(name)
  })
}
