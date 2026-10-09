import { describe, expect, it, vi } from 'vitest'
import {
  QBO_DEFAULT_REDIRECT,
  QBO_NOT_SET_UP,
  QBO_SCOPE,
  QBO_TOKEN_URL,
  QboAuthError,
  accessTokenStale,
  buildQboAuthUrl,
  decryptToken,
  encryptToken,
  parseExpensesByMonth,
  parseIncomeByColumn,
  parsePnlByMonth,
  qboConfig,
  qboTokenKey,
  refreshQboTokens,
  signQboState,
  verifyQboState,
  type QboReport,
} from '@/lib/qbo/shared'
import { lastQuarter, marginPct, resolvePeriod, summarizeQboPeriod } from '@/lib/qbo/display'
import { canDisconnectQbo, canSeeFinancials, safeQboReturn } from '@/lib/qbo/access'
import sample from './fixtures/qbo-pnl-by-month.sample.json'

const ENV = { QBO_CLIENT_ID: 'sample-id', QBO_CLIENT_SECRET: 'sample-secret', QBO_ENVIRONMENT: 'sandbox' }

describe('not configured', () => {
  it('reads as not set up unless id, secret and a valid environment are all present', () => {
    expect(qboConfig({})).toBeNull()
    expect(qboConfig({ ...ENV, QBO_CLIENT_ID: '' })).toBeNull()
    expect(qboConfig({ ...ENV, QBO_CLIENT_SECRET: '  ' })).toBeNull()
    expect(qboConfig({ ...ENV, QBO_ENVIRONMENT: undefined })).toBeNull()
    expect(qboConfig({ ...ENV, QBO_ENVIRONMENT: 'staging' })).toBeNull()
    expect(QBO_NOT_SET_UP).toBe("QuickBooks isn't set up yet")
  })

  it('sandbox and production pick the right API base and the apex redirect by default', () => {
    const s = qboConfig(ENV)!
    expect(s.apiBase).toBe('https://sandbox-quickbooks.api.intuit.com')
    expect(s.redirectUri).toBe(QBO_DEFAULT_REDIRECT)
    expect(QBO_DEFAULT_REDIRECT).toBe('https://suitecxo.com/api/integrations/quickbooks/callback')
    const p = qboConfig({ ...ENV, QBO_ENVIRONMENT: 'Production' })!
    expect(p.apiBase).toBe('https://quickbooks.api.intuit.com')
  })

  it('asks only for the accounting scope', () => {
    const url = new URL(buildQboAuthUrl(qboConfig(ENV)!, 'st'))
    expect(url.searchParams.get('scope')).toBe(QBO_SCOPE)
    expect(QBO_SCOPE).toBe('com.intuit.quickbooks.accounting')
    expect(url.searchParams.get('redirect_uri')).toBe(QBO_DEFAULT_REDIRECT)
    expect(url.searchParams.get('state')).toBe('st')
  })
})

describe('OAuth state', () => {
  const secret = 'test-secret'
  it('round-trips and is bound to rep + member', () => {
    const st = signQboState(secret, { repId: 'rep_x', memberId: 'm1', ret: '/dashboard/revenue' }, 1_000)
    expect(verifyQboState(secret, st, 2_000)).toEqual({ repId: 'rep_x', memberId: 'm1', ret: '/dashboard/revenue' })
  })
  it('rejects tampering, a wrong secret and expiry', () => {
    const st = signQboState(secret, { repId: 'rep_x', memberId: 'm1' }, 1_000)
    expect(verifyQboState('other', st, 2_000)).toBeNull()
    expect(verifyQboState(secret, st.slice(0, -2) + 'xx', 2_000)).toBeNull()
    expect(verifyQboState(secret, st, 1_000 + 16 * 60_000)).toBeNull()
  })
  it('keeps returns on the dashboard', () => {
    expect(safeQboReturn('/dashboard/plan')).toBe('/dashboard/plan')
    expect(safeQboReturn('https://evil.example')).toBe('/dashboard/integrations')
    expect(safeQboReturn('//evil.example')).toBe('/dashboard/integrations')
  })
})

describe('token encryption', () => {
  it('round-trips, and a wrong key or tampered value reads null', () => {
    const key = qboTokenKey({ QBO_TOKEN_KEY: 'k1' })!
    const enc = encryptToken('refresh-abc', key)
    expect(enc).not.toContain('refresh-abc')
    expect(decryptToken(enc, key)).toBe('refresh-abc')
    expect(decryptToken(enc, qboTokenKey({ QBO_TOKEN_KEY: 'k2' })!)).toBeNull()
    expect(decryptToken(enc.slice(0, -3) + 'AAA', key)).toBeNull()
  })
  it('falls back to SESSION_SECRET, and has no key with nothing set', () => {
    expect(qboTokenKey({ SESSION_SECRET: 's' })).not.toBeNull()
    expect(qboTokenKey({})).toBeNull()
  })
})

describe('token refresh', () => {
  const cfg = qboConfig(ENV)!
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })

  it('posts a refresh_token grant with Basic auth and returns the ROTATED refresh token', async () => {
    const fetchImpl = vi.fn(async () => ok({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600, x_refresh_token_expires_in: 8_640_000 }))
    const now = Date.parse('2026-10-09T12:00:00Z')
    const t = await refreshQboTokens(cfg, 'old-refresh', fetchImpl, now)
    expect(t.refreshToken).toBe('rotated-refresh')
    expect(t.accessToken).toBe('new-access')
    expect(t.accessExpiresAt).toBe('2026-10-09T13:00:00.000Z')
    expect(t.refreshExpiresAt).not.toBeNull()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }]
    expect(url).toBe(QBO_TOKEN_URL)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('sample-id:sample-secret').toString('base64')}`)
    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old-refresh')
  })

  it('invalid_grant means reconnect; a server error does not', async () => {
    const bad = (status: number, text: string) => vi.fn(async () => ({ ok: false, status, json: async () => ({}), text: async () => text }))
    await expect(refreshQboTokens(cfg, 'x', bad(400, '{"error":"invalid_grant"}'))).rejects.toMatchObject({ reconnect: true })
    await expect(refreshQboTokens(cfg, 'x', bad(500, 'oops'))).rejects.toMatchObject({ reconnect: false })
    await expect(refreshQboTokens(cfg, 'x', bad(500, 'oops'))).rejects.toBeInstanceOf(QboAuthError)
  })

  it('treats a token as stale 5 minutes before it lapses', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    expect(accessTokenStale(null, now)).toBe(true)
    expect(accessTokenStale('2026-10-09T12:04:00Z', now)).toBe(true)
    expect(accessTokenStale('2026-10-09T12:30:00Z', now)).toBe(false)
  })
})

describe('ProfitAndLoss parsing (labelled sample)', () => {
  const report = sample as unknown as QboReport

  it('one row per month; the total column is ignored; empty months read zero', () => {
    const rows = parsePnlByMonth(report)
    expect(rows.map((r) => r.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(rows[0]).toEqual({ month: '2026-01', income: 12000, cogs: 2000, grossProfit: 10000, expenses: 6000, otherIncome: 0, otherExpenses: 100, netIncome: 3900 })
    expect(rows[1].netIncome).toBe(6400)
    expect(rows[2]).toMatchObject({ income: 0, expenses: 0, netIncome: 0 })
  })

  it('expenses by top-level category; a parent with sub-accounts counts once', () => {
    const lines = parseExpensesByMonth(report)
    const jan = lines.filter((l) => l.month === '2026-01')
    expect(jan).toEqual(
      expect.arrayContaining([
        { month: '2026-01', category: 'SAMPLE Rent', amount: 3000 },
        { month: '2026-01', category: 'SAMPLE Payroll', amount: 3000 },
        { month: '2026-01', category: 'Cost of sales: SAMPLE Agent Payouts', amount: 2000 },
      ]),
    )
    expect(jan).toHaveLength(3)
    expect(lines.some((l) => l.month === '2026-03')).toBe(false)
  })

  it('income by column (customer/class report), zeros dropped, largest first', () => {
    const byCol: QboReport = {
      Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'SAMPLE Class A' }, { ColTitle: 'SAMPLE Class B' }, { ColTitle: '' }, { ColTitle: 'Total', MetaData: [{ Name: 'ColKey', Value: 'total' }] }] },
      Rows: { Row: [{ group: 'Income', Summary: { ColData: [{ value: 'Total Income' }, { value: '100' }, { value: '250.5' }, { value: '0' }, { value: '350.5' }] } }] },
    }
    expect(parseIncomeByColumn(byCol)).toEqual([
      { name: 'SAMPLE Class B', amount: 250.5 },
      { name: 'SAMPLE Class A', amount: 100 },
    ])
  })

  it('summarises a period with margins (what Mira reads)', () => {
    const months = parsePnlByMonth(report).map((r) => ({
      month: r.month, income: r.income, cogs: r.cogs, gross_profit: r.grossProfit, expenses: r.expenses,
      other_income: r.otherIncome, other_expenses: r.otherExpenses, net_income: r.netIncome,
    }))
    const s = summarizeQboPeriod(months, resolvePeriod('q1 2026', '2026-10-09'))
    expect(s).toMatchObject({ period: 'Q1 2026', revenue: 27000, grossProfit: 22500, netIncome: 10300, operatingAndOtherExpenses: 12200 })
    expect(s.netMarginPct).toBe(38.1)
    expect(s.grossMarginPct).toBe(83.3)
    expect(s.monthsCovered).toEqual(['2026-01', '2026-02', '2026-03'])
  })
})

describe('periods and margin', () => {
  it('margin is null without revenue', () => {
    expect(marginPct(10, 0)).toBeNull()
    expect(marginPct(25, 100)).toBe(25)
  })
  it('last quarter, including across a year boundary', () => {
    expect(lastQuarter('2026-10-09')).toEqual({ label: 'Q3 2026', from: '2026-07', to: '2026-09' })
    expect(lastQuarter('2026-02-01')).toEqual({ label: 'Q4 2025', from: '2025-10', to: '2025-12' })
  })
  it('spoken periods', () => {
    const t = '2026-10-09'
    expect(resolvePeriod('last quarter', t).label).toBe('Q3 2026')
    expect(resolvePeriod('2026 q2', t)).toMatchObject({ from: '2026-04', to: '2026-06' })
    expect(resolvePeriod('ytd', t)).toMatchObject({ from: '2026-01', to: '2026-10' })
    expect(resolvePeriod('last_month', t)).toMatchObject({ from: '2026-09', to: '2026-09' })
    expect(resolvePeriod('last_12_months', t)).toMatchObject({ from: '2025-10', to: '2026-09' })
    expect(resolvePeriod('2025', t)).toMatchObject({ from: '2025-01', to: '2025-12' })
    expect(resolvePeriod('gibberish', t).label).toBe('Q3 2026')
  })
})

describe('who can see and disconnect', () => {
  it('financials follow the comp rule; disconnect is owner only', () => {
    expect(canSeeFinancials({ role: 'owner' })).toBe(true)
    expect(canSeeFinancials({ role: 'admin' })).toBe(true)
    expect(canSeeFinancials({ role: 'member' })).toBe(false)
    expect(canSeeFinancials({ role: 'member', settings: { can_view_comp: true } })).toBe(true)
    expect(canSeeFinancials({ role: 'admin', settings: { can_view_comp: false } })).toBe(false)
    expect(canSeeFinancials(null)).toBe(false)
    expect(canDisconnectQbo({ role: 'owner' })).toBe(true)
    expect(canDisconnectQbo({ role: 'admin' })).toBe(false)
  })
})
