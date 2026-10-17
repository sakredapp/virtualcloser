/**
 * The first read (Suite CXO), the pure part: no DB, no network, no model.
 *
 * After someone connects Google, the assistant reads the account once and
 * shows what it learned (lib/firstRead/run.ts does the fetching and saving).
 * Everything that can be counted is counted here, in code: the people they
 * meet and write to most, recurring meetings, upcoming double-bookings and
 * emails waiting on their reply. The model only phrases 2 to 4 offers of help,
 * and each offer must point at items found here (validateSuggestions), so
 * nothing on the card is invented.
 */

export const WINDOW_DAYS = 14
/** Most inbox messages read (headers only). */
export const MAX_MESSAGES = 200
export const MAX_PEOPLE = 6
export const MAX_RECURRING = 5
export const MAX_CONFLICTS = 6
export const MAX_WAITING = 8
export const MAX_SUGGESTIONS = 4
/** A meeting this big is an all-hands, not time with a person. */
const BIG_MEETING = 25

// ── Inputs ──────────────────────────────────────────────────────────────

export type FREvent = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  /** On one of their own calendars (primary or one they own), not a colleague's they subscribe to. */
  own: boolean
  seriesId: string | null
  attendees: Array<{ email: string; name: string | null; self?: boolean; declined?: boolean }>
  /** They declined it, or it shows as free. */
  notBusy: boolean
}

export type FRMessage = {
  at: number
  labelIds: string[]
  fromAddress: string
  fromName: string | null
  toAddresses: string[]
  ccAddresses: string[]
  subject: string
  listUnsubscribe: boolean
  precedence: string | null
  autoSubmitted: string | null
}

export type FRThread = { id: string; messages: FRMessage[] }

// ── Output (stored in cxo_first_reads.summary) ─────────────────────────

export type FRPerson = { name: string; email: string; meetings: number; emails: number }
export type FRRecurring = { title: string; count: number; next: string | null }
export type FRConflict = { id: string; day: string; a: { title: string; start: string; end: string }; b: { title: string; start: string; end: string } }
export type FRWaiting = { id: string; from: string; email: string; subject: string; at: string }
export type FRSuggestion = { text: string; refs: string[] }
export type InboxState = { read: true; messages: number } | { read: false; reason: 'not_offered' | 'no_scope' | 'calendar_only' | 'error' }

export type FirstReadSummary = {
  version: 1
  generatedAt: string
  timezone: string
  calendars: string[]
  meetings: { past: number; upcoming: number }
  inbox: InboxState
  people: FRPerson[]
  recurring: FRRecurring[]
  conflicts: FRConflict[]
  waiting: FRWaiting[]
  suggestions: FRSuggestion[]
}

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const ms = (iso: string) => Date.parse(iso)

/** Meeting rooms and Google group calendars show up as attendees: not people. */
export function isRoomOrGroup(email: string): boolean {
  const e = lower(email)
  return e.endsWith('resource.calendar.google.com') || e.endsWith('group.calendar.google.com') || e.endsWith('@group.v.calendar.google.com')
}

// ── The inbox gate ──────────────────────────────────────────────────────

/**
 * May the first read look at this account's inbox? Only where the company is
 * offered the inbox at all (lib/cxoFeatures inboxAllowed), never on an outside
 * calendar, and only when the grant actually carries a Gmail read scope.
 */
export function inboxGate(input: { tenantAllowsInbox: boolean; calendarOnly: boolean | null | undefined; scope: string | null | undefined }): { ok: true } | { ok: false; reason: 'not_offered' | 'no_scope' | 'calendar_only' } {
  if (!input.tenantAllowsInbox) return { ok: false, reason: 'not_offered' }
  if (input.calendarOnly) return { ok: false, reason: 'calendar_only' }
  const scopes = String(input.scope ?? '').split(/\s+/)
  const canRead = scopes.some((s) => s === 'https://www.googleapis.com/auth/gmail.readonly' || s === 'https://www.googleapis.com/auth/gmail.modify' || s === 'https://mail.google.com/')
  return canRead ? { ok: true } : { ok: false, reason: 'no_scope' }
}

// ── Newsletters and no-reply mail ──────────────────────────────────────

const AUTOMATED_LOCAL =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|notify|mailer[-_.]?daemon|postmaster|bounces?|newsletters?|news|marketing|updates|alerts?|digest|automated|auto[-_.]?confirm|calendar[-_.]?notification|invitations?|receipts?|billing|accounts?[-_.]?payable)(\+.*)?$/i
const AUTOMATED_DOMAIN = /(^|\.)(mailchimp|mcsv|sendgrid|mailgun|hubspotemail|mktomail|substack|beehiiv|constantcontact|klaviyo|amazonses|bounce)\./i
const BULK_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'SPAM'])

/** A sender address that never reads replies (no-reply, notifications, bulk senders). */
export function isAutomatedAddress(email: string): boolean {
  const e = lower(email)
  const at = e.lastIndexOf('@')
  if (at < 1) return true
  return AUTOMATED_LOCAL.test(e.slice(0, at)) || AUTOMATED_DOMAIN.test(e.slice(at + 1))
}

/** A newsletter, a notification or other bulk mail: never "waiting on your reply". */
export function isAutomatedMessage(m: Pick<FRMessage, 'fromAddress' | 'labelIds' | 'listUnsubscribe' | 'precedence' | 'autoSubmitted'>): boolean {
  if (isAutomatedAddress(m.fromAddress)) return true
  if (m.listUnsubscribe) return true
  if (m.precedence && /^(bulk|list|junk|auto_reply)$/i.test(m.precedence.trim())) return true
  if (m.autoSubmitted && m.autoSubmitted !== 'no') return true
  return m.labelIds.some((l) => BULK_LABELS.has(l))
}

const fromSelf = (m: FRMessage, self: Set<string>) => m.labelIds.includes('SENT') || self.has(lower(m.fromAddress))

// ── Waiting on their reply ─────────────────────────────────────────────

/**
 * Threads whose LAST message came from someone else (a person, not a
 * newsletter or no-reply sender) and is still in the inbox. Newest first.
 */
export function waitingOnReply(threads: FRThread[], selfEmails: string[]): FRWaiting[] {
  const self = new Set(selfEmails.map(lower).filter(Boolean))
  const out: Array<FRWaiting & { t: number }> = []
  for (const th of threads) {
    const msgs = [...th.messages].sort((a, b) => a.at - b.at)
    const last = msgs[msgs.length - 1]
    if (!last) continue
    if (fromSelf(last, self)) continue
    if (!last.labelIds.includes('INBOX')) continue
    if (last.labelIds.includes('TRASH') || last.labelIds.includes('SPAM')) continue
    if (isAutomatedMessage(last)) continue
    out.push({
      id: `w${out.length + 1}`,
      from: (last.fromName || last.fromAddress).trim(),
      email: lower(last.fromAddress),
      subject: last.subject.trim() || '(no subject)',
      at: new Date(last.at).toISOString(),
      t: last.at,
    })
  }
  return out
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_WAITING)
    .map(({ t: _t, ...w }, i) => ({ ...w, id: `w${i + 1}` }))
}

// ── Double-bookings ────────────────────────────────────────────────────

const dayOf = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

/**
 * Upcoming meetings on their own calendars that overlap, from now to
 * `days` ahead. All-day items, declined meetings and ones that show as free
 * are not time taken. The same meeting on two of their calendars is one.
 */
export function findConflicts(events: FREvent[], input: { now: Date; tz: string; days?: number }): FRConflict[] {
  const nowMs = input.now.getTime()
  const until = nowMs + (input.days ?? WINDOW_DAYS) * 86_400_000
  const seen = new Set<string>()
  const timed = events
    .filter((e) => e.own && !e.allDay && !e.notBusy && e.start && e.end && ms(e.end) > ms(e.start) && ms(e.end) > nowMs && ms(e.start) < until)
    .filter((e) => {
      const k1 = `id:${e.id}`
      const k2 = `t:${lower(e.title)}|${ms(e.start)}|${ms(e.end)}`
      if (seen.has(k1) || seen.has(k2)) return false
      seen.add(k1)
      seen.add(k2)
      return true
    })
    .sort((a, b) => ms(a.start) - ms(b.start) || ms(a.end) - ms(b.end))
  const out: FRConflict[] = []
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]
      const b = timed[j]
      if (ms(b.start) >= ms(a.end)) break
      out.push({
        id: `c${out.length + 1}`,
        day: dayOf(b.start, input.tz),
        a: { title: a.title, start: a.start, end: a.end },
        b: { title: b.title, start: b.start, end: b.end },
      })
    }
  }
  return out.slice(0, MAX_CONFLICTS)
}

// ── Recurring meetings ─────────────────────────────────────────────────

/** Series with at least two meetings in the window, on their own calendars. Most frequent first. */
export function recurringMeetings(events: FREvent[], now: Date): FRRecurring[] {
  const nowMs = now.getTime()
  const bySeries = new Map<string, { title: string; ids: Set<string>; next: number | null }>()
  for (const e of events) {
    if (!e.own || !e.seriesId || e.notBusy) continue
    const s = bySeries.get(e.seriesId) ?? { title: e.title, ids: new Set<string>(), next: null }
    s.ids.add(`${e.id}`)
    const st = ms(e.start)
    if (st >= nowMs && (s.next === null || st < s.next)) s.next = st
    bySeries.set(e.seriesId, s)
  }
  return [...bySeries.values()]
    .filter((s) => s.ids.size >= 2)
    .map((s) => ({ title: s.title, count: s.ids.size, next: s.next === null ? null : new Date(s.next).toISOString() }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, MAX_RECURRING)
}

// ── People ─────────────────────────────────────────────────────────────

/**
 * The people they spend time with: meetings shared (their own calendars, not
 * declined, not all-hands) plus emails exchanged (people only: no newsletters
 * or no-reply senders). Themselves, rooms and groups are left out.
 */
export function topPeople(events: FREvent[], threads: FRThread[], selfEmails: string[]): FRPerson[] {
  const self = new Set(selfEmails.map(lower).filter(Boolean))
  const people = new Map<string, FRPerson>()
  const touch = (email: string, name: string | null) => {
    const e = lower(email)
    if (!e || !e.includes('@') || self.has(e) || isRoomOrGroup(e) || isAutomatedAddress(e)) return null
    const p = people.get(e) ?? { name: '', email: e, meetings: 0, emails: 0 }
    const n = String(name ?? '').trim()
    if (n && !n.includes('@') && !p.name) p.name = n
    people.set(e, p)
    return p
  }
  const seenEvents = new Set<string>()
  for (const ev of events) {
    if (!ev.own || ev.notBusy || seenEvents.has(ev.id)) continue
    seenEvents.add(ev.id)
    const others = ev.attendees.filter((a) => !a.self && !self.has(lower(a.email)) && !isRoomOrGroup(a.email))
    if (others.length === 0 || others.length > BIG_MEETING) continue
    for (const a of others) {
      if (a.declined) continue
      const p = touch(a.email, a.name)
      if (p) p.meetings++
    }
  }
  for (const th of threads) {
    for (const m of th.messages) {
      if (fromSelf(m, self)) {
        for (const to of [...m.toAddresses, ...m.ccAddresses]) {
          const p = touch(to, null)
          if (p) p.emails++
        }
      } else if (!isAutomatedMessage(m)) {
        const p = touch(m.fromAddress, m.fromName)
        if (p) p.emails++
      }
    }
  }
  return [...people.values()]
    .map((p) => ({ ...p, name: p.name || p.email }))
    .sort((a, b) => b.meetings + b.emails - (a.meetings + a.emails) || b.meetings - a.meetings || a.name.localeCompare(b.name))
    .slice(0, MAX_PEOPLE)
}

// ── Suggestions ────────────────────────────────────────────────────────

/** What the model sees: derived facts only, each with an id it must cite. No email addresses. */
export function factsForModel(s: Pick<FirstReadSummary, 'people' | 'recurring' | 'conflicts' | 'waiting' | 'meetings' | 'inbox'>) {
  return {
    meetings: s.meetings,
    inbox_read: s.inbox.read,
    people: s.people.map((p, i) => ({ id: `p${i + 1}`, name: p.name.includes('@') ? p.name.split('@')[0] : p.name, meetings: p.meetings, emails: p.emails })),
    recurring: s.recurring.map((r, i) => ({ id: `r${i + 1}`, title: r.title, times_in_4_weeks: r.count })),
    conflicts: s.conflicts.map((c) => ({ id: c.id, day: c.day, a: c.a.title, b: c.b.title })),
    waiting_on_reply: s.waiting.map((w) => ({ id: w.id, from: w.from.includes('@') ? w.from.split('@')[0] : w.from, subject: w.subject })),
  }
}

export function validRefIds(s: Pick<FirstReadSummary, 'people' | 'recurring' | 'conflicts' | 'waiting'>): Set<string> {
  return new Set([
    ...s.people.map((_, i) => `p${i + 1}`),
    ...s.recurring.map((_, i) => `r${i + 1}`),
    ...s.conflicts.map((c) => c.id),
    ...s.waiting.map((w) => w.id),
  ])
}

/**
 * Keep only offers that cite at least one real item, carry no email address
 * or link, and are short. Anything else is dropped, never repaired.
 */
export function validateSuggestions(raw: unknown, valid: Set<string>): FRSuggestion[] {
  const list = Array.isArray((raw as { suggestions?: unknown })?.suggestions) ? (raw as { suggestions: unknown[] }).suggestions : Array.isArray(raw) ? raw : []
  const out: FRSuggestion[] = []
  for (const item of list) {
    const text = String((item as { text?: unknown })?.text ?? '').replace(/\s+/g, ' ').trim()
    const refs = Array.isArray((item as { refs?: unknown })?.refs) ? ((item as { refs: unknown[] }).refs.map(String).filter((r) => valid.has(r))) : []
    if (!text || text.length > 200 || refs.length === 0) continue
    if (/@|https?:\/\/|www\./i.test(text)) continue
    out.push({ text, refs: [...new Set(refs)] })
    if (out.length >= MAX_SUGGESTIONS) break
  }
  return out
}

/** The offers made from the facts alone, when the model is unavailable or cites nothing real. */
export function fallbackSuggestions(s: Pick<FirstReadSummary, 'people' | 'recurring' | 'conflicts' | 'waiting'>): FRSuggestion[] {
  const out: FRSuggestion[] = []
  const first = (n: string) => (n.includes('@') ? n.split('@')[0] : n.split(/\s+/)[0])
  if (s.conflicts.length) {
    const c = s.conflicts[0]
    out.push({ text: `Find a new time for "${c.a.title}" or "${c.b.title}" so they stop overlapping.`, refs: [c.id] })
  }
  if (s.waiting.length) {
    const n = s.waiting.length
    out.push({ text: `Draft replies to the ${n === 1 ? 'email' : `${n} emails`} waiting on you, starting with ${first(s.waiting[0].from)}'s.`, refs: s.waiting.slice(0, 3).map((w) => w.id) })
  }
  if (s.recurring.length) out.push({ text: `Put together a short agenda before the next "${s.recurring[0].title}".`, refs: ['r1'] })
  if (s.people.length) out.push({ text: `Pull up everything open with ${first(s.people[0].name)} before you next meet.`, refs: ['p1'] })
  return out.slice(0, MAX_SUGGESTIONS)
}

/** The stored summary minus the suggestions (all counted in code). */
export function analyze(input: {
  events: FREvent[]
  threads: FRThread[]
  selfEmails: string[]
  now: Date
  tz: string
  calendars: string[]
  inbox: InboxState
}): Omit<FirstReadSummary, 'suggestions'> {
  const nowMs = input.now.getTime()
  const own = new Map<string, FREvent>()
  for (const e of input.events) if (e.own && !e.notBusy && e.start) own.set(e.id, e)
  const owned = [...own.values()]
  return {
    version: 1,
    generatedAt: input.now.toISOString(),
    timezone: input.tz,
    calendars: input.calendars,
    meetings: {
      past: owned.filter((e) => ms(e.start) < nowMs).length,
      upcoming: owned.filter((e) => ms(e.start) >= nowMs).length,
    },
    inbox: input.inbox,
    people: topPeople(input.events, input.threads, input.selfEmails),
    recurring: recurringMeetings(input.events, input.now),
    conflicts: findConflicts(input.events, { now: input.now, tz: input.tz }),
    waiting: waitingOnReply(input.threads, input.selfEmails),
  }
}
