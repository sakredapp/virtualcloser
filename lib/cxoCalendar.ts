/**
 * Calendar writes for Mira and the MCP server: open slots, create / update /
 * cancel events with invites, on whichever of the executive's connected
 * Google accounts they choose.
 *
 * This is a thin layer over lib/google.ts — the same createCalendarEvent /
 * patchCalendarEvent / deleteCalendarEvent / getBusySlots / findFreeSlots
 * that book_meeting, reschedule_meeting and cancel_meeting already use. What
 * it adds: every busy check runs across EVERY connected account and every
 * calendar in it (so Mira never double-books someone with a work calendar on
 * one Google account and a board calendar on another), attendees get
 * invited (sendUpdates=all), and a 403 insufficient-scope answer becomes
 * `reconnect_needed` so Mira can say "reconnect your calendar on the
 * Calendar page to let me create events".
 */

import {
  GoogleScopeError,
  createCalendarEvent,
  deleteCalendarEvent,
  findFreeSlots,
  getBusySlots,
  getCalendarEvent,
  listCalendars,
  listConnectedGoogleAccounts,
  patchCalendarEvent,
  type BusySlot,
  type ConnectedAccount,
} from '@/lib/google'

export type WritableCalendar = {
  accountId: string
  memberId: string | null
  accountEmail: string | null
  accountLabel: string
  calendarId: string
  name: string
  primary: boolean
}

export type CalendarError = 'not_connected' | 'reconnect_needed' | 'google_error'

export class CalendarWriteError extends Error {
  constructor(public code: CalendarError, message: string) {
    super(message)
  }
}

export const RECONNECT_HINT = 'Reconnect your calendar on the Calendar page to let me create events.'

function fail(code: CalendarError): never {
  const msg =
    code === 'not_connected'
      ? 'No Google calendar is connected. Connect one on the Calendar page.'
      : code === 'reconnect_needed'
        ? RECONNECT_HINT
        : 'Google Calendar did not accept that. Try again in a moment.'
  throw new CalendarWriteError(code, msg)
}

/** Turn a strict google.ts failure into our error vocabulary. */
function rethrow(err: unknown): never {
  if (err instanceof CalendarWriteError) throw err
  if (err instanceof GoogleScopeError) fail('reconnect_needed')
  if (err instanceof Error && err.message === 'google_not_connected') fail('not_connected')
  console.error('[cxoCalendar]', err)
  fail('google_error')
}

export function fmtInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso))
}

// ── Accounts + calendars ────────────────────────────────────────────────────

/**
 * Which accounts a calendar call may touch. Executives: every connected
 * account in the workspace (today's behaviour). `ownOnly` (employee logins,
 * owner 10-10): only the Google account that member connected themselves,
 * never a coworker's or the shared workspace account.
 */
export type CalendarScope = { ownOnly?: boolean }

async function scopedAccounts(repId: string, memberId: string | null, scope?: CalendarScope): Promise<ConnectedAccount[]> {
  const accounts = await listConnectedGoogleAccounts(repId)
  if (scope?.ownOnly) return memberId ? accounts.filter((a) => a.memberId === memberId && !a.isShared) : []
  return accounts
}

/** The exec's own accounts first, then the workspace's. */
async function orderedAccounts(repId: string, memberId: string | null, scope?: CalendarScope): Promise<ConnectedAccount[]> {
  const accounts = await scopedAccounts(repId, memberId, scope)
  return [...accounts.filter((a) => a.memberId === memberId), ...accounts.filter((a) => a.memberId !== memberId)]
}

/** Every calendar the executive can write to, across every connected account. */
export async function listWritableCalendars(repId: string, memberId: string | null, scope?: CalendarScope): Promise<WritableCalendar[]> {
  const out: WritableCalendar[] = []
  for (const a of await orderedAccounts(repId, memberId, scope)) {
    const cals = (await listCalendars(repId, { memberId: a.memberId, accountId: a.accountId }).catch(() => null)) ?? []
    for (const c of cals) {
      if (!['owner', 'writer'].includes(c.accessRole)) continue
      out.push({ accountId: a.accountId, memberId: a.memberId, accountEmail: a.email, accountLabel: a.label, calendarId: c.id, name: c.summary, primary: c.primary })
    }
  }
  return out
}

/**
 * Pick the calendar an event goes on. Default: the exec's own account's
 * primary. `want` matches a calendar name or account email. Several equally
 * good matches → `ambiguous` with the choices so Mira can ask.
 */
export async function chooseCalendar(
  repId: string,
  memberId: string | null,
  want?: string | null,
  scope?: CalendarScope,
): Promise<{ calendar: WritableCalendar | null; choices: WritableCalendar[]; ambiguous: boolean }> {
  const all = await listWritableCalendars(repId, memberId, scope)
  if (all.length === 0) return { calendar: null, choices: [], ambiguous: false }
  const q = want?.trim().toLowerCase()
  if (q && q !== 'primary' && q !== 'default') {
    const hits = all.filter((c) => c.name.toLowerCase().includes(q) || (c.accountEmail ?? '').toLowerCase().includes(q))
    if (hits.length === 1) return { calendar: hits[0], choices: all, ambiguous: false }
    const prim = hits.filter((c) => c.primary)
    if (prim.length === 1) return { calendar: prim[0], choices: all, ambiguous: false }
    if (hits.length > 1) return { calendar: null, choices: hits, ambiguous: true }
  }
  const primaries = all.filter((c) => c.primary)
  return { calendar: primaries[0] ?? all[0], choices: all, ambiguous: false }
}

// ── Busy across everything ──────────────────────────────────────────────────

export type Busy = { startIso: string; endIso: string; calendar: string }

/** Union of getBusySlots over every connected account (each already spans every calendar in it). */
export async function busyAcrossAll(repId: string, fromIso: string, toIso: string, own?: { memberId: string | null } & CalendarScope): Promise<Busy[]> {
  const busy: Busy[] = []
  const accounts = own?.ownOnly ? await scopedAccounts(repId, own.memberId, own) : await listConnectedGoogleAccounts(repId)
  for (const a of accounts) {
    const slots = await getBusySlots(repId, fromIso, toIso, { memberId: a.memberId, accountId: a.accountId }).catch(() => null)
    for (const b of slots ?? []) busy.push({ startIso: b.startIso, endIso: b.endIso, calendar: `${b.calendar ?? 'Calendar'} (${a.email ?? a.label})` })
  }
  return busy.sort((x, y) => x.startIso.localeCompare(y.startIso))
}

export function conflictIn(busy: Busy[], startIso: string, endIso: string): Busy | null {
  const s = new Date(startIso).getTime()
  const e = new Date(endIso).getTime()
  for (const b of busy) {
    if (new Date(b.startIso).getTime() < e && new Date(b.endIso).getTime() > s) return b
  }
  return null
}

export type OpenSlot = { startIso: string; endIso: string; label: string }

/** findFreeSlots, fed the busy union across every account. */
export async function findOpenSlots(
  repId: string,
  opts: { fromIso: string; toIso: string; durationMin: number; tz: string; startHour?: number; endHour?: number; count?: number },
  own?: { memberId: string | null } & CalendarScope,
): Promise<{ slots: OpenSlot[]; checkedCalendars: number; busy: Busy[] }> {
  const accounts = own?.ownOnly ? await scopedAccounts(repId, own.memberId, own) : await listConnectedGoogleAccounts(repId)
  if (accounts.length === 0) fail('not_connected')
  const busy = await busyAcrossAll(repId, opts.fromIso, opts.toIso, own)
  const found =
    (await findFreeSlots(repId, {
      fromIso: opts.fromIso,
      toIso: opts.toIso,
      durationMinutes: Math.max(15, opts.durationMin),
      count: Math.min(Math.max(opts.count ?? 5, 1), 12),
      tz: opts.tz,
      businessStartHour: opts.startHour ?? 9,
      businessEndHour: opts.endHour ?? 17,
      busy: busy as BusySlot[],
      spacingMinutes: 30,
    })) ?? []
  const slots = found.map((s) => ({ startIso: s.startIso, endIso: s.endIso, label: fmtInTz(s.startIso, opts.tz) }))
  const calendarCount = new Set(busy.map((b) => b.calendar)).size
  return { slots, checkedCalendars: Math.max(calendarCount, accounts.length), busy }
}

// ── Events ──────────────────────────────────────────────────────────────────

export type EventResult = { id: string; htmlLink: string; meetLink: string | null; calendar: WritableCalendar; startIso: string; endIso: string }

export async function createEventWithInvites(
  repId: string,
  memberId: string | null,
  input: {
    calendar?: string | null
    title: string
    description?: string | null
    location?: string | null
    startIso: string
    endIso: string
    tz: string
    attendees: Array<{ email: string; displayName?: string }>
    addMeet?: boolean
    allowConflict?: boolean
  },
  scope?: CalendarScope,
): Promise<EventResult> {
  const pick = await chooseCalendar(repId, memberId, input.calendar, scope)
  if (!pick.calendar) fail('not_connected')
  if (pick.ambiguous) throw new CalendarWriteError('google_error', `Which calendar? ${pick.choices.map((c) => `${c.name} (${c.accountEmail ?? c.accountLabel})`).join(', ')}`)
  const cal = pick.calendar
  if (!input.allowConflict) {
    const hit = conflictIn(await busyAcrossAll(repId, input.startIso, input.endIso, { memberId, ...scope }), input.startIso, input.endIso)
    if (hit) throw new CalendarWriteError('google_error', `That overlaps ${hit.calendar} from ${fmtInTz(hit.startIso, input.tz)} to ${fmtInTz(hit.endIso, input.tz)}. Pick another time.`)
  }
  try {
    const ev = await createCalendarEvent({
      repId,
      memberId: cal.memberId,
      accountId: cal.accountId,
      calendarId: cal.calendarId,
      summary: input.title,
      description: input.description ?? '',
      location: input.location ?? undefined,
      startIso: input.startIso,
      endIso: input.endIso,
      timezone: input.tz,
      attendees: input.attendees,
      sendUpdates: 'all',
      addMeet: input.addMeet,
      strict: true,
    })
    if (!ev) fail('google_error')
    return { id: ev.id, htmlLink: ev.htmlLink, meetLink: ev.hangoutLink, calendar: cal, startIso: input.startIso, endIso: input.endIso }
  } catch (err) {
    rethrow(err)
  }
}

type Located = { cal: WritableCalendar; event: NonNullable<Awaited<ReturnType<typeof getCalendarEvent>>> }

async function locateEvent(repId: string, memberId: string | null, eventId: string, scope?: CalendarScope): Promise<Located | null> {
  for (const cal of await listWritableCalendars(repId, memberId, scope)) {
    const event = await getCalendarEvent(repId, eventId, { memberId: cal.memberId, accountId: cal.accountId, calendarId: cal.calendarId })
    if (event) return { cal, event }
  }
  return null
}

export async function updateEventWithNotice(
  repId: string,
  memberId: string | null,
  eventId: string,
  patch: { title?: string; description?: string; location?: string; startIso?: string; endIso?: string; tz: string; addAttendees?: string[] },
  scope?: CalendarScope,
): Promise<{ id: string; htmlLink: string; calendar: WritableCalendar }> {
  const found = await locateEvent(repId, memberId, eventId, scope)
  if (!found) throw new CalendarWriteError('google_error', 'I could not find that event on any connected calendar.')
  let attendees: Array<{ email: string; displayName?: string }> | undefined
  if (patch.addAttendees?.length) {
    const current = found.event.attendees ?? []
    const have = new Set(current.map((a) => a.email.toLowerCase()))
    attendees = [...current.map((a) => ({ email: a.email, displayName: a.displayName })), ...patch.addAttendees.filter((e) => !have.has(e.toLowerCase())).map((email) => ({ email }))]
  }
  if (patch.startIso && patch.endIso) {
    // The event being moved is itself "busy" at its old time; ignore that block.
    const oldS = found.event.start ? new Date(found.event.start).getTime() : null
    const oldE = found.event.end ? new Date(found.event.end).getTime() : null
    const busy = (await busyAcrossAll(repId, patch.startIso, patch.endIso, { memberId, ...scope })).filter(
      (b) => !(oldS !== null && oldE !== null && new Date(b.startIso).getTime() === oldS && new Date(b.endIso).getTime() === oldE),
    )
    const hit = conflictIn(busy, patch.startIso, patch.endIso)
    if (hit) throw new CalendarWriteError('google_error', `That overlaps ${hit.calendar} at ${fmtInTz(hit.startIso, patch.tz)}. Pick another time.`)
  }
  try {
    const res = await patchCalendarEvent(repId, eventId, {
      memberId: found.cal.memberId,
      accountId: found.cal.accountId,
      calendarId: found.cal.calendarId,
      summary: patch.title,
      description: patch.description,
      location: patch.location,
      attendees,
      startIso: patch.startIso,
      endIso: patch.endIso,
      timezone: patch.tz,
      sendUpdates: 'all',
      strict: true,
    })
    if (!res) fail('google_error')
    return { id: res.id, htmlLink: res.htmlLink, calendar: found.cal }
  } catch (err) {
    rethrow(err)
  }
}

export async function cancelEventWithNotice(repId: string, memberId: string | null, eventId: string, scope?: CalendarScope): Promise<{ ok: true; calendar: WritableCalendar }> {
  const found = await locateEvent(repId, memberId, eventId, scope)
  if (!found) throw new CalendarWriteError('google_error', 'I could not find that event on any connected calendar.')
  try {
    const ok = await deleteCalendarEvent(repId, eventId, { memberId: found.cal.memberId, accountId: found.cal.accountId, calendarId: found.cal.calendarId, sendUpdates: 'all', strict: true })
    if (!ok) fail('google_error')
    return { ok: true, calendar: found.cal }
  } catch (err) {
    rethrow(err)
  }
}

/** Does the stored token carry calendar write scope? Null when nothing is connected. */
export async function calendarWriteReady(repId: string): Promise<{ connected: boolean; canWrite: boolean; accounts: number }> {
  const accounts = await listConnectedGoogleAccounts(repId)
  if (accounts.length === 0) return { connected: false, canWrite: false, accounts: 0 }
  const { supabase } = await import('@/lib/supabase')
  const { data } = await supabase.from('google_tokens').select('scope').eq('rep_id', repId)
  const scopes = ((data ?? []) as { scope: string | null }[]).map((r) => r.scope ?? '')
  // A row with no recorded scope predates scope tracking; let the call try and 403 → reconnect hint.
  const canWrite = scopes.some((s) => !s || s.includes('calendar.events') || /auth\/calendar(\s|$)/.test(s))
  return { connected: true, canWrite, accounts: accounts.length }
}
