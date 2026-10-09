/**
 * Calendar writes for Mira and the MCP server: open slots, create / update /
 * cancel events with invites, on whichever of the executive's connected
 * Google accounts they choose.
 *
 * Every busy check runs across EVERY connected account and every calendar
 * in it, so Mira never double-books someone who keeps a work calendar on one
 * Google account and a board calendar on another.
 *
 * Scopes: the Google connect in lib/google.ts already asks for
 * calendar.events (write) + calendar.readonly + calendar.freebusy. A token
 * granted before calendar.events was added answers 403 — we surface that as
 * `reconnect_needed` so Mira can say "reconnect your calendar on the
 * Calendar page to let me create events".
 */

import { getGoogleAccessToken, listConnectedGoogleAccounts, type ConnectedAccount } from '@/lib/google'

const CAL = 'https://www.googleapis.com/calendar/v3'

export type WritableCalendar = {
  accountId: string
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

async function gfetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 403) {
    const text = await res.text().catch(() => '')
    if (/insufficient|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) fail('reconnect_needed')
    console.error('[cxoCalendar] 403', url, text)
    fail('google_error')
  }
  return res
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

type CalListItem = { id: string; summary: string; primary?: boolean; accessRole: string; hidden?: boolean }

async function calendarsOf(repId: string, a: ConnectedAccount, token: string): Promise<CalListItem[]> {
  const res = await gfetch(token, `${CAL}/users/me/calendarList?minAccessRole=reader&showHidden=false`)
  if (!res.ok) return [{ id: 'primary', summary: a.email ?? 'Primary', primary: true, accessRole: 'owner' }]
  const json = (await res.json()) as { items?: CalListItem[] }
  return (json.items ?? []).filter((c) => c.accessRole !== 'none')
}

/** Every calendar the executive can write to, across every connected account. */
export async function listWritableCalendars(repId: string, memberId: string | null): Promise<WritableCalendar[]> {
  const accounts = await listConnectedGoogleAccounts(repId)
  const mine = accounts.filter((a) => a.memberId === memberId)
  const ordered = [...mine, ...accounts.filter((a) => a.memberId !== memberId)]
  const out: WritableCalendar[] = []
  for (const a of ordered) {
    const token = await getGoogleAccessToken(repId, a.memberId, a.accountId)
    if (!token) continue
    const cals = await calendarsOf(repId, a, token).catch(() => [] as CalListItem[])
    for (const c of cals) {
      if (!['owner', 'writer'].includes(c.accessRole)) continue
      out.push({ accountId: a.accountId, accountEmail: a.email, accountLabel: a.label, calendarId: c.id, name: c.summary, primary: Boolean(c.primary) })
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
): Promise<{ calendar: WritableCalendar | null; choices: WritableCalendar[]; ambiguous: boolean }> {
  const all = await listWritableCalendars(repId, memberId)
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
  // Own account's primary first (listWritableCalendars orders it first).
  return { calendar: primaries[0] ?? all[0], choices: all, ambiguous: false }
}

// ── Busy across everything ──────────────────────────────────────────────────

export type Busy = { startIso: string; endIso: string; calendar: string }

export async function busyAcrossAll(repId: string, fromIso: string, toIso: string): Promise<Busy[]> {
  const accounts = await listConnectedGoogleAccounts(repId)
  const busy: Busy[] = []
  for (const a of accounts) {
    const token = await getGoogleAccessToken(repId, a.memberId, a.accountId)
    if (!token) continue
    const cals = await calendarsOf(repId, a, token).catch(() => [{ id: 'primary', summary: 'Primary', accessRole: 'owner' } as CalListItem])
    const res = await fetch(`${CAL}/freeBusy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, items: cals.slice(0, 50).map((c) => ({ id: c.id })) }),
    })
    if (!res.ok) continue
    const json = (await res.json()) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }
    for (const [id, v] of Object.entries(json.calendars ?? {})) {
      const name = cals.find((c) => c.id === id)?.summary ?? id
      for (const b of v.busy ?? []) busy.push({ startIso: b.start, endIso: b.end, calendar: `${name} (${a.email ?? a.label})` })
    }
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

/** Hour-of-day (0–23, fractional) of an instant in a timezone. */
function localHour(ms: number, tz: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' }).formatToParts(new Date(ms))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Mon')
  return { hour: h + m / 60, weekday: wd }
}

export type OpenSlot = { startIso: string; endIso: string; label: string }

export async function findOpenSlots(
  repId: string,
  opts: { fromIso: string; toIso: string; durationMin: number; tz: string; startHour?: number; endHour?: number; count?: number; weekdaysOnly?: boolean },
): Promise<{ slots: OpenSlot[]; checkedCalendars: number; busy: Busy[] }> {
  const accounts = await listConnectedGoogleAccounts(repId)
  if (accounts.length === 0) fail('not_connected')
  const busy = await busyAcrossAll(repId, opts.fromIso, opts.toIso)
  const dur = Math.max(15, opts.durationMin) * 60_000
  const step = 30 * 60_000
  const startHour = opts.startHour ?? 9
  const endHour = opts.endHour ?? 17
  const count = Math.min(Math.max(opts.count ?? 5, 1), 12)
  const end = new Date(opts.toIso).getTime()
  let cursor = Math.max(new Date(opts.fromIso).getTime(), Date.now() + 10 * 60_000)
  cursor += (step - (cursor % step)) % step
  const slots: OpenSlot[] = []
  while (cursor + dur <= end && slots.length < count) {
    const { hour, weekday } = localHour(cursor, opts.tz)
    const endLocal = localHour(cursor + dur, opts.tz).hour || 24
    const inHours = hour >= startHour && endLocal <= endHour && endLocal >= hour
    const okDay = opts.weekdaysOnly === false ? true : weekday >= 1 && weekday <= 5
    const s = new Date(cursor).toISOString()
    const e = new Date(cursor + dur).toISOString()
    if (inHours && okDay && !conflictIn(busy, s, e)) slots.push({ startIso: s, endIso: e, label: fmtInTz(s, opts.tz) })
    cursor += step
  }
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
): Promise<EventResult> {
  const pick = await chooseCalendar(repId, memberId, input.calendar)
  if (!pick.calendar) fail('not_connected')
  if (pick.ambiguous) throw new CalendarWriteError('google_error', `Which calendar? ${pick.choices.map((c) => `${c.name} (${c.accountEmail ?? c.accountLabel})`).join(', ')}`)
  const cal = pick.calendar
  if (!input.allowConflict) {
    const busy = await busyAcrossAll(repId, input.startIso, input.endIso)
    const hit = conflictIn(busy, input.startIso, input.endIso)
    if (hit) throw new CalendarWriteError('google_error', `That overlaps ${hit.calendar} from ${fmtInTz(hit.startIso, input.tz)} to ${fmtInTz(hit.endIso, input.tz)}. Pick another time.`)
  }
  const account = (await listConnectedGoogleAccounts(repId)).find((a) => a.accountId === cal.accountId)
  const token = account ? await getGoogleAccessToken(repId, account.memberId, account.accountId) : null
  if (!token) fail('not_connected')
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? '',
    location: input.location ?? undefined,
    start: { dateTime: input.startIso, timeZone: input.tz },
    end: { dateTime: input.endIso, timeZone: input.tz },
    attendees: input.attendees,
  }
  if (input.addMeet) {
    body.conferenceData = { createRequest: { requestId: `cxo-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  const url = `${CAL}/calendars/${encodeURIComponent(cal.calendarId)}/events?sendUpdates=all&conferenceDataVersion=1`
  const res = await gfetch(token, url, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    console.error('[cxoCalendar] create failed', res.status, await res.text().catch(() => ''))
    fail('google_error')
  }
  const json = (await res.json()) as { id: string; htmlLink: string; hangoutLink?: string }
  return { id: json.id, htmlLink: json.htmlLink, meetLink: json.hangoutLink ?? null, calendar: cal, startIso: input.startIso, endIso: input.endIso }
}

async function locateEvent(repId: string, memberId: string | null, eventId: string): Promise<{ cal: WritableCalendar; token: string } | null> {
  const cals = await listWritableCalendars(repId, memberId)
  const accounts = await listConnectedGoogleAccounts(repId)
  for (const cal of cals) {
    const a = accounts.find((x) => x.accountId === cal.accountId)
    const token = a ? await getGoogleAccessToken(repId, a.memberId, a.accountId) : null
    if (!token) continue
    const res = await fetch(`${CAL}/calendars/${encodeURIComponent(cal.calendarId)}/events/${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const j = (await res.json()) as { status?: string }
      if (j.status !== 'cancelled') return { cal, token }
    }
  }
  return null
}

export async function updateEventWithNotice(
  repId: string,
  memberId: string | null,
  eventId: string,
  patch: { title?: string; description?: string; location?: string; startIso?: string; endIso?: string; tz: string; addAttendees?: string[] },
): Promise<{ id: string; htmlLink: string; calendar: WritableCalendar }> {
  const found = await locateEvent(repId, memberId, eventId)
  if (!found) throw new CalendarWriteError('google_error', 'I could not find that event on any connected calendar.')
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.summary = patch.title
  if (patch.description !== undefined) body.description = patch.description
  if (patch.location !== undefined) body.location = patch.location
  if (patch.startIso) body.start = { dateTime: patch.startIso, timeZone: patch.tz }
  if (patch.endIso) body.end = { dateTime: patch.endIso, timeZone: patch.tz }
  if (patch.addAttendees?.length) {
    const cur = await fetch(`${CAL}/calendars/${encodeURIComponent(found.cal.calendarId)}/events/${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${found.token}` } })
    const j = cur.ok ? ((await cur.json()) as { attendees?: Array<{ email: string }> }) : {}
    const have = new Set((j.attendees ?? []).map((a) => a.email.toLowerCase()))
    body.attendees = [...(j.attendees ?? []), ...patch.addAttendees.filter((e) => !have.has(e.toLowerCase())).map((email) => ({ email }))]
  }
  if (patch.startIso && patch.endIso) {
    // The event being moved is itself "busy" at its old time; ignore that block.
    const cur = await fetch(`${CAL}/calendars/${encodeURIComponent(found.cal.calendarId)}/events/${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${found.token}` } })
    const j = cur.ok ? ((await cur.json()) as { start?: { dateTime?: string }; end?: { dateTime?: string } }) : {}
    const oldS = j.start?.dateTime ? new Date(j.start.dateTime).getTime() : null
    const oldE = j.end?.dateTime ? new Date(j.end.dateTime).getTime() : null
    const busy = (await busyAcrossAll(repId, patch.startIso, patch.endIso)).filter(
      (b) => !(oldS !== null && oldE !== null && new Date(b.startIso).getTime() === oldS && new Date(b.endIso).getTime() === oldE),
    )
    const hit = conflictIn(busy, patch.startIso, patch.endIso)
    if (hit) throw new CalendarWriteError('google_error', `That overlaps ${hit.calendar} at ${fmtInTz(hit.startIso, patch.tz)}. Pick another time.`)
  }
  const res = await gfetch(found.token, `${CAL}/calendars/${encodeURIComponent(found.cal.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    console.error('[cxoCalendar] patch failed', res.status, await res.text().catch(() => ''))
    fail('google_error')
  }
  const json = (await res.json()) as { id: string; htmlLink: string }
  return { id: json.id, htmlLink: json.htmlLink, calendar: found.cal }
}

export async function cancelEventWithNotice(repId: string, memberId: string | null, eventId: string): Promise<{ ok: true; calendar: WritableCalendar }> {
  const found = await locateEvent(repId, memberId, eventId)
  if (!found) throw new CalendarWriteError('google_error', 'I could not find that event on any connected calendar.')
  const res = await gfetch(found.token, `${CAL}/calendars/${encodeURIComponent(found.cal.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error('[cxoCalendar] delete failed', res.status, await res.text().catch(() => ''))
    fail('google_error')
  }
  return { ok: true, calendar: found.cal }
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
