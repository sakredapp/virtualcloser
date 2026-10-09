/**
 * QuickBooks Online (Intuit) — pure helpers, no DB, no network of their own.
 *
 * Owner-approved 10-09 for the Pinnacle exec suite: READ-ONLY. The only scope
 * asked for is com.intuit.quickbooks.accounting and the only calls made are
 * GET report reads; nothing here ever writes to their books.
 *
 * Kept free of server imports so the token refresh, the report parsing and
 * the not-configured check are unit-tested directly
 * (__tests__/cxo/qbo.spec.ts).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
export const QBO_DEFAULT_REDIRECT = 'https://suitecxo.com/api/integrations/quickbooks/callback'
/** Pinned so a QuickBooks API change can't silently reshape the reports. */
export const QBO_MINOR_VERSION = '75'

export { QBO_NOT_SET_UP } from '@/lib/qbo/display'

export type QboEnvironment = 'sandbox' | 'production'
export type QboConfig = {
  clientId: string
  clientSecret: string
  environment: QboEnvironment
  redirectUri: string
  apiBase: string
}

type Env = Record<string, string | undefined>

/**
 * The app's QuickBooks settings, or null when it is not set up. All three of
 * QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_ENVIRONMENT (sandbox|production)
 * must be present; anything else reads as "not set up" and nothing calls
 * Intuit. QBO_REDIRECT_URI is optional (defaults to the suitecxo.com apex).
 */
export function qboConfig(env: Env = process.env): QboConfig | null {
  const clientId = (env.QBO_CLIENT_ID ?? '').trim()
  const clientSecret = (env.QBO_CLIENT_SECRET ?? '').trim()
  const environment = (env.QBO_ENVIRONMENT ?? '').trim().toLowerCase()
  if (!clientId || !clientSecret) return null
  if (environment !== 'sandbox' && environment !== 'production') return null
  const redirectUri = (env.QBO_REDIRECT_URI ?? '').trim() || QBO_DEFAULT_REDIRECT
  return {
    clientId,
    clientSecret,
    environment,
    redirectUri,
    apiBase: environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com',
  }
}

export function buildQboAuthUrl(cfg: QboConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: QBO_SCOPE,
    redirect_uri: cfg.redirectUri,
    state,
  })
  return `${QBO_AUTHORIZE_URL}?${p.toString()}`
}

// ── State (CSRF) ─────────────────────────────────────────────────────────
//
// The callback lands on the apex (suitecxo.com), the start runs on the
// member's subdomain. The state carries rep + member + expiry and is HMAC
// signed, so the callback can prove it minted it and that it belongs to the
// session that comes back.

const b64u = (b: Buffer) => b.toString('base64url')

export function signQboState(secret: string, s: { repId: string; memberId: string; ret?: string }, now = Date.now()): string {
  const exp = now + 15 * 60_000
  const nonce = b64u(randomBytes(12))
  const body = b64u(Buffer.from(JSON.stringify({ r: s.repId, m: s.memberId, e: exp, n: nonce, t: s.ret ?? '' })))
  const sig = b64u(createHmac('sha256', secret).update(`qbo-state.${body}`).digest())
  return `${body}.${sig}`
}

export function verifyQboState(secret: string, state: string, now = Date.now()): { repId: string; memberId: string; ret: string } | null {
  const [body, sig] = String(state || '').split('.')
  if (!body || !sig) return null
  const want = createHmac('sha256', secret).update(`qbo-state.${body}`).digest()
  let got: Buffer
  try {
    got = Buffer.from(sig, 'base64url')
  } catch {
    return null
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { r?: string; m?: string; e?: number; t?: string }
    if (!j.r || !j.m || typeof j.e !== 'number' || j.e < now) return null
    return { repId: j.r, memberId: j.m, ret: typeof j.t === 'string' ? j.t : '' }
  } catch {
    return null
  }
}

// ── Token encryption ─────────────────────────────────────────────────────
//
// Access and refresh tokens are AES-256-GCM encrypted before they reach the
// database (the row is service-role only on top of that). The key is
// QBO_TOKEN_KEY when set, else derived (HKDF) from SESSION_SECRET, so no new
// secret is required to switch QuickBooks on. Rotating that secret makes the
// stored tokens unreadable: the app then treats QuickBooks as needing a
// reconnect, it never fails a page.

export function qboTokenKey(env: Env = process.env): Buffer | null {
  const raw = (env.QBO_TOKEN_KEY || env.SESSION_SECRET || env.CRON_SECRET || '').trim()
  if (!raw) return null
  return Buffer.from(hkdfSync('sha256', raw, 'suitecxo-qbo', 'qbo-token-v1', 32))
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`
}

export function decryptToken(enc: string, key: Buffer): string | null {
  const [v, iv, tag, ct] = String(enc || '').split('.')
  if (v !== 'v1' || !iv || !tag || ct === undefined) return null
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Short fingerprint for logs; never log a token itself. */
export const tokenFingerprint = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 8)

// ── Tokens ───────────────────────────────────────────────────────────────

export type QboTokenResponse = {
  access_token: string
  refresh_token: string
  /** Seconds; Intuit gives 3600. */
  expires_in: number
  /** Seconds the refresh token lives; Intuit gives ~100 days. */
  x_refresh_token_expires_in?: number
  token_type?: string
}

export type QboTokenSet = {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string | null
}

export class QboAuthError extends Error {
  /** true = the refresh token is dead (revoked / expired): reconnect needed. */
  constructor(message: string, readonly reconnect: boolean) {
    super(message)
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

function basic(cfg: QboConfig) {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`
}

export function toTokenSet(r: QboTokenResponse, now = Date.now()): QboTokenSet {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    accessExpiresAt: new Date(now + Math.max(60, Number(r.expires_in) || 3600) * 1000).toISOString(),
    refreshExpiresAt: r.x_refresh_token_expires_in ? new Date(now + Number(r.x_refresh_token_expires_in) * 1000).toISOString() : null,
  }
}

async function tokenCall(cfg: QboConfig, body: Record<string, string>, fetchImpl: FetchLike, now: number): Promise<QboTokenSet> {
  const res = await fetchImpl(QBO_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basic(cfg), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // invalid_grant = the refresh token was revoked, expired or already used.
    const dead = res.status === 400 && /invalid_grant/.test(text)
    throw new QboAuthError(`QuickBooks token call failed (${res.status})`, dead || res.status === 401)
  }
  const j = (await res.json()) as Partial<QboTokenResponse>
  if (!j.access_token || !j.refresh_token) throw new QboAuthError('QuickBooks returned no token', false)
  return toTokenSet(j as QboTokenResponse, now)
}

export function exchangeQboCode(cfg: QboConfig, code: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, now = Date.now()) {
  return tokenCall(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }, fetchImpl, now)
}

/**
 * Refresh-token rotation: Intuit may hand back a NEW refresh token on any
 * refresh and the old one stops working once the new one is used. The caller
 * must store the returned refreshToken every time (never keep the old one).
 */
export function refreshQboTokens(cfg: QboConfig, refreshToken: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, now = Date.now()) {
  return tokenCall(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl, now)
}

/** Refresh 5 minutes early so a sync never starts on a token about to lapse. */
export function accessTokenStale(accessExpiresAt: string | null | undefined, now = Date.now(), skewMs = 5 * 60_000): boolean {
  if (!accessExpiresAt) return true
  const t = Date.parse(accessExpiresAt)
  return !Number.isFinite(t) || t - skewMs <= now
}

// ── Report parsing (ProfitAndLoss JSON) ──────────────────────────────────

type ColData = { value?: string; id?: string }
type Row = {
  type?: string
  group?: string
  Header?: { ColData?: ColData[] }
  ColData?: ColData[]
  Rows?: { Row?: Row[] }
  Summary?: { ColData?: ColData[] }
}
type Column = { ColTitle?: string; ColType?: string; MetaData?: Array<{ Name?: string; Value?: string }> }
export type QboReport = {
  Header?: { ReportName?: string; StartPeriod?: string; EndPeriod?: string; Currency?: string; ReportBasis?: string }
  Columns?: { Column?: Column[] }
  Rows?: { Row?: Row[] }
}

export type PnlMonth = {
  /** 'YYYY-MM' */
  month: string
  income: number
  cogs: number
  grossProfit: number
  expenses: number
  otherIncome: number
  otherExpenses: number
  netIncome: number
}
export type ExpenseLine = { month: string; category: string; amount: number }

const num = (v: string | undefined) => {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number) => Math.round(n * 100) / 100

/** Value columns other than the first (Account) and the trailing Total. */
function valueColumns(report: QboReport): Array<{ index: number; title: string; start: string | null }> {
  const cols = report.Columns?.Column ?? []
  const out: Array<{ index: number; title: string; start: string | null }> = []
  cols.forEach((c, i) => {
    if (i === 0) return
    const title = String(c.ColTitle ?? '').trim()
    const colKey = c.MetaData?.find((m) => m.Name === 'ColKey')?.Value ?? ''
    if (/^total$/i.test(title) || colKey === 'total') return
    const start = c.MetaData?.find((m) => m.Name === 'StartDate')?.Value ?? null
    out.push({ index: i, title, start })
  })
  return out
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** 'Jan 2026' or a StartDate '2026-01-01' → '2026-01'. */
function monthOf(col: { title: string; start: string | null }): string | null {
  if (col.start && /^\d{4}-\d{2}/.test(col.start)) return col.start.slice(0, 7)
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(col.title)
  if (!m) return null
  const idx = MONTHS.indexOf(m[1].toLowerCase())
  return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, '0')}`
}

function sectionTotals(row: Row): ColData[] {
  return row.Summary?.ColData ?? row.ColData ?? []
}

/** Top-level sections by Intuit's `group` key (Income, COGS, Expenses, …). */
function sections(report: QboReport): Map<string, Row> {
  const m = new Map<string, Row>()
  for (const r of report.Rows?.Row ?? []) if (r.group) m.set(r.group, r)
  return m
}

/**
 * ProfitAndLoss with summarize_column_by=Month → one row per month. Months a
 * company had no activity come back with empty cells and read as zero.
 */
export function parsePnlByMonth(report: QboReport): PnlMonth[] {
  const cols = valueColumns(report)
  const secs = sections(report)
  const val = (group: string, i: number) => num(sectionTotals(secs.get(group) ?? {})[i]?.value)
  const out: PnlMonth[] = []
  for (const c of cols) {
    const month = monthOf(c)
    if (!month) continue
    const income = val('Income', c.index)
    const cogs = val('COGS', c.index)
    const expenses = val('Expenses', c.index)
    const otherIncome = val('OtherIncome', c.index)
    const otherExpenses = val('OtherExpenses', c.index)
    const gp = secs.has('GrossProfit') ? val('GrossProfit', c.index) : income - cogs
    const net = secs.has('NetIncome') ? val('NetIncome', c.index) : gp - expenses + otherIncome - otherExpenses
    out.push({
      month,
      income: round2(income),
      cogs: round2(cogs),
      grossProfit: round2(gp),
      expenses: round2(expenses),
      otherIncome: round2(otherIncome),
      otherExpenses: round2(otherExpenses),
      netIncome: round2(net),
    })
  }
  return out.sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Expenses by category per month: each top-level account under Expenses (and
 * COGS, labelled as such). A parent account with sub-accounts counts once, at
 * its own total.
 */
export function parseExpensesByMonth(report: QboReport): ExpenseLine[] {
  const cols = valueColumns(report)
  const secs = sections(report)
  const out: ExpenseLine[] = []
  const take = (group: string, prefix: string) => {
    const sec = secs.get(group)
    for (const child of sec?.Rows?.Row ?? []) {
      const name = child.type === 'Section' || child.Header ? child.Header?.ColData?.[0]?.value : child.ColData?.[0]?.value
      if (!name) continue
      const cells = child.type === 'Section' || child.Header ? sectionTotals(child) : child.ColData ?? []
      for (const c of cols) {
        const month = monthOf(c)
        if (!month) continue
        const amount = round2(num(cells[c.index]?.value))
        if (amount !== 0) out.push({ month, category: `${prefix}${name}`.slice(0, 200), amount })
      }
    }
  }
  take('Expenses', '')
  take('COGS', 'Cost of sales: ')
  return out
}

/**
 * ProfitAndLoss with summarize_column_by=Customers or Classes, for one
 * period → total income per column (customer or class). Zero columns drop.
 */
export function parseIncomeByColumn(report: QboReport): Array<{ name: string; amount: number }> {
  const cols = valueColumns(report)
  const income = sections(report).get('Income')
  if (!income) return []
  const cells = sectionTotals(income)
  return cols
    .map((c) => ({ name: (c.title || 'Not specified').slice(0, 200), amount: round2(num(cells[c.index]?.value)) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
}
