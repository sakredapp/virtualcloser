// Minimal Google OAuth + Calendar client — no SDK, just fetch.
// Scopes: calendar.events (create/update events) + calendar.freebusy (conflict checks).

import { supabase } from '@/lib/supabase'

const OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token'
const CAL_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const CAL_FREEBUSY = 'https://www.googleapis.com/calendar/v3/freeBusy'

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
  access_token: string
  refresh_token: string | null
  expires_at: string // ISO
  email: string | null
  scope: string | null
}

export async function saveTokens(input: {
  repId: string
  accessToken: string
  refreshToken: string | null
  expiresInSec: number
  email?: string | null
  scope?: string | null
}): Promise<void> {
  const expiresAt = new Date(Date.now() + input.expiresInSec * 1000).toISOString()
  // Upsert — keep existing refresh_token if Google doesn't return a new one.
  const existing = await getTokensForRep(input.repId)
  const refresh_token = input.refreshToken ?? existing?.refresh_token ?? null

  const row = {
    rep_id: input.repId,
    access_token: input.accessToken,
    refresh_token,
    expires_at: expiresAt,
    email: input.email ?? existing?.email ?? null,
    scope: input.scope ?? existing?.scope ?? null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('google_tokens').upsert(row, { onConflict: 'rep_id' })
  if (error) throw error
}

export async function getTokensForRep(repId: string): Promise<GoogleTokens | null> {
  const { data } = await supabase
    .from('google_tokens')
    .select('*')
    .eq('rep_id', repId)
    .maybeSingle()
  return (data as GoogleTokens | null) ?? null
}

export async function disconnectRep(repId: string): Promise<void> {
  await supabase.from('google_tokens').delete().eq('rep_id', repId)
}

async function getValidAccessToken(repId: string): Promise<string | null> {
  const t = await getTokensForRep(repId)
  if (!t) return null
  const expiresAt = new Date(t.expires_at).getTime()
  // Refresh if expiring within 60s.
  if (Date.now() + 60_000 < expiresAt) return t.access_token
  if (!t.refresh_token) return null
  const refreshed = await refreshAccessToken(t.refresh_token)
  await saveTokens({
    repId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? null,
    expiresInSec: refreshed.expires_in,
    scope: refreshed.scope ?? null,
  })
  return refreshed.access_token
}

export type CreateEventInput = {
  repId: string
  summary: string
  description?: string
  startIso: string // e.g. 2026-05-02T09:00:00-05:00 or date-only
  endIso?: string
  timezone?: string // e.g. 'America/New_York'
  allDay?: boolean
  attendees?: Array<{ email: string; displayName?: string }>
}

/**
 * Creates a Google Calendar event on the rep's primary calendar.
 * Returns the event URL (htmlLink) on success, or null if the rep isn't
 * connected / token refresh fails — callers should treat this as best-effort.
 */
export async function createCalendarEvent(
  input: CreateEventInput,
): Promise<{ htmlLink: string; id: string } | null> {
  const token = await getValidAccessToken(input.repId)
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
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>
}

/**
 * List upcoming events on the rep's primary calendar in a window.
 * Returns null if the rep isn't connected.
 */
export async function listUpcomingEvents(
  repId: string,
  opts: { fromIso?: string; toIso?: string; maxResults?: number } = {},
): Promise<GoogleCalEvent[] | null> {
  const token = await getValidAccessToken(repId)
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
    attendees: (e.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({
        email: a.email!,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      })),
  }))
}

export type BusySlot = { startIso: string; endIso: string }

/**
 * Returns busy slots on the rep's primary calendar between two ISO times.
 * Returns null if the rep isn't connected (callers should treat as "unknown").
 */
export async function getBusySlots(
  repId: string,
  fromIso: string,
  toIso: string,
): Promise<BusySlot[] | null> {
  const token = await getValidAccessToken(repId)
  if (!token) return null

  const res = await fetch(CAL_FREEBUSY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: fromIso,
      timeMax: toIso,
      items: [{ id: 'primary' }],
    }),
  })
  if (!res.ok) {
    console.error('[google] getBusySlots failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as {
    calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } }
  }
  const busy = json.calendars?.primary?.busy ?? []
  return busy.map((b) => ({ startIso: b.start, endIso: b.end }))
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
): Promise<BusySlot | null> {
  const busy = await getBusySlots(repId, startIso, endIso)
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
