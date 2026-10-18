/**
 * Ciao's find_free_time and create_sheet_report (owner 10-17, the Google
 * OAuth review demo): free time from the freeBusy API, a new Google Sheet in
 * the person's own Drive, and a plain "reconnect Google" when an older
 * connection lacks the scope. No database, no Google, no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'update', 'insert']) q[k] = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: [], error: null }))
  return { supabase: { from: () => q } }
})

type Account = { accountId: string; memberId: string | null; email: string | null; label: string; isShared: boolean }
type Tok = { id: string; rep_id: string; member_id: string | null; email: string | null; scope: string | null; needs_reconnect?: boolean }
const g = {
  accounts: [] as Account[],
  tokens: {} as Record<string, Tok>, // by account id
  busy: {} as Record<string, Array<{ startIso: string; endIso: string; calendar?: string }> | null>,
  busyCalls: [] as Array<{ from: string; to: string; memberId: string | null | undefined; accountId: string | null | undefined }>,
  tokenCalls: [] as Array<{ memberId: string | null | undefined; accountId: string | null | undefined; need?: string }>,
  accessCalls: [] as Array<{ memberId: string | null | undefined; accountId: string | null | undefined; need?: string }>,
  broken: [] as Array<{ id?: string | null; reason: string }>,
}

vi.mock('@/lib/google', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listConnectedGoogleAccounts: async () => g.accounts,
  getTokensFor: async (_rep: string, memberId?: string | null, accountId?: string | null, need?: string) => {
    g.tokenCalls.push({ memberId, accountId, need })
    if (accountId) return g.tokens[accountId] ?? null
    const rows = Object.values(g.tokens)
    return rows.find((t) => t.member_id === memberId) ?? rows.find((t) => t.member_id === null) ?? null
  },
  getBusySlots: async (_rep: string, from: string, to: string, opts: { memberId?: string | null; accountId?: string | null }) => {
    g.busyCalls.push({ from, to, memberId: opts.memberId, accountId: opts.accountId })
    return g.busy[opts.accountId ?? ''] ?? []
  },
  getGoogleAccessToken: async (_rep: string, memberId?: string | null, accountId?: string | null, need?: string) => {
    g.accessCalls.push({ memberId, accountId, need })
    return 'access-token-1'
  },
}))
vi.mock('@/lib/google/tokenHealth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  markGoogleTokenBroken: async (row: { id?: string | null }, reason: string) => (g.broken.push({ id: row.id, reason }), true),
}))

import { businessDaysWindow, findFreeWindows, scopeAllowsFreeBusy, scopeAllowsSheets } from '@/lib/cxoFreeTime'
import { cleanRows, spreadsheetCreateBody } from '@/lib/cxoSheets'
import { CXO_TOOL_DEFS, CXO_TOOL_HANDLERS, RECONNECT_GOOGLE_CALENDAR, RECONNECT_GOOGLE_SHEETS } from '@/lib/agent/cxoTools'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { routingHintsFor, capabilitiesFor } from '@/lib/agent/cxoCatalog'
import type { AgentContext } from '@/lib/agent/tools'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const et = (local: string) => new Date(`${local}-04:00`).toISOString()
const FULL_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file openid email'
const OLD_SCOPE = 'https://www.googleapis.com/auth/gmail.send openid email'

const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', company: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: tz, settings: {} } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role: 'owner', timezone: tz } as unknown as Member
const ERIN = { id: 'm-erin', rep_id: 'rep-acme', display_name: 'Erin Staff', email: 'erin@acme.test', role: 'rep', timezone: tz } as unknown as Member
const ctxFor = (caller: Member, extra: Partial<AgentContext> = {}): AgentContext => ({
  tenant: TENANT,
  caller,
  timezone: tz,
  todayIso: '2026-10-19',
  ownerMemberId: caller.id,
  ...extra,
})
const call = async (name: string, ctx: AgentContext, args: Record<string, unknown>) => JSON.parse((await CXO_TOOL_HANDLERS[name](ctx, args)).text)

// Monday 2026-10-19, 7:00am New York.
const NOW = new Date('2026-10-19T07:00:00-04:00')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  g.accounts = []
  g.tokens = {}
  g.busy = {}
  g.busyCalls = []
  g.tokenCalls = []
  g.accessCalls = []
  g.broken = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ── find_free_time ──────────────────────────────────────────────────────────

const MONDAY_BUSY = [
  { startIso: et('2026-10-19T09:00:00'), endIso: et('2026-10-19T10:00:00'), calendar: 'Work' },
  { startIso: et('2026-10-19T11:00:00'), endIso: et('2026-10-19T12:30:00'), calendar: 'Work' },
  { startIso: et('2026-10-19T12:00:00'), endIso: et('2026-10-19T13:00:00'), calendar: 'Board' }, // overlaps across calendars
  { startIso: et('2026-10-19T15:00:00'), endIso: et('2026-10-19T17:00:00'), calendar: 'Work' },
  { startIso: et('2026-10-20T08:00:00'), endIso: et('2026-10-20T18:00:00'), calendar: 'Offsite' }, // Tuesday fully booked
]

describe('findFreeWindows (pure)', () => {
  it('open stretches inside 9–17, busy merged across calendars, a full day skipped', () => {
    const out = findFreeWindows(MONDAY_BUSY, { fromIso: et('2026-10-19T00:00:00'), toIso: et('2026-10-21T23:59:00'), tz, nowMs: NOW.getTime() })
    expect(out.map((w) => [w.startIso, w.endIso])).toEqual([
      [et('2026-10-19T10:00:00'), et('2026-10-19T11:00:00')],
      [et('2026-10-19T13:00:00'), et('2026-10-19T15:00:00')],
      [et('2026-10-21T09:00:00'), et('2026-10-21T17:00:00')],
    ])
    expect(out[0].minutes).toBe(60)
    expect(out[0].label).toMatch(/^Mon, Oct 19, 10:00\sAM – 11:00\sAM EDT$/)
  })

  it('respects duration, working hours, weekends, the cap, and never offers the past', () => {
    const from = et('2026-10-19T00:00:00')
    const to = et('2026-10-21T23:59:00')
    // 90 minutes: Monday's 60-minute gap drops out.
    expect(findFreeWindows(MONDAY_BUSY, { fromIso: from, toIso: to, tz, durationMin: 90, nowMs: NOW.getTime() }).map((w) => w.startIso)).toEqual([et('2026-10-19T13:00:00'), et('2026-10-21T09:00:00')])
    // 8–18 working hours: an 8–9 stretch Monday appears.
    expect(findFreeWindows(MONDAY_BUSY, { fromIso: from, toIso: to, tz, startHour: 8, endHour: 18, nowMs: NOW.getTime() })[0]).toMatchObject({ startIso: et('2026-10-19T08:00:00'), endIso: et('2026-10-19T09:00:00') })
    // Now is 10:20 Monday: the first offer starts at 10:30 (rounded up past now + 5 min).
    expect(findFreeWindows(MONDAY_BUSY, { fromIso: from, toIso: to, tz, durationMin: 15, nowMs: new Date(et('2026-10-19T10:20:00')).getTime() })[0].startIso).toBe(et('2026-10-19T10:30:00'))
    // Saturday + Sunday only show when asked.
    const weekend = { fromIso: et('2026-10-24T00:00:00'), toIso: et('2026-10-25T23:59:00'), tz, nowMs: NOW.getTime() }
    expect(findFreeWindows([], weekend)).toEqual([])
    expect(findFreeWindows([], { ...weekend, includeWeekends: true })).toHaveLength(2)
    // Never more than max.
    expect(findFreeWindows([], { fromIso: from, toIso: et('2026-11-20T00:00:00'), tz, nowMs: NOW.getTime() })).toHaveLength(8)
  })

  it('default window: through the end of the 5th business day, weekends not counted', () => {
    const fri = new Date('2026-10-16T10:00:00-04:00').getTime()
    const w = businessDaysWindow(fri, tz, 5)
    expect(w.fromIso).toBe(new Date(fri).toISOString())
    expect(w.toIso).toBe(et('2026-10-22T23:59:00')) // Fri, Mon, Tue, Wed, Thu
  })

  it('scope checks: freeBusy needs a calendar scope, Sheets needs spreadsheets or drive.file; unknown scope is allowed', () => {
    expect(scopeAllowsFreeBusy(FULL_SCOPE)).toBe(true)
    expect(scopeAllowsFreeBusy('https://www.googleapis.com/auth/calendar.freebusy')).toBe(true)
    expect(scopeAllowsFreeBusy(OLD_SCOPE)).toBe(false)
    expect(scopeAllowsFreeBusy(null)).toBe(true)
    expect(scopeAllowsSheets(FULL_SCOPE)).toBe(true)
    expect(scopeAllowsSheets('https://www.googleapis.com/auth/drive.file')).toBe(true)
    expect(scopeAllowsSheets('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly')).toBe(false)
  })
})

describe('find_free_time (tool)', () => {
  it('reads freeBusy on every connected account and answers in plain lines', async () => {
    g.accounts = [
      { accountId: 'acc-dana', memberId: DANA.id, email: 'dana@acme.test', label: 'Dana', isShared: false },
      { accountId: 'acc-board', memberId: DANA.id, email: 'dana.board@gmail.com', label: 'Dana', isShared: false },
    ]
    g.tokens = {
      'acc-dana': { id: 'acc-dana', rep_id: TENANT.id, member_id: DANA.id, email: 'dana@acme.test', scope: FULL_SCOPE },
      'acc-board': { id: 'acc-board', rep_id: TENANT.id, member_id: DANA.id, email: 'dana.board@gmail.com', scope: FULL_SCOPE },
    }
    g.busy = { 'acc-dana': MONDAY_BUSY.slice(0, 2), 'acc-board': MONDAY_BUSY.slice(2) }
    const r = await call('find_free_time', ctxFor(DANA), { from: '2026-10-19', to: '2026-10-21' })
    expect(r.ok).toBe(true)
    expect(g.busyCalls.map((c) => c.accountId)).toEqual(['acc-dana', 'acc-board'])
    expect(r.calendars_checked).toBe(2)
    expect(r.free.map((f: { start: string }) => f.start)).toEqual([et('2026-10-19T10:00:00'), et('2026-10-19T13:00:00'), et('2026-10-21T09:00:00')])
    expect(r.say).toContain("You're free")
    expect(r.say.split('\n')).toHaveLength(4)
  })

  it('defaults: next 5 business days, 30 minutes, 9–17', async () => {
    g.accounts = [{ accountId: 'acc-dana', memberId: DANA.id, email: 'dana@acme.test', label: 'Dana', isShared: false }]
    g.tokens = { 'acc-dana': { id: 'acc-dana', rep_id: TENANT.id, member_id: DANA.id, email: 'dana@acme.test', scope: FULL_SCOPE } }
    const r = await call('find_free_time', ctxFor(DANA), {})
    expect(g.busyCalls[0]).toMatchObject({ from: NOW.toISOString(), to: et('2026-10-23T23:59:00') })
    expect(r).toMatchObject({ ok: true, duration_min: 30, working_hours: '9:00–17:00' })
    expect(r.free).toHaveLength(5) // one open day each, Mon–Fri
  })

  it('an older connection without a calendar scope gets a plain reconnect message', async () => {
    g.accounts = [{ accountId: 'acc-old', memberId: DANA.id, email: 'dana@acme.test', label: 'Dana', isShared: false }]
    g.tokens = { 'acc-old': { id: 'acc-old', rep_id: TENANT.id, member_id: DANA.id, email: 'dana@acme.test', scope: OLD_SCOPE } }
    const r = await call('find_free_time', ctxFor(DANA), {})
    expect(r).toEqual({ ok: false, error: 'reconnect_needed', say: RECONNECT_GOOGLE_CALENDAR })
    expect(r.say).toMatch(/^Reconnect Google on the Calendar page/)
    expect(g.busyCalls).toEqual([])
  })

  it('no Google account → not_connected', async () => {
    const r = await call('find_free_time', ctxFor(DANA), {})
    expect(r).toMatchObject({ ok: false, error: 'not_connected' })
  })

  it("an employee only reads their own account, never the shared or a coworker's", async () => {
    g.accounts = [
      { accountId: 'acc-shared', memberId: null, email: 'ops@acme.test', label: 'Workspace', isShared: true },
      { accountId: 'acc-dana', memberId: DANA.id, email: 'dana@acme.test', label: 'Dana', isShared: false },
      { accountId: 'acc-erin', memberId: ERIN.id, email: 'erin@acme.test', label: 'Erin', isShared: false },
    ]
    for (const a of g.accounts) g.tokens[a.accountId] = { id: a.accountId, rep_id: TENANT.id, member_id: a.memberId, email: a.email, scope: FULL_SCOPE }
    await call('find_free_time', ctxFor(ERIN, { selfOnly: true }), {})
    expect(g.busyCalls.map((c) => c.accountId)).toEqual(['acc-erin'])
  })
})

// ── create_sheet_report ─────────────────────────────────────────────────────

type Req = { url: string; method: string; headers: Record<string, string>; body: unknown }
function stubGoogle(over: { sheetsStatus?: number; sheetsBody?: string; folderExists?: boolean } = {}) {
  const reqs: Req[] = []
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    reqs.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null })
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === 'https://sheets.googleapis.com/v4/spreadsheets' && method === 'POST') {
      if (over.sheetsStatus) return new Response(over.sheetsBody ?? '{}', { status: over.sheetsStatus })
      return ok({ spreadsheetId: 'ss-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ss-1/edit' })
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && method === 'GET') return ok({ files: over.folderExists ? [{ id: 'fold-1', name: 'Ciao', webViewLink: 'https://drive.google.com/drive/folders/fold-1' }] : [] })
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && method === 'POST') return ok({ id: 'fold-1', name: (reqs[reqs.length - 1].body as { name: string }).name, webViewLink: 'https://drive.google.com/drive/folders/fold-1' })
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/ss-1?fields=parents')) return ok({ parents: ['root-0'] })
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/ss-1?') && method === 'PATCH') return ok({ id: 'ss-1', parents: ['fold-1'] })
    return new Response('unexpected', { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return reqs
}

const ROWS = [
  ['Carrier', 'Premium', 'Zip'],
  ['Mutual of Omaha', '1250.5', '02134'],
  ['Americo', 980, '=HYPERLINK("x")'],
]

describe('create_sheet_report (tool)', () => {
  beforeEach(() => {
    g.tokens = { 'tok-dana': { id: 'tok-dana', rep_id: TENANT.id, member_id: DANA.id, email: 'dana@acme.test', scope: FULL_SCOPE } }
  })

  it('creates a new spreadsheet with the rows in one Sheets call, files it in the Ciao folder, returns the link', async () => {
    const reqs = stubGoogle()
    const r = await call('create_sheet_report', ctxFor(DANA), { title: 'Q3 carrier production', rows: ROWS })
    expect(r).toMatchObject({ ok: true, url: 'https://docs.google.com/spreadsheets/d/ss-1/edit', spreadsheet_id: 'ss-1', rows: 2, columns: 3, folder: { name: 'Ciao' }, account: 'dana@acme.test' })
    expect(r.say).toContain('https://docs.google.com/spreadsheets/d/ss-1/edit')
    expect(r.say).toContain('"Ciao" folder')

    // The person's own connection, pinned by account id, with the full (non-calendar-only) need.
    expect(g.tokenCalls[0]).toEqual({ memberId: DANA.id, accountId: null, need: 'full' })
    expect(g.accessCalls).toEqual([{ memberId: null, accountId: 'tok-dana', need: 'full' }])

    const create = reqs[0]
    expect(create.url).toBe('https://sheets.googleapis.com/v4/spreadsheets')
    expect(create.method).toBe('POST')
    expect(create.headers.Authorization).toBe('Bearer access-token-1')
    const body = create.body as ReturnType<typeof spreadsheetCreateBody>
    expect(body).toEqual(spreadsheetCreateBody('Q3 carrier production', [
      ['Carrier', 'Premium', 'Zip'],
      ['Mutual of Omaha', 1250.5, '02134'],
      ['Americo', 980, '=HYPERLINK("x")'],
    ]))
    const sheet = (body.sheets as Array<{ properties: { gridProperties: { frozenRowCount: number } }; data: Array<{ rowData: Array<{ values: Array<Record<string, unknown>> }> }> }>)[0]
    expect(sheet.properties.gridProperties.frozenRowCount).toBe(1)
    expect(sheet.data[0].rowData[0].values[0]).toEqual({ userEnteredValue: { stringValue: 'Carrier' }, userEnteredFormat: { textFormat: { bold: true } } })
    expect(sheet.data[0].rowData[1].values[1]).toEqual({ userEnteredValue: { numberValue: 1250.5 } })
    expect(sheet.data[0].rowData[1].values[2]).toEqual({ userEnteredValue: { stringValue: '02134' } }) // a zip keeps its zero
    expect(sheet.data[0].rowData[2].values[2]).toEqual({ userEnteredValue: { stringValue: '=HYPERLINK("x")' } }) // text, never a formula

    // Folder: looked up, created (drive.file: the app's own folder), then the sheet moved into it.
    expect(reqs.map((q) => q.method)).toEqual(['POST', 'GET', 'POST', 'GET', 'PATCH'])
    expect(new URL(reqs[1].url).searchParams.get('q')).toContain("name = 'Ciao'")
    expect(reqs[2].body).toEqual({ name: 'Ciao', mimeType: 'application/vnd.google-apps.folder' })
    const patch = new URL(reqs[4].url)
    expect(patch.searchParams.get('addParents')).toBe('fold-1')
    expect(patch.searchParams.get('removeParents')).toBe('root-0')
  })

  it('the folder is named after the renamed assistant, and an existing folder is reused', async () => {
    const reqs = stubGoogle({ folderExists: false })
    await call('create_sheet_report', ctxFor(DANA, { assistantName: 'Ava' }), { title: 'T', rows: ROWS })
    expect(reqs[2].body).toEqual({ name: 'Ava', mimeType: 'application/vnd.google-apps.folder' })
    const again = stubGoogle({ folderExists: true })
    const r = await call('create_sheet_report', ctxFor(DANA), { title: 'T', rows: ROWS })
    expect(again.map((q) => q.method)).toEqual(['POST', 'GET', 'GET', 'PATCH'])
    expect(r.folder).toMatchObject({ name: 'Ciao' })
  })

  it('an older connection without Sheets or Drive scope: reconnect message, nothing sent to Google', async () => {
    g.tokens['tok-dana'].scope = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly openid email'
    const reqs = stubGoogle()
    const r = await call('create_sheet_report', ctxFor(DANA), { title: 'T', rows: ROWS })
    expect(r).toEqual({ ok: false, error: 'reconnect_needed', say: RECONNECT_GOOGLE_SHEETS })
    expect(r.say).toMatch(/^Reconnect Google on the Calendar page/)
    expect(reqs).toEqual([])
  })

  it('Google answers 403 insufficient scope: reconnect message and the connection is flagged', async () => {
    g.tokens['tok-dana'].scope = null // unknown: we ask Google
    stubGoogle({ sheetsStatus: 403, sheetsBody: '{"error":{"status":"PERMISSION_DENIED","message":"Request had insufficient authentication scopes."}}' })
    const r = await call('create_sheet_report', ctxFor(DANA), { title: 'T', rows: ROWS })
    expect(r).toEqual({ ok: false, error: 'reconnect_needed', say: RECONNECT_GOOGLE_SHEETS })
    expect(g.broken).toEqual([{ id: 'tok-dana', reason: 'scope' }])
  })

  it('caps at 500 data rows and 20 columns and says so', async () => {
    const reqs = stubGoogle()
    const wide = (n: number) => Array.from({ length: 25 }, (_, i) => `r${n}c${i}`)
    const rows = [wide(0), ...Array.from({ length: 600 }, (_, i) => wide(i + 1))]
    const r = await call('create_sheet_report', ctxFor(DANA), { title: 'Big', rows })
    expect(r).toMatchObject({ ok: true, rows: 500, columns: 20, truncated: true })
    expect(r.say).toContain('first 500 rows and 20 columns')
    const rowData = (reqs[0].body as { sheets: Array<{ data: Array<{ rowData: Array<{ values: unknown[] }> }> }> }).sheets[0].data[0].rowData
    expect(rowData).toHaveLength(501)
    expect(rowData.every((row) => row.values.length === 20)).toBe(true)
  })

  it('no rows / no header → asks for rows, nothing sent', async () => {
    const reqs = stubGoogle()
    expect((await call('create_sheet_report', ctxFor(DANA), { title: 'T', rows: [] })).ok).toBe(false)
    expect(cleanRows([['', null]])).toBeNull()
    expect(reqs).toEqual([])
  })

  it("an employee never writes to the shared workspace Drive", async () => {
    g.tokens = { 'tok-shared': { id: 'tok-shared', rep_id: TENANT.id, member_id: null, email: 'ops@acme.test', scope: FULL_SCOPE } }
    const reqs = stubGoogle()
    const r = await call('create_sheet_report', ctxFor(ERIN, { selfOnly: true }), { title: 'T', rows: ROWS })
    expect(r).toMatchObject({ ok: false, error: 'not_connected' })
    expect(reqs).toEqual([])
  })
})

describe('Ciao picks these tools', () => {
  it('both are offered, open to employees, and routed from plain asks', () => {
    const names = CXO_TOOL_DEFS.map((d) => d.name)
    expect(names).toContain('find_free_time')
    expect(names).toContain('create_sheet_report')
    expect(EMPLOYEE_TOOLS.has('find_free_time')).toBe(true)
    expect(EMPLOYEE_TOOLS.has('create_sheet_report')).toBe(true)
    const hints = routingHintsFor(['find_free_time', 'create_sheet_report']).join('\n')
    expect(hints).toMatch(/When am I free.*find_free_time/)
    expect(hints).toMatch(/Google Sheet.*create_sheet_report/)
    expect(capabilitiesFor([{ name: 'create_sheet_report' }])[0]).toMatch(/Google Sheet/)
    const sheetDef = CXO_TOOL_DEFS.find((d) => d.name === 'create_sheet_report')!
    expect(sheetDef.description).toMatch(/put this in a Google Sheet/i)
  })
})
