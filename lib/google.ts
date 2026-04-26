// Minimal Google OAuth + Calendar + Sheets client — no SDK, just fetch.
// Scopes: calendar.events + calendar.freebusy + spreadsheets (read/write the
// rep's chosen Google Sheet CRM by ID).

import { supabase } from '@/lib/supabase'

const OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token'
const CAL_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const CAL_FREEBUSY = 'https://www.googleapis.com/calendar/v3/freeBusy'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

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
  'https://www.googleapis.com/auth/spreadsheets',
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

/**
 * Search the rep's primary calendar for events matching a free-text query
 * (Google's `q` param matches against summary, description, attendee names
 * and emails). Defaults to the next 60 days. Returns null if not connected.
 */
export async function findCalendarEventsByQuery(
  repId: string,
  query: string,
  opts: { fromIso?: string; toIso?: string; maxResults?: number } = {},
): Promise<GoogleCalEvent[] | null> {
  const token = await getValidAccessToken(repId)
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
  },
): Promise<{ id: string; htmlLink: string } | null> {
  const token = await getValidAccessToken(repId)
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
): Promise<boolean> {
  const token = await getValidAccessToken(repId)
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
export async function getGoogleAccessToken(repId: string): Promise<string | null> {
  return getValidAccessToken(repId)
}
