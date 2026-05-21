// Minimal Google OAuth + Calendar + Sheets client — no SDK, just fetch.
// Scopes: calendar.events + calendar.freebusy + spreadsheets (read/write the
// rep's chosen Google Sheet CRM by ID).

import { supabase } from '@/lib/supabase'

const OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token'
const CAL_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const CAL_FREEBUSY = 'https://www.googleapis.com/calendar/v3/freeBusy'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    ''
  )
}

export const GOOGLE_SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  // calendar.readonly lets us enumerate the rep's calendar list so we
  // FreeBusy-check every calendar (primary + subscribed/shared) when
  // proposing meeting times. Without this we miss conflicts on shared
  // calendars (Spencer's "East Coast Pinnacle Core", "Health & Wellness
  // Daily", etc. live on secondary calendars).
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  // drive.file = least-privilege Drive access: only files the app creates or
  // opens. Used by the Plaud agent to generate Docs and place them in
  // per-rep folders.
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
].join(' ')

export function googleOauthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      redirectUri(),
  )
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${OAUTH_AUTHORIZE}?${p.toString()}`
}

type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  })
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: 'refresh_token',
  })
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

export type GoogleTokens = {
  rep_id: string
  member_id: string | null
  access_token: string
  refresh_token: string | null
  expires_at: string // ISO
  email: string | null
  scope: string | null
}

export type CalendarTarget = { memberId?: string | null }

/**
 * Save Google tokens. memberId=null means tenant-level (legacy / individual
 * tier). memberId=<uuid> means per-member (enterprise rep with their own
 * calendar). Each (rep_id, member_id) pair gets exactly one row, enforced by
 * partial unique indexes in the schema.
 */
export async function saveTokens(input: {
  repId: string
  memberId?: string | null
  accessToken: string
  refreshToken: string | null
  expiresInSec: number
  email?: string | null
  scope?: string | null
}): Promise<void> {
  const expiresAt = new Date(Date.now() + input.expiresInSec * 1000).toISOString()
  const memberId = input.memberId ?? null
  // Upsert — keep existing refresh_token if Google doesn't return a new one.
  const existing = await getStoredTokens(input.repId, memberId)
  const refresh_token = input.refreshToken ?? existing?.refresh_token ?? null

  const row: Record<string, unknown> = {
    rep_id: input.repId,
    member_id: memberId,
    access_token: input.accessToken,
    refresh_token,
    expires_at: expiresAt,
    email: input.email ?? existing?.email ?? null,
    scope: input.scope ?? existing?.scope ?? null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await supabase.from('google_tokens').update(row).eq('id', (existing as GoogleTokens & { id: string }).id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('google_tokens').insert(row)
    if (error) throw error
  }
}

/**
 * Internal: read the exact row keyed by (rep_id, member_id). No fallback.
 */
async function getStoredTokens(
  repId: string,
  memberId: string | null,
): Promise<GoogleTokens | null> {
  let q = supabase.from('google_tokens').select('*').eq('rep_id', repId)
  q = memberId === null ? q.is('member_id', null) : q.eq('member_id', memberId)
  const { data } = await q.maybeSingle()
  return (data as GoogleTokens | null) ?? null
}

/**
 * Resolve tokens for a calendar caller. Prefers per-member tokens when
 * memberId is given; falls back to the tenant-level row so individual-tier
 * accounts and crons that don't have a member context keep working.
 */
export async function getTokensFor(
  repId: string,
  memberId?: string | null,
): Promise<GoogleTokens | null> {
  if (memberId) {
    const member = await getStoredTokens(repId, memberId)
    if (member) return member
  }
  return getStoredTokens(repId, null)
}

/**
 * Tenant-level token only (for callers that explicitly want the account-wide
 * connection — e.g. legacy callers, sheet CRM mirror, or "is anyone from
 * this tenant connected?" checks).
 */
export async function getTokensForRep(repId: string): Promise<GoogleTokens | null> {
  return getStoredTokens(repId, null)
}

/**
 * Tenant-level + per-member rollup. Useful for "did this specific member
 * connect their own calendar yet?" checks (no fallback).
 */
export async function getTokensForMember(
  repId: string,
  memberId: string,
): Promise<GoogleTokens | null> {
  return getStoredTokens(repId, memberId)
}

/**
 * Disconnect. Defaults to tenant-level for backward compat. Pass memberId to
 * disconnect a specific member's calendar without touching the tenant row.
 */
export async function disconnectRep(
  repId: string,
  opts: CalendarTarget = {},
): Promise<void> {
  const memberId = opts.memberId ?? null
  let q = supabase.from('google_tokens').delete().eq('rep_id', repId)
  q = memberId === null ? q.is('member_id', null) : q.eq('member_id', memberId)
  await q
}

async function getValidAccessToken(
  repId: string,
  memberId?: string | null,
): Promise<string | null> {
  const t = await getTokensFor(repId, memberId ?? null)
  if (!t) return null
  const expiresAt = new Date(t.expires_at).getTime()
  // Refresh if expiring within 60s.
  if (Date.now() + 60_000 < expiresAt) return t.access_token
  if (!t.refresh_token) return null
  const refreshed = await refreshAccessToken(t.refresh_token)
  await saveTokens({
    repId,
    memberId: t.member_id, // refresh against the same row we just read
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? null,
    expiresInSec: refreshed.expires_in,
    scope: refreshed.scope ?? null,
  })
  return refreshed.access_token
}

export type CreateEventInput = {
  repId: string
  memberId?: string | null
  summary: string
  description?: string
  startIso: string // e.g. 2026-05-02T09:00:00-05:00 or date-only
  endIso?: string
  timezone?: string // e.g. 'America/New_York'
  allDay?: boolean
  attendees?: Array<{ email: string; displayName?: string }>
}

/**
 * Creates a Google Calendar event on the caller's primary calendar.
 * Returns the event URL (htmlLink) on success, or null if no calendar is
 * connected / token refresh fails — callers should treat this as best-effort.
 *
 * Pass input.memberId to write to that member's connected calendar; omit it
 * to write to the tenant-level calendar (individual tier / shared mailbox).
 */
export async function createCalendarEvent(
  input: CreateEventInput,
): Promise<{ htmlLink: string; id: string } | null> {
  const token = await getValidAccessToken(input.repId, input.memberId ?? null)
  if (!token) return null

  const tz = input.timezone ?? 'UTC'
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? '',
  }

  if (input.allDay) {
    // Google expects YYYY-MM-DD in `date` for all-day.
    const date = input.startIso.slice(0, 10)
    const endDate = (input.endIso ?? input.startIso).slice(0, 10)
    // endDate is exclusive in Google all-day events.
    const d = new Date(endDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    body.start = { date }
    body.end = { date: d.toISOString().slice(0, 10) }
  } else {
    const start = input.startIso
    const endIso =
      input.endIso ??
      new Date(new Date(start).getTime() + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    body.start = { dateTime: start, timeZone: tz }
    body.end = { dateTime: endIso, timeZone: tz }
  }

  if (input.attendees && input.attendees.length > 0) {
    body.attendees = input.attendees
  }

  const res = await fetch(CAL_EVENTS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error('[google] createCalendarEvent failed', res.status, text)
    return null
  }
  const json = (await res.json()) as { id: string; htmlLink: string }
  return { id: json.id, htmlLink: json.htmlLink }
}

export type GoogleCalEvent = {
  id: string
  summary: string
  start: string // ISO
  end: string // ISO
  htmlLink: string
  location?: string // free-text location, often contains a Zoom/Teams join URL
  conferenceLink?: string // Google Meet URL (hangoutLink) or first conferenceData entry point
  eventType?: string // 'default' | 'focusTime' | 'outOfOffice' | 'workingLocation'
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>
}

/**
 * List upcoming events on the caller's primary calendar in a window.
 * Pass opts.memberId for per-member calendar; omit for tenant-level.
 * Returns null if no calendar is connected.
 */
export async function listUpcomingEvents(
  repId: string,
  opts: {
    fromIso?: string
    toIso?: string
    maxResults?: number
    timeZone?: string
    memberId?: string | null
  } = {},
): Promise<GoogleCalEvent[] | null> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return null

  const fromIso = opts.fromIso ?? new Date().toISOString()
  const toIso =
    opts.toIso ??
    new Date(Date.now() + 7 * 86400_000).toISOString()
  const maxResults = String(opts.maxResults ?? 20)

  const params = new URLSearchParams({
    timeMin: fromIso,
    timeMax: toIso,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults,
  })
  // Tell Google to expand recurring/floating events in the rep's local TZ so
  // an "8–9:30am ET" meeting doesn't get returned as a UTC slot that we then
  // mis-format on our end.
  if (opts.timeZone) params.set('timeZone', opts.timeZone)
  const res = await fetch(`${CAL_EVENTS}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[google] listUpcomingEvents failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as {
    items?: Array<{
      id: string
      summary?: string
      htmlLink?: string
      location?: string
      hangoutLink?: string
      conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> }
      eventType?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>
    }>
  }
  const items = json.items ?? []
  return items.map((e) => {
    const conferenceLink =
      e.hangoutLink ??
      e.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri ??
      e.conferenceData?.entryPoints?.[0]?.uri
    return {
      id: e.id,
      summary: e.summary ?? '(no title)',
      start: e.start?.dateTime ?? e.start?.date ?? '',
      end: e.end?.dateTime ?? e.end?.date ?? '',
      htmlLink: e.htmlLink ?? '',
      location: e.location,
      conferenceLink,
      eventType: e.eventType,
      attendees: (e.attendees ?? [])
        .filter((a) => a.email)
        .map((a) => ({
          email: a.email!,
          displayName: a.displayName,
          responseStatus: a.responseStatus,
        })),
    }
  })
}

export type BusySlot = { startIso: string; endIso: string }

/**
 * List every calendar in the rep's CalendarList — primary, subscribed,
 * shared, and otherwise. Requires the calendar.readonly scope; returns
 * null with a logged 403 if the rep hasn't re-consented yet. Callers
 * should fall back to primary-only in that case.
 *
 * Filters out hidden calendars (rep explicitly removed them from the
 * sidebar) and ones we'd lose access to (accessRole === 'none').
 */
export async function listCalendarIds(
  repId: string,
  opts: CalendarTarget = {},
): Promise<string[] | null> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return null

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    if (res.status === 403) {
      console.warn('[google] listCalendarIds 403 — calendar.readonly scope not granted yet; falling back to primary')
    } else {
      console.error('[google] listCalendarIds failed', res.status, await res.text())
    }
    return null
  }
  const json = (await res.json()) as {
    items?: Array<{ id: string; hidden?: boolean; selected?: boolean; accessRole?: string }>
  }
  const ids = (json.items ?? [])
    .filter((c) => c.id && !c.hidden && c.accessRole !== 'none')
    .map((c) => c.id)
  return ids.length > 0 ? ids : ['primary']
}

/**
 * Returns busy slots across ALL of the rep's calendars (primary +
 * subscribed/shared) between two ISO times. Pass opts.memberId for
 * per-member; omit for tenant-level.
 *
 * Falls back to primary-only when calendar.readonly isn't granted yet so
 * a missing scope degrades gracefully instead of failing. Returns null
 * only if no calendar is connected at all.
 */
export async function getBusySlots(
  repId: string,
  fromIso: string,
  toIso: string,
  opts: CalendarTarget = {},
): Promise<BusySlot[] | null> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return null

  // Try to enumerate every calendar; fall back to primary-only if the
  // scope isn't granted.
  const ids = (await listCalendarIds(repId, opts)) ?? ['primary']
  // FreeBusy supports up to ~50 calendars per request; we're never near
  // that, but cap defensively.
  const items = ids.slice(0, 50).map((id) => ({ id }))

  const res = await fetch(CAL_FREEBUSY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: fromIso,
      timeMax: toIso,
      items,
    }),
  })
  if (!res.ok) {
    console.error('[google] getBusySlots failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason: string }> }>
  }
  // Union busy slots from every calendar that returned without errors.
  // Log per-calendar errors so a silently-skipped subscribed calendar
  // (permission revoked, sharing changed, etc.) shows up in worker logs
  // and we can tell when availability data is partial.
  const all: BusySlot[] = []
  const skipped: Array<{ calendarId: string; reason: string }> = []
  for (const [calendarId, cal] of Object.entries(json.calendars ?? {})) {
    if (cal.errors && cal.errors.length > 0) {
      skipped.push({ calendarId, reason: cal.errors.map((e) => e.reason).join(',') })
      continue
    }
    for (const b of cal.busy ?? []) {
      all.push({ startIso: b.start, endIso: b.end })
    }
  }
  if (skipped.length > 0) {
    console.warn(
      `[google] getBusySlots: ${skipped.length}/${Object.keys(json.calendars ?? {}).length} calendars errored —`,
      skipped,
    )
  }
  return all
}

/**
 * Find up to `count` mutually-free slots inside a window, walking the
 * calendar in 30-minute steps and skipping anything that overlaps a busy
 * slot or falls outside business hours (Mon–Fri, 9am–5pm in `tz` by
 * default). Returns null if the calendar isn't connected.
 *
 * Today this only consults the tenant's primary calendar (one Google
 * connection per account). When per-member Google connections ship, this
 * helper can take an array of repIds and AND their busy slots together.
 */
export async function findFreeSlots(
  repId: string,
  opts: {
    fromIso: string
    toIso: string
    durationMinutes: number
    count?: number
    tz?: string
    businessStartHour?: number // local hour, 24h
    businessEndHour?: number
    memberId?: string | null
  },
): Promise<BusySlot[] | null> {
  const busy = await getBusySlots(repId, opts.fromIso, opts.toIso, { memberId: opts.memberId ?? null })
  if (busy === null) return null

  const tz = opts.tz || 'UTC'
  const startHour = opts.businessStartHour ?? 9
  const endHour = opts.businessEndHour ?? 17
  const count = opts.count ?? 3
  const step = 30 * 60_000
  const dur = opts.durationMinutes * 60_000

  // Round `from` up to the next half-hour boundary (and at least 5 min in
  // the future so we never propose a slot that's already starting).
  const minStart = Date.now() + 5 * 60_000
  let cursor = Math.max(new Date(opts.fromIso).getTime(), minStart)
  const remainder = cursor % step
  if (remainder !== 0) cursor += step - remainder
  const end = new Date(opts.toIso).getTime()

  const busyMs = busy.map((b) => ({
    s: new Date(b.startIso).getTime(),
    e: new Date(b.endIso).getTime(),
  }))

  // Local hour:minute + weekday helper (uses Intl.DateTimeFormat).
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const localParts = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms))
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    const wd = get('weekday') // 'Mon','Tue',...
    const hh = parseInt(get('hour') || '0', 10)
    const mm = parseInt(get('minute') || '0', 10)
    return { wd, minutesOfDay: hh * 60 + mm }
  }

  const slots: BusySlot[] = []
  let safety = 0
  while (cursor + dur <= end && slots.length < count && safety < 5000) {
    safety++
    const slotStart = cursor
    const slotEnd = cursor + dur
    const ps = localParts(slotStart)
    const pe = localParts(slotEnd - 1)

    const isWeekday = ps.wd !== 'Sat' && ps.wd !== 'Sun'
    const inHoursStart = ps.minutesOfDay >= startHour * 60
    const inHoursEnd = pe.minutesOfDay <= endHour * 60 && pe.wd === ps.wd
    const fitsBusinessHours = isWeekday && inHoursStart && inHoursEnd

    if (!fitsBusinessHours) {
      cursor += step
      continue
    }
    const overlap = busyMs.some((b) => b.s < slotEnd && b.e > slotStart)
    if (overlap) {
      cursor += step
      continue
    }
    slots.push({
      startIso: new Date(slotStart).toISOString(),
      endIso: new Date(slotEnd).toISOString(),
    })
    // Space proposals out so the rep gets variety, not three back-to-back.
    cursor += Math.max(dur, 90 * 60_000)
  }

  return slots
}

/**
 * Convenience: any conflict with [startIso, endIso)?
 * Returns the first overlapping busy slot, or null.
 * Returns null if not connected (caller decides whether to warn).
 */
export async function findConflict(
  repId: string,
  startIso: string,
  endIso: string,
  opts: CalendarTarget = {},
): Promise<BusySlot | null> {
  const busy = await getBusySlots(repId, startIso, endIso, opts)
  if (!busy || busy.length === 0) return null
  const s = new Date(startIso).getTime()
  const e = new Date(endIso).getTime()
  for (const b of busy) {
    const bs = new Date(b.startIso).getTime()
    const be = new Date(b.endIso).getTime()
    if (bs < e && be > s) return b
  }
  return null
}

/**
 * Search the rep's primary calendar for events matching a free-text query
 * (Google's `q` param matches against summary, description, attendee names
 * and emails). Defaults to the next 60 days. Returns null if not connected.
 */
export async function findCalendarEventsByQuery(
  repId: string,
  query: string,
  opts: {
    fromIso?: string
    toIso?: string
    maxResults?: number
    memberId?: string | null
  } = {},
): Promise<GoogleCalEvent[] | null> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return null
  const fromIso = opts.fromIso ?? new Date().toISOString()
  const toIso =
    opts.toIso ?? new Date(Date.now() + 60 * 86400_000).toISOString()
  const params = new URLSearchParams({
    timeMin: fromIso,
    timeMax: toIso,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.maxResults ?? 10),
    q: query,
  })
  const res = await fetch(`${CAL_EVENTS}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[google] findCalendarEventsByQuery failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as {
    items?: Array<{
      id: string
      summary?: string
      htmlLink?: string
      eventType?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>
    }>
  }
  const items = json.items ?? []
  return items.map((e) => ({
    id: e.id,
    summary: e.summary ?? '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    htmlLink: e.htmlLink ?? '',
    eventType: e.eventType,
    attendees: (e.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({
        email: a.email!,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      })),
  }))
}

/**
 * Patch an event (typically to move start/end). Returns null on failure.
 */
export async function patchCalendarEvent(
  repId: string,
  eventId: string,
  patch: {
    startIso?: string
    endIso?: string
    timezone?: string
    summary?: string
    description?: string
    memberId?: string | null
  },
): Promise<{ id: string; htmlLink: string } | null> {
  const token = await getValidAccessToken(repId, patch.memberId ?? null)
  if (!token) return null
  const tz = patch.timezone ?? 'UTC'
  const body: Record<string, unknown> = {}
  if (patch.summary !== undefined) body.summary = patch.summary
  if (patch.description !== undefined) body.description = patch.description
  if (patch.startIso) body.start = { dateTime: patch.startIso, timeZone: tz }
  if (patch.endIso) body.end = { dateTime: patch.endIso, timeZone: tz }
  const res = await fetch(`${CAL_EVENTS}/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('[google] patchCalendarEvent failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as { id: string; htmlLink: string }
  return { id: json.id, htmlLink: json.htmlLink }
}

/**
 * Delete an event. Returns true on success / already-gone.
 */
export async function deleteCalendarEvent(
  repId: string,
  eventId: string,
  opts: CalendarTarget = {},
): Promise<boolean> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return false
  const res = await fetch(`${CAL_EVENTS}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok || res.status === 410 || res.status === 404) return true
  console.error('[google] deleteCalendarEvent failed', res.status, await res.text())
  return false
}

// ── Google Sheets ─────────────────────────────────────────────────────────
// The rep links one Google Sheet as their "external CRM". We store the sheet
// id, tab name, and a header→column map in `reps.integrations.google_sheet`
// (no schema migration needed — `integrations` is jsonb).

export type SheetCrmConfig = {
  spreadsheet_id: string
  tab_name: string // e.g. 'Leads'
  // 1-indexed row of the header. Defaults to 1.
  header_row?: number
  // Column letter (A..ZZ) used as the unique key for upsert. Usually 'email' or 'name'.
  key_header?: string // header name, e.g. 'email'
}

/**
 * Parse a Google Sheets URL or raw ID. Accepts:
 *   https://docs.google.com/spreadsheets/d/<id>/edit#gid=0
 *   <id>
 */
export function parseSheetId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

async function sheetsFetch(
  repId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  const token = await getValidAccessToken(repId)
  if (!token) return null
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  return fetch(`${SHEETS_API}${path}`, { ...init, headers })
}

export async function getSheetMeta(
  repId: string,
  spreadsheetId: string,
): Promise<{ title: string; tabs: string[] } | null> {
  const res = await sheetsFetch(
    repId,
    `/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
  )
  if (!res || !res.ok) {
    if (res) console.error('[google sheets] meta failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as {
    properties?: { title?: string }
    sheets?: Array<{ properties?: { title?: string } }>
  }
  return {
    title: json.properties?.title ?? '',
    tabs: (json.sheets ?? [])
      .map((s) => s.properties?.title ?? '')
      .filter(Boolean),
  }
}

/**
 * Read a range from the linked sheet. Returns rows as 2D array of strings.
 * Range example: 'Leads!A1:Z200'.
 */
export async function readSheetRange(
  repId: string,
  spreadsheetId: string,
  range: string,
): Promise<string[][] | null> {
  const res = await sheetsFetch(
    repId,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  )
  if (!res || !res.ok) {
    if (res) console.error('[google sheets] read failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as { values?: string[][] }
  return json.values ?? []
}

export async function appendSheetRow(
  repId: string,
  spreadsheetId: string,
  tabName: string,
  values: (string | number | null)[],
): Promise<boolean> {
  const range = `${tabName}!A1`
  const res = await sheetsFetch(
    repId,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range,
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: [values.map((v) => (v == null ? '' : v))] }),
    },
  )
  if (!res || !res.ok) {
    if (res) console.error('[google sheets] append failed', res.status, await res.text())
    return false
  }
  return true
}

export async function updateSheetRange(
  repId: string,
  spreadsheetId: string,
  range: string,
  values: (string | number | null)[][],
): Promise<boolean> {
  const res = await sheetsFetch(
    repId,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range,
    )}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: values.map((row) => row.map((v) => (v == null ? '' : v))),
      }),
    },
  )
  if (!res || !res.ok) {
    if (res) console.error('[google sheets] update failed', res.status, await res.text())
    return false
  }
  return true
}

function colLetter(idxZeroBased: number): string {
  let n = idxZeroBased
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

// Canonical CRM fields → the header aliases we'll accept in the rep's sheet.
// All comparisons are lowercased + whitespace-collapsed.
const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'contact', 'contact name', 'lead', 'lead name', 'prospect', 'prospect name'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  company: ['company', 'company name', 'organization', 'organisation', 'org', 'account', 'business'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'tel'],
  status: ['status', 'stage', 'pipeline stage', 'lead status', 'temperature'],
  notes: ['notes', 'note', 'comments', 'description', 'details', 'context'],
  source: ['source', 'lead source', 'channel', 'origin'],
  last_contact: ['last contact', 'last contacted', 'last contacted date', 'last touch', 'last activity'],
  created_at: ['created at', 'created', 'date added', 'added', 'created date', 'date'],
  updated_at: ['updated at', 'updated', 'last updated', 'modified'],
  next_step: ['next step', 'next action', 'follow up', 'follow-up'],
}

// Reverse: every alias → canonical field name.
const ALIAS_TO_FIELD: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) m[a.toLowerCase().replace(/\s+/g, ' ').trim()] = field
  }
  return m
})()

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Map a header label to its canonical field name (or null if unknown). */
export function canonicalFieldForHeader(header: string): string | null {
  return ALIAS_TO_FIELD[normalizeHeader(header)] ?? null
}

/**
 * Resolve a value for a sheet header from a fields object keyed on canonical
 * field names. Matches by alias; falls back to literal header match.
 */
function resolveValueForHeader(
  header: string,
  fields: Record<string, string | number | null | undefined>,
): string | number | null | undefined {
  const canon = canonicalFieldForHeader(header)
  if (canon && fields[canon] !== undefined) return fields[canon]
  // Literal fallbacks
  if (fields[header] !== undefined) return fields[header]
  if (fields[header.toLowerCase()] !== undefined) return fields[header.toLowerCase()]
  return undefined
}

/**
 * Default header set we seed into an empty linked sheet so the rep doesn't
 * have to think about columns. Order matters — first column is the most
 * "human readable", key column is `email`.
 */
export const DEFAULT_SHEET_HEADERS = [
  'name',
  'email',
  'company',
  'phone',
  'status',
  'notes',
  'source',
  'last_contact',
  'created_at',
  'updated_at',
] as const

/**
 * If the linked sheet's header row is empty, write our default headers.
 * Returns true if seeded, false if headers already exist or write failed.
 */
export async function ensureSheetHeaders(
  repId: string,
  cfg: SheetCrmConfig,
): Promise<boolean> {
  const headerRow = cfg.header_row ?? 1
  const tab = cfg.tab_name || 'Sheet1'
  const range = `${tab}!A${headerRow}:ZZ${headerRow}`
  const rows = await readSheetRange(repId, cfg.spreadsheet_id, range)
  if (rows === null) return false
  const existing = (rows[0] ?? []).filter((h) => String(h).trim() !== '')
  if (existing.length > 0) return false
  const ok = await updateSheetRange(repId, cfg.spreadsheet_id, range, [
    [...DEFAULT_SHEET_HEADERS],
  ])
  return ok
}

/**
 * Upsert a row in the rep's linked sheet, keyed off `keyHeader` (e.g. "email"
 * or "name"). If a row already has a matching value (case-insensitive) in
 * that column, the matching cells are updated; otherwise a new row is
 * appended. `fields` is keyed on canonical names (`name`, `email`, …) — we
 * map them onto whatever headers the rep actually has via FIELD_ALIASES.
 *
 * Update semantics: only non-empty incoming values overwrite existing cells,
 * so a partial update (e.g. "mark hot") doesn't blank out unrelated columns.
 *
 * Returns 'updated' | 'appended' | null on failure.
 */
export async function upsertSheetRow(
  repId: string,
  cfg: SheetCrmConfig,
  fields: Record<string, string | number | null | undefined>,
): Promise<'updated' | 'appended' | null> {
  const headerRow = cfg.header_row ?? 1
  const tab = cfg.tab_name || 'Sheet1'
  const headerRange = `${tab}!A${headerRow}:ZZ${headerRow}`
  const headerRows = await readSheetRange(repId, cfg.spreadsheet_id, headerRange)
  if (!headerRows) return null
  const headers = (headerRows[0] ?? []).map((h) => String(h).trim())
  if (headers.length === 0) return null

  // Locate the key column: explicit cfg.key_header → canonical match → fallback to first column.
  const keyHeaderCfg = (cfg.key_header ?? '').trim()
  let keyIdx = -1
  if (keyHeaderCfg) {
    const targetCanon = canonicalFieldForHeader(keyHeaderCfg) ?? keyHeaderCfg.toLowerCase()
    keyIdx = headers.findIndex((h) => {
      const c = canonicalFieldForHeader(h)
      return (c && c === targetCanon) || h.toLowerCase() === keyHeaderCfg.toLowerCase()
    })
  }
  if (keyIdx < 0) keyIdx = 0
  const keyHeader = headers[keyIdx]
  const keyValueRaw = resolveValueForHeader(keyHeader, fields)
  const keyValue = String(keyValueRaw ?? '').trim().toLowerCase()
  if (!keyValue) return null

  // Read the key column to find an existing row.
  const keyCol = colLetter(keyIdx)
  const dataStart = headerRow + 1
  const keyColRange = `${tab}!${keyCol}${dataStart}:${keyCol}`
  const keyRows = await readSheetRange(repId, cfg.spreadsheet_id, keyColRange)
  if (keyRows === null) return null
  let foundRow = -1 // 0-indexed within keyRows
  for (let i = 0; i < keyRows.length; i++) {
    const cell = String(keyRows[i]?.[0] ?? '').trim().toLowerCase()
    if (cell && cell === keyValue) {
      foundRow = i
      break
    }
  }

  if (foundRow >= 0) {
    // Update existing row: only overwrite cells we actually have values for.
    const sheetRow = dataStart + foundRow
    const fullRowRange = `${tab}!A${sheetRow}:${colLetter(headers.length - 1)}${sheetRow}`
    const existingRows = await readSheetRange(repId, cfg.spreadsheet_id, fullRowRange)
    const existing = (existingRows?.[0] ?? []) as (string | undefined)[]
    const merged: (string | number | null)[] = headers.map((h, idx) => {
      const incoming = resolveValueForHeader(h, fields)
      const incomingStr = incoming == null ? '' : String(incoming).trim()
      const canon = canonicalFieldForHeader(h)
      // created_at is write-once: keep the existing value if there is one.
      if (canon === 'created_at' && (existing[idx] ?? '').toString().trim() !== '') {
        return existing[idx] ?? ''
      }
      if (incomingStr === '') return existing[idx] ?? ''
      // Special case: notes — append, don't overwrite, so history accumulates.
      if (canon === 'notes') {
        const prev = (existing[idx] ?? '').toString().trim()
        if (!prev) return incomingStr
        if (prev.toLowerCase().includes(incomingStr.toLowerCase())) return prev
        return `${prev}\n${incomingStr}`
      }
      return incomingStr
    })
    const ok = await updateSheetRange(repId, cfg.spreadsheet_id, fullRowRange, [merged])
    return ok ? 'updated' : null
  }

  // Append new row aligned to headers.
  const newRow: (string | number | null)[] = headers.map((h) => {
    const v = resolveValueForHeader(h, fields)
    return v == null ? '' : (v as string | number)
  })
  const ok = await appendSheetRow(repId, cfg.spreadsheet_id, tab, newRow)
  return ok ? 'appended' : null
}

/**
 * Inspect the linked sheet's headers and report which canonical fields are
 * tracked but missing from `fields`. Useful for prompting the rep on
 * Telegram for the bits they didn't include.
 *
 * Skips fields the system fills automatically: `created_at`, `updated_at`,
 * `last_contact`, `source`, `status`, `notes`.
 */
export async function getMissingSheetFields(
  repId: string,
  cfg: SheetCrmConfig,
  fields: Record<string, string | number | null | undefined>,
): Promise<string[]> {
  const headerRow = cfg.header_row ?? 1
  const tab = cfg.tab_name || 'Sheet1'
  const headerRange = `${tab}!A${headerRow}:ZZ${headerRow}`
  const rows = await readSheetRange(repId, cfg.spreadsheet_id, headerRange)
  if (!rows) return []
  const headers = (rows[0] ?? []).map((h) => String(h).trim()).filter(Boolean)
  const SYSTEM_FILLED = new Set([
    'created_at',
    'updated_at',
    'last_contact',
    'source',
    'status',
    'notes',
    'next_step',
  ])
  const missing: string[] = []
  for (const h of headers) {
    const canon = canonicalFieldForHeader(h)
    if (!canon) continue
    if (SYSTEM_FILLED.has(canon)) continue
    const v = resolveValueForHeader(h, fields)
    if (v == null || String(v).trim() === '') {
      if (!missing.includes(canon)) missing.push(canon)
    }
  }
  return missing
}

/**
 * Find a row by free-text contact match (any column). Returns header→value
 * object for the first hit, or null.
 */
export async function findSheetRowByContact(
  repId: string,
  cfg: SheetCrmConfig,
  query: string,
): Promise<Record<string, string> | null> {
  const headerRow = cfg.header_row ?? 1
  const tab = cfg.tab_name || 'Sheet1'
  const all = await readSheetRange(
    repId,
    cfg.spreadsheet_id,
    `${tab}!A${headerRow}:ZZ${headerRow + 500}`,
  )
  if (!all || all.length < 2) return null
  const headers = (all[0] ?? []).map((h) => String(h).trim())
  const q = query.trim().toLowerCase()
  if (!q) return null
  for (let i = 1; i < all.length; i++) {
    const row = all[i]
    if (!row) continue
    if (row.some((c) => String(c ?? '').toLowerCase().includes(q))) {
      const obj: Record<string, string> = {}
      headers.forEach((h, idx) => {
        obj[h] = String(row[idx] ?? '')
      })
      return obj
    }
  }
  return null
}

/**
 * Read the rep's sheet config from `reps.integrations.google_sheet`.
 */
export async function getSheetCrmConfig(repId: string): Promise<SheetCrmConfig | null> {
  const { data } = await supabase
    .from('reps')
    .select('integrations')
    .eq('id', repId)
    .maybeSingle()
  const integrations = (data?.integrations ?? {}) as Record<string, unknown>
  const cfg = integrations.google_sheet as SheetCrmConfig | undefined
  if (!cfg || !cfg.spreadsheet_id || !cfg.tab_name) return null
  return cfg
}

/**
 * Best-effort: mirror a lead change into the rep's linked Google Sheet.
 * Silently no-ops if no sheet is configured or Google isn't connected.
 */
export async function mirrorLeadToSheet(
  repId: string,
  lead: {
    name: string
    email?: string | null
    company?: string | null
    phone?: string | null
    status?: string | null
    notes?: string | null
    source?: string | null
    last_contact?: string | null
    next_step?: string | null
  },
): Promise<'updated' | 'appended' | null> {
  const cfg = await getSheetCrmConfig(repId)
  if (!cfg) return null
  const nowIso = new Date().toISOString()
  return upsertSheetRow(repId, cfg, {
    name: lead.name,
    email: lead.email ?? '',
    company: lead.company ?? '',
    phone: lead.phone ?? '',
    status: lead.status ?? '',
    notes: lead.notes ?? '',
    source: lead.source ?? 'virtualcloser',
    last_contact: lead.last_contact ?? nowIso,
    next_step: lead.next_step ?? '',
    created_at: nowIso, // ignored on existing rows (only new rows fill empty cells)
    updated_at: nowIso,
  })
}

// `getValidAccessToken` is module-local but Sheets helpers above need it.
// Re-export under a stable name so it can be reused (e.g. for ad-hoc tools).
// Takes optional memberId to scope to a per-member calendar; defaults to
// tenant-level which is what existing single-account integrations expect.
export async function getGoogleAccessToken(
  repId: string,
  memberId?: string | null,
): Promise<string | null> {
  return getValidAccessToken(repId, memberId ?? null)
}

/**
 * Send an email from the rep's Gmail account via the Gmail API.
 *
 * Requires the `gmail.send` scope.  If the rep connected Google before that
 * scope was added they'll need to re-authorise — we return
 * { ok: false, error: 'gmail_scope_missing' } so callers can send a helpful
 * prompt.
 */
export async function sendGmailMessage(
  repId: string,
  opts: {
    to: string
    subject: string
    body: string
    replyTo?: string | null
    fromName?: string | null   // optional display name on the From header
    memberId?: string | null   // send from this member's Gmail (enterprise)
  },
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return { ok: false, error: 'google_not_connected' }

  // Build a minimal RFC 2822 raw message.  Plain text only for now; reps
  // dictating via Telegram don't need HTML formatting.
  const headers: string[] = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
  ]
  if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`)

  const raw = [...headers, '', opts.body].join('\r\n')

  // Base64url encode (Gmail API requires this exact variant — no padding, + → -, / → _).
  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await fetch(GMAIL_SEND, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    // 403 with insufficientPermissions → scope not granted (pre-gmail.send connection)
    if (res.status === 403 && text.includes('insufficientPermissions')) {
      return { ok: false, error: 'gmail_scope_missing' }
    }
    console.error('[google] sendGmailMessage failed', res.status, text)
    return { ok: false, error: `gmail_${res.status}` }
  }

  const json = (await res.json()) as { id?: string }
  return { ok: true, messageId: json.id }
}

// ---------------------------------------------------------------------------
// Gmail read API — used by the email triage feature.
// Requires gmail.readonly (read) and gmail.modify (mark-read / archive).
// ---------------------------------------------------------------------------

export type GmailListEntry = { id: string; threadId?: string; historyId?: string }

export type GmailHeader = { name: string; value: string }

export type GmailPart = {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}

export type GmailMessage = {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  internalDate?: string
  payload?: GmailPart
}

export type GmailThread = {
  id: string
  historyId?: string
  messages?: GmailMessage[]
}

export type ParsedGmailMessage = {
  id: string
  threadId: string
  historyId?: string
  internalDate?: string // ms since epoch as a string
  labelIds: string[]
  snippet: string
  subject: string
  fromAddress: string
  fromName: string | null
  toAddresses: string[]
  ccAddresses: string[]
  messageIdHeader: string | null  // RFC Message-ID header, for In-Reply-To
  referencesHeader: string | null // RFC References header
  bodyText: string | null
  bodyHtml: string | null
}

function gmailScopeError(status: number, text: string): string | null {
  if (status === 403 && text.includes('insufficientPermissions')) return 'gmail_scope_missing'
  if (status === 401) return 'gmail_unauthorized'
  return null
}

function base64UrlDecode(data: string): string {
  // Gmail returns base64url without padding. Convert to standard base64 then decode.
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function findHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value
  }
  return null
}

function parseAddressList(value: string | null): string[] {
  if (!value) return []
  // Split on commas not inside quotes. Gmail headers are reasonably well-formed
  // so a permissive split is enough for triage; we extract the bare address.
  return value.split(',')
    .map((part) => extractEmailAddress(part.trim()))
    .filter((s): s is string => Boolean(s))
}

function extractEmailAddress(value: string): string | null {
  if (!value) return null
  const angle = value.match(/<([^>]+)>/)
  if (angle) return angle[1].trim().toLowerCase()
  const bare = value.match(/[^\s<>"',;]+@[^\s<>"',;]+/)
  return bare ? bare[0].toLowerCase() : null
}

function extractDisplayName(value: string | null): string | null {
  if (!value) return null
  const angle = value.match(/^\s*(.+?)\s*<[^>]+>\s*$/)
  if (angle) return angle[1].replace(/^"|"$/g, '').trim() || null
  return null
}

function collectBody(part: GmailPart | undefined, mime: 'text/plain' | 'text/html'): string | null {
  if (!part) return null
  if (part.mimeType === mime && part.body?.data) {
    return base64UrlDecode(part.body.data)
  }
  if (part.parts) {
    for (const p of part.parts) {
      const found = collectBody(p, mime)
      if (found) return found
    }
  }
  return null
}

export function parseGmailMessage(msg: GmailMessage): ParsedGmailMessage {
  const headers = msg.payload?.headers ?? []
  const fromHeader = findHeader(headers, 'From')
  const subject = findHeader(headers, 'Subject') ?? ''
  const fromAddress = extractEmailAddress(fromHeader ?? '') ?? ''
  const fromName = extractDisplayName(fromHeader)
  const toAddresses = parseAddressList(findHeader(headers, 'To'))
  const ccAddresses = parseAddressList(findHeader(headers, 'Cc'))
  const bodyText = collectBody(msg.payload, 'text/plain')
  const bodyHtml = collectBody(msg.payload, 'text/html')

  return {
    id: msg.id,
    threadId: msg.threadId,
    historyId: msg.historyId,
    internalDate: msg.internalDate,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? '',
    subject,
    fromAddress,
    fromName,
    toAddresses,
    ccAddresses,
    messageIdHeader: findHeader(headers, 'Message-ID'),
    referencesHeader: findHeader(headers, 'References'),
    bodyText,
    bodyHtml,
  }
}

async function gmailFetch(
  repId: string,
  memberId: string | null,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; data?: unknown; error?: string; status?: number }> {
  const token = await getValidAccessToken(repId, memberId)
  if (!token) return { ok: false, error: 'google_not_connected' }
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const scopeErr = gmailScopeError(res.status, text)
    if (scopeErr) return { ok: false, error: scopeErr, status: res.status }
    console.error('[google] gmail fetch failed', path, res.status, text)
    return { ok: false, error: `gmail_${res.status}`, status: res.status }
  }
  const data = await res.json().catch(() => ({}))
  return { ok: true, data }
}

/**
 * Get the user's Gmail profile (email + current historyId). Use the historyId
 * to seed gmail_sync_state on first connect.
 */
export async function getGmailProfile(
  repId: string,
  memberId: string | null,
): Promise<{ ok: boolean; emailAddress?: string; historyId?: string; error?: string }> {
  const res = await gmailFetch(repId, memberId, '/profile')
  if (!res.ok) return { ok: false, error: res.error }
  const d = res.data as { emailAddress?: string; historyId?: string }
  return { ok: true, emailAddress: d.emailAddress, historyId: d.historyId }
}

/**
 * List thread IDs in the inbox (or matching a custom Gmail search query).
 * Returns lightweight entries — call getGmailThread to fetch contents.
 */
export async function listGmailThreads(
  repId: string,
  memberId: string | null,
  opts: { q?: string; maxResults?: number; pageToken?: string } = {},
): Promise<{ ok: boolean; threads?: GmailListEntry[]; nextPageToken?: string; error?: string }> {
  const params = new URLSearchParams()
  params.set('q', opts.q ?? 'in:inbox')
  params.set('maxResults', String(opts.maxResults ?? 25))
  if (opts.pageToken) params.set('pageToken', opts.pageToken)
  const res = await gmailFetch(repId, memberId, `/threads?${params.toString()}`)
  if (!res.ok) return { ok: false, error: res.error }
  const d = res.data as { threads?: GmailListEntry[]; nextPageToken?: string }
  return { ok: true, threads: d.threads ?? [], nextPageToken: d.nextPageToken }
}

/**
 * Fetch a single thread with all messages and parsed headers + bodies.
 */
export async function getGmailThread(
  repId: string,
  memberId: string | null,
  threadId: string,
): Promise<{ ok: boolean; thread?: GmailThread; messages?: ParsedGmailMessage[]; error?: string }> {
  const res = await gmailFetch(repId, memberId, `/threads/${threadId}?format=full`)
  if (!res.ok) return { ok: false, error: res.error }
  const thread = res.data as GmailThread
  const messages = (thread.messages ?? []).map(parseGmailMessage)
  return { ok: true, thread, messages }
}

/**
 * Incremental delta since startHistoryId. Returns:
 *   - threadIds:          threads with new INBOX messages (fetch + persist)
 *   - archivedThreadIds:  threads that LOST the INBOX label (archived/trashed
 *                         in Gmail → should drop off the VC inbox)
 *   - restoredThreadIds:  threads that GAINED the INBOX label without a new
 *                         message (moved back to inbox → un-archive)
 *
 * We request messageAdded + labelRemoved + labelAdded so a Gmail-side
 * archive shows up in VC within one sync tick (~30s).
 */
export async function getGmailHistory(
  repId: string,
  memberId: string | null,
  startHistoryId: string,
  opts: { maxResults?: number } = {},
): Promise<{
  ok: boolean
  historyId?: string
  messageIds?: string[]
  threadIds?: string[]
  archivedThreadIds?: string[]
  restoredThreadIds?: string[]
  error?: string
}> {
  const params = new URLSearchParams()
  params.set('startHistoryId', startHistoryId)
  // Gmail allows repeating historyTypes; URLSearchParams handles the dupes.
  params.append('historyTypes', 'messageAdded')
  params.append('historyTypes', 'labelRemoved')
  params.append('historyTypes', 'labelAdded')
  if (opts.maxResults) params.set('maxResults', String(opts.maxResults))
  const res = await gmailFetch(repId, memberId, `/history?${params.toString()}`)
  if (!res.ok) return { ok: false, error: res.error }
  const d = res.data as {
    historyId?: string
    history?: Array<{
      messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
      labelsRemoved?: Array<{ message: { id: string; threadId: string }; labelIds?: string[] }>
      labelsAdded?: Array<{ message: { id: string; threadId: string }; labelIds?: string[] }>
    }>
  }

  const messageIds = new Set<string>()
  const threadIds = new Set<string>()
  const archived = new Set<string>()
  const restored = new Set<string>()

  for (const entry of d.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      // Only care about messages actually in INBOX (skip Sent, Drafts, etc.)
      const labels = added.message.labelIds ?? []
      if (!labels.includes('INBOX')) continue
      messageIds.add(added.message.id)
      threadIds.add(added.message.threadId)
    }
    for (const rm of entry.labelsRemoved ?? []) {
      // INBOX removed = archived or trashed in Gmail.
      if ((rm.labelIds ?? []).includes('INBOX')) {
        archived.add(rm.message.threadId)
      }
    }
    for (const add of entry.labelsAdded ?? []) {
      // INBOX added back = moved back into inbox (un-archive).
      if ((add.labelIds ?? []).includes('INBOX')) {
        restored.add(add.message.threadId)
      }
    }
  }

  // A thread that got a new INBOX message in this same window is active —
  // a new inbound message re-inboxes it, so it shouldn't be treated as
  // archived even if an earlier event in the window removed INBOX.
  for (const id of threadIds) archived.delete(id)
  for (const id of restored) archived.delete(id)
  // Conversely, don't "restore" something that ended the window archived.
  for (const id of archived) restored.delete(id)

  return {
    ok: true,
    historyId: d.historyId,
    messageIds: Array.from(messageIds),
    threadIds: Array.from(threadIds),
    archivedThreadIds: Array.from(archived),
    restoredThreadIds: Array.from(restored),
  }
}

/**
 * Remove the UNREAD label from a message. Requires gmail.modify scope.
 */
export async function markGmailRead(
  repId: string,
  memberId: string | null,
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await gmailFetch(repId, memberId, `/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  })
  return { ok: res.ok, error: res.error }
}

/**
 * Send a reply that threads correctly in Gmail.
 *
 * Pass `threadId` and the original message's `Message-ID` header (as
 * `inReplyTo`). Subject should already include the "Re: " prefix if desired.
 * References can be either the original References header or a single
 * Message-ID; we append inReplyTo automatically.
 */
export async function replyToGmailThread(
  repId: string,
  opts: {
    threadId: string
    to: string
    subject: string
    body: string
    inReplyTo?: string | null
    references?: string | null
    cc?: string[]
    memberId?: string | null
  },
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const token = await getValidAccessToken(repId, opts.memberId ?? null)
  if (!token) return { ok: false, error: 'google_not_connected' }

  const headers: string[] = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
  ]
  if (opts.cc && opts.cc.length > 0) headers.push(`Cc: ${opts.cc.join(', ')}`)
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`)
  const refs = [opts.references, opts.inReplyTo].filter(Boolean).join(' ').trim()
  if (refs) headers.push(`References: ${refs}`)

  const raw = [...headers, '', opts.body].join('\r\n')
  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await fetch(GMAIL_SEND, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded, threadId: opts.threadId }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const scopeErr = gmailScopeError(res.status, text)
    if (scopeErr) return { ok: false, error: scopeErr }
    console.error('[google] replyToGmailThread failed', res.status, text)
    return { ok: false, error: `gmail_${res.status}` }
  }
  const json = (await res.json()) as { id?: string }
  return { ok: true, messageId: json.id }
}
