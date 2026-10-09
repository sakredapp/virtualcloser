/**
 * QuickBooks Online — server side: the connection row, token refresh with
 * rotation, the read-only report sync and what the pages read.
 *
 * READ-ONLY (owner 10-09): every call to Intuit here is a GET of a report or
 * of CompanyInfo. There is no code path that writes to QuickBooks.
 */
import { supabase } from '@/lib/supabase'
import {
  QboAuthError,
  QBO_MINOR_VERSION,
  QBO_REVOKE_URL,
  accessTokenStale,
  decryptToken,
  encryptToken,
  parseExpensesByMonth,
  parseIncomeByColumn,
  parsePnlByMonth,
  qboConfig,
  qboTokenKey,
  refreshQboTokens,
  type QboConfig,
  type QboReport,
  type QboTokenSet,
} from '@/lib/qbo/shared'
import type { QboPanelData } from '@/lib/qbo/display'

export type QboConnectionRow = {
  id: string
  rep_id: string
  realm_id: string
  company_name: string | null
  environment: 'sandbox' | 'production'
  access_token_enc: string
  refresh_token_enc: string
  access_expires_at: string
  refresh_expires_at: string | null
  connected_by_member: string | null
  connected_by_name: string | null
  needs_reconnect: boolean
  last_sync_at: string | null
  last_sync_ok: boolean | null
  last_sync_error: string | null
  created_at: string
}

/** What a page may know about the connection: never a token. */
export type QboStatus = {
  configured: boolean
  connected: boolean
  needsReconnect: boolean
  companyName: string | null
  environment: 'sandbox' | 'production' | null
  connectedByName: string | null
  lastSyncAt: string | null
  lastSyncOk: boolean | null
  lastSyncError: string | null
}

const T_CONN = 'cxo_qbo_connections'
const T_PNL = 'cxo_qbo_pnl_monthly'
const T_EXP = 'cxo_qbo_expense_monthly'
const T_BRK = 'cxo_qbo_revenue_breakdown'

/** A missing table (migration not applied) reads as "not connected", never a crash. */
export function qboTablesMissing(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '')
  const code = String((err as { code?: string })?.code ?? '')
  return code === '42P01' || code === 'PGRST205' || /cxo_qbo_\w+/.test(msg) && /does not exist|schema cache/.test(msg)
}

async function readConnection(repId: string): Promise<QboConnectionRow | null> {
  const { data, error } = await supabase.from(T_CONN).select('*').eq('rep_id', repId).maybeSingle()
  if (error) {
    if (qboTablesMissing(error)) return null
    throw error
  }
  return (data as QboConnectionRow | null) ?? null
}

export async function getQboStatus(repId: string): Promise<QboStatus> {
  const configured = qboConfig() != null
  const row = await readConnection(repId).catch((e) => {
    console.error('[qbo] status', e instanceof Error ? e.message : e)
    return null
  })
  return {
    configured,
    connected: Boolean(row) && !row!.needs_reconnect,
    needsReconnect: Boolean(row?.needs_reconnect),
    companyName: row?.company_name ?? null,
    environment: row?.environment ?? null,
    connectedByName: row?.connected_by_name ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    lastSyncOk: row?.last_sync_ok ?? null,
    lastSyncError: row?.last_sync_error ?? null,
  }
}

export async function saveQboConnection(input: {
  repId: string
  realmId: string
  environment: 'sandbox' | 'production'
  tokens: QboTokenSet
  memberId: string | null
  memberName: string | null
}): Promise<void> {
  const key = qboTokenKey()
  if (!key) throw new Error('No token key (SESSION_SECRET) on this server')
  const { error } = await supabase.from(T_CONN).upsert(
    {
      rep_id: input.repId,
      realm_id: input.realmId,
      environment: input.environment,
      access_token_enc: encryptToken(input.tokens.accessToken, key),
      refresh_token_enc: encryptToken(input.tokens.refreshToken, key),
      access_expires_at: input.tokens.accessExpiresAt,
      refresh_expires_at: input.tokens.refreshExpiresAt,
      connected_by_member: input.memberId,
      connected_by_name: input.memberName,
      needs_reconnect: false,
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'rep_id' },
  )
  if (error) throw error
}

async function markNeedsReconnect(repId: string, why: string) {
  await supabase.from(T_CONN).update({ needs_reconnect: true, last_sync_ok: false, last_sync_error: why, updated_at: new Date().toISOString() }).eq('rep_id', repId)
}

/**
 * A live access token for the org, refreshing when it is within 5 minutes of
 * lapsing. Intuit rotates refresh tokens, so the NEW refresh token is stored
 * on every refresh. The update is conditional on the refresh token we read:
 * if another run refreshed first (0 rows updated), we re-read and use its
 * token instead of overwriting it with ours.
 */
export async function getQboAccessToken(cfg: QboConfig, row: QboConnectionRow, fetchImpl?: Parameters<typeof refreshQboTokens>[2]): Promise<string> {
  const key = qboTokenKey()
  if (!key) throw new QboAuthError('No token key on this server', false)
  if (!accessTokenStale(row.access_expires_at)) {
    const t = decryptToken(row.access_token_enc, key)
    if (t) return t
  }
  const refresh = decryptToken(row.refresh_token_enc, key)
  if (!refresh) {
    await markNeedsReconnect(row.rep_id, 'Stored QuickBooks tokens could not be read. Reconnect QuickBooks.')
    throw new QboAuthError('Stored tokens unreadable', true)
  }
  let next: QboTokenSet
  try {
    next = await refreshQboTokens(cfg, refresh, fetchImpl)
  } catch (e) {
    if (e instanceof QboAuthError && e.reconnect) {
      await markNeedsReconnect(row.rep_id, 'QuickBooks access ended (expired or revoked). Reconnect QuickBooks.')
    }
    throw e
  }
  const { data } = await supabase
    .from(T_CONN)
    .update({
      access_token_enc: encryptToken(next.accessToken, key),
      refresh_token_enc: encryptToken(next.refreshToken, key),
      access_expires_at: next.accessExpiresAt,
      refresh_expires_at: next.refreshExpiresAt ?? row.refresh_expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq('rep_id', row.rep_id)
    .eq('refresh_token_enc', row.refresh_token_enc)
    .select('id')
  if (!data || data.length === 0) {
    const fresh = await readConnection(row.rep_id)
    const t = fresh ? decryptToken(fresh.access_token_enc, key) : null
    if (t) return t
  }
  return next.accessToken
}

/** GET only. There is deliberately no write helper. */
async function qboGet<T>(cfg: QboConfig, row: QboConnectionRow, token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, minorversion: QBO_MINOR_VERSION })
  const url = `${cfg.apiBase}/v3/company/${encodeURIComponent(row.realm_id)}/${path}?${qs.toString()}`
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
  if (res.status === 401) throw new QboAuthError('QuickBooks refused the token', false)
  if (!res.ok) throw new Error(`QuickBooks ${path.split('?')[0]} failed (${res.status})`)
  return (await res.json()) as T
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
function monthStart(y: number, m: number) {
  return new Date(Date.UTC(y, m - 1, 1))
}
function monthEnd(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0))
}

export type QboSyncResult = { ok: boolean; months: number; expenseLines: number; breakdownLines: number; error?: string; skipped?: string }

/**
 * Pull the last 24 months of P&L by month (one report call), expenses by
 * category from the same report, and revenue by customer and by class for
 * each of the last 12 months (classes only when the company uses them).
 * Rows inside the window are replaced; nothing outside it is touched.
 */
export async function syncQbo(repId: string, now = new Date()): Promise<QboSyncResult> {
  const cfg = qboConfig()
  if (!cfg) return { ok: false, months: 0, expenseLines: 0, breakdownLines: 0, skipped: 'not configured' }
  const row = await readConnection(repId)
  if (!row) return { ok: false, months: 0, expenseLines: 0, breakdownLines: 0, skipped: 'not connected' }
  if (row.needs_reconnect) return { ok: false, months: 0, expenseLines: 0, breakdownLines: 0, skipped: 'needs reconnect' }

  try {
    const token = await getQboAccessToken(cfg, row)
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth() + 1
    const startAt = (back: number) => {
      const t = y * 12 + (m - 1) - back
      return { y: Math.floor(t / 12), m: (t % 12) + 1 }
    }
    const from = startAt(23)
    const pnl = await qboGet<QboReport>(cfg, row, token, 'reports/ProfitAndLoss', {
      start_date: ymd(monthStart(from.y, from.m)),
      end_date: ymd(now),
      summarize_column_by: 'Month',
    })
    const months = parsePnlByMonth(pnl)
    const expenses = parseExpensesByMonth(pnl)

    // Company name, best effort (shown on Integrations).
    let companyName = row.company_name
    try {
      const ci = await qboGet<{ CompanyInfo?: { CompanyName?: string } }>(cfg, row, token, `companyinfo/${encodeURIComponent(row.realm_id)}`)
      companyName = ci.CompanyInfo?.CompanyName ?? companyName
    } catch {}

    // Revenue by customer / class, month by month for the last 12 months.
    const breakdown: Array<{ month: string; dimension: 'customer' | 'class'; name: string; amount: number }> = []
    let classesAvailable = true
    for (let back = 11; back >= 0; back--) {
      const p = startAt(back)
      const month = `${p.y}-${String(p.m).padStart(2, '0')}`
      const range = { start_date: ymd(monthStart(p.y, p.m)), end_date: ymd(back === 0 ? now : monthEnd(p.y, p.m)) }
      const byCustomer = await qboGet<QboReport>(cfg, row, token, 'reports/ProfitAndLoss', { ...range, summarize_column_by: 'Customers' })
      for (const r of parseIncomeByColumn(byCustomer)) breakdown.push({ month, dimension: 'customer', ...r })
      if (classesAvailable) {
        try {
          const byClass = await qboGet<QboReport>(cfg, row, token, 'reports/ProfitAndLoss', { ...range, summarize_column_by: 'Classes' })
          for (const r of parseIncomeByColumn(byClass)) breakdown.push({ month, dimension: 'class', ...r })
        } catch {
          classesAvailable = false // class tracking off in this company
        }
      }
    }

    const syncedAt = new Date().toISOString()
    const windowFrom = `${from.y}-${String(from.m).padStart(2, '0')}`
    const bFrom = startAt(11)
    const breakdownFrom = `${bFrom.y}-${String(bFrom.m).padStart(2, '0')}`
    const del1 = await supabase.from(T_PNL).delete().eq('rep_id', repId).gte('month', windowFrom)
    if (del1.error) throw del1.error
    const del2 = await supabase.from(T_EXP).delete().eq('rep_id', repId).gte('month', windowFrom)
    if (del2.error) throw del2.error
    const del3 = await supabase.from(T_BRK).delete().eq('rep_id', repId).gte('month', breakdownFrom)
    if (del3.error) throw del3.error
    if (months.length) {
      const { error } = await supabase.from(T_PNL).insert(
        months.map((p) => ({
          rep_id: repId,
          month: p.month,
          income: p.income,
          cogs: p.cogs,
          gross_profit: p.grossProfit,
          expenses: p.expenses,
          other_income: p.otherIncome,
          other_expenses: p.otherExpenses,
          net_income: p.netIncome,
          synced_at: syncedAt,
        })),
      )
      if (error) throw error
    }
    // Same category can repeat after truncation; merge before insert.
    const expMap = new Map<string, { month: string; category: string; amount: number }>()
    for (const e of expenses) {
      const k = `${e.month}|${e.category}`
      const cur = expMap.get(k)
      expMap.set(k, cur ? { ...cur, amount: cur.amount + e.amount } : e)
    }
    if (expMap.size) {
      const { error } = await supabase.from(T_EXP).insert(Array.from(expMap.values()).map((e) => ({ rep_id: repId, ...e, synced_at: syncedAt })))
      if (error) throw error
    }
    const brkMap = new Map<string, (typeof breakdown)[number]>()
    for (const b of breakdown) {
      const k = `${b.month}|${b.dimension}|${b.name}`
      const cur = brkMap.get(k)
      brkMap.set(k, cur ? { ...cur, amount: cur.amount + b.amount } : b)
    }
    if (brkMap.size) {
      const { error } = await supabase.from(T_BRK).insert(Array.from(brkMap.values()).map((b) => ({ rep_id: repId, ...b, synced_at: syncedAt })))
      if (error) throw error
    }
    await supabase
      .from(T_CONN)
      .update({ company_name: companyName, last_sync_at: syncedAt, last_sync_ok: true, last_sync_error: null, updated_at: syncedAt })
      .eq('rep_id', repId)
    return { ok: true, months: months.length, expenseLines: expMap.size, breakdownLines: brkMap.size }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[qbo] sync', repId, msg)
    if (!(e instanceof QboAuthError && e.reconnect)) {
      await supabase.from(T_CONN).update({ last_sync_ok: false, last_sync_error: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('rep_id', repId)
    }
    return { ok: false, months: 0, expenseLines: 0, breakdownLines: 0, error: msg }
  }
}

/** Every org with a live connection (the daily cron). */
export async function listQboRepIds(): Promise<string[]> {
  const { data, error } = await supabase.from(T_CONN).select('rep_id').eq('needs_reconnect', false)
  if (error) {
    if (qboTablesMissing(error)) return []
    throw error
  }
  return ((data ?? []) as Array<{ rep_id: string }>).map((r) => r.rep_id)
}

/**
 * Disconnect: revoke at Intuit (best effort), then delete the tokens and
 * every synced figure for the org. Nothing of their books stays behind.
 */
export async function disconnectQbo(repId: string): Promise<void> {
  const row = await readConnection(repId)
  const cfg = qboConfig()
  const key = qboTokenKey()
  if (row && cfg && key) {
    const refresh = decryptToken(row.refresh_token_enc, key)
    if (refresh) {
      try {
        await fetch(QBO_REVOKE_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: refresh }),
        })
      } catch (e) {
        console.error('[qbo] revoke', e instanceof Error ? e.message : e)
      }
    }
  }
  for (const t of [T_PNL, T_EXP, T_BRK, T_CONN]) {
    const { error } = await supabase.from(t).delete().eq('rep_id', repId)
    if (error && !qboTablesMissing(error)) throw error
  }
}

// ── Reads for the pages and Mira ─────────────────────────────────────────

export type QboMonth = {
  month: string
  income: number
  cogs: number
  gross_profit: number
  expenses: number
  other_income: number
  other_expenses: number
  net_income: number
}
export type QboView = {
  status: QboStatus
  months: QboMonth[]
  /** Expense categories summed over the last 12 synced months, largest first. */
  expenseCategories: Array<{ category: string; amount: number }>
  topCustomers: Array<{ name: string; amount: number }>
  classes: Array<{ name: string; amount: number }>
}

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

export async function loadQboMonths(repId: string, from?: string, to?: string): Promise<QboMonth[]> {
  let q = supabase.from(T_PNL).select('month, income, cogs, gross_profit, expenses, other_income, other_expenses, net_income').eq('rep_id', repId)
  if (from) q = q.gte('month', from)
  if (to) q = q.lte('month', to)
  const { data, error } = await q.order('month', { ascending: true })
  if (error) {
    if (qboTablesMissing(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    month: String(r.month),
    income: n(r.income),
    cogs: n(r.cogs),
    gross_profit: n(r.gross_profit),
    expenses: n(r.expenses),
    other_income: n(r.other_income),
    other_expenses: n(r.other_expenses),
    net_income: n(r.net_income),
  }))
}

export async function loadExpenseCategories(repId: string, from: string, to: string): Promise<Array<{ category: string; amount: number }>> {
  const { data, error } = await supabase.from(T_EXP).select('category, amount').eq('rep_id', repId).gte('month', from).lte('month', to)
  if (error) {
    if (qboTablesMissing(error)) return []
    throw error
  }
  const m = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ category: string; amount: unknown }>) m.set(r.category, (m.get(r.category) ?? 0) + n(r.amount))
  return Array.from(m, ([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
}

export async function loadBreakdown(repId: string, dimension: 'customer' | 'class', from: string, to: string): Promise<Array<{ name: string; amount: number }>> {
  const { data, error } = await supabase.from(T_BRK).select('name, amount').eq('rep_id', repId).eq('dimension', dimension).gte('month', from).lte('month', to)
  if (error) {
    if (qboTablesMissing(error)) return []
    throw error
  }
  const m = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ name: string; amount: unknown }>) m.set(r.name, (m.get(r.name) ?? 0) + n(r.amount))
  return Array.from(m, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
}

export async function loadQboView(repId: string): Promise<QboView> {
  const status = await getQboStatus(repId)
  if (!status.connected) return { status, months: [], expenseCategories: [], topCustomers: [], classes: [] }
  const months = (await loadQboMonths(repId)).slice(-24)
  const last12 = months.slice(-12)
  const from = last12[0]?.month ?? '0000-00'
  const to = last12[last12.length - 1]?.month ?? '9999-99'
  const [expenseCategories, topCustomers, classes] = await Promise.all([
    loadExpenseCategories(repId, from, to),
    loadBreakdown(repId, 'customer', from, to),
    loadBreakdown(repId, 'class', from, to),
  ])
  return { status, months, expenseCategories: expenseCategories.slice(0, 8), topCustomers: topCustomers.slice(0, 8), classes: classes.slice(0, 8) }
}

/** Everything the "From QuickBooks" panel needs; never a token. */
export async function loadQboPanelData(repId: string): Promise<QboPanelData> {
  const v = await loadQboView(repId).catch((e) => {
    console.error('[qbo] panel', e instanceof Error ? e.message : e)
    return null
  })
  const status = v?.status ?? (await getQboStatus(repId))
  return {
    configured: status.configured,
    connected: status.connected,
    needsReconnect: status.needsReconnect,
    companyName: status.companyName,
    environment: status.environment,
    lastSyncAt: status.lastSyncAt,
    lastSyncOk: status.lastSyncOk,
    months: v?.months ?? [],
    expenseCategories: v?.expenseCategories ?? [],
    topCustomers: v?.topCustomers ?? [],
    classes: v?.classes ?? [],
  }
}
