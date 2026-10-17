/**
 * Monthly board update (Suite CXO, Ciao): the database half. Runs on the
 * Hetzner worker (hetzner-worker/index.ts, CXO_BOARD_UPDATE_EVERY_N_TICKS)
 * and on demand through Ciao's `board_update` tool and /api/board-update.
 *
 *  - From 8am on the first business day of the month (company zone), Ciao
 *    drafts last month's investor / board update into cxo_board_updates and
 *    tells the owner and admins in one in-app notice.
 *  - Headline numbers vs plan and vs last year come from deterministic
 *    rollups: the book (only on tenants allowed to read it), the sales plan
 *    (cxo_plan_targets) and QuickBooks (cxo_qbo_pnl_monthly), whichever the
 *    tenant has. Wins and misses from goals, monthly KPIs and board cards;
 *    decisions from cxo_decisions. Model-free, cost 0.
 *  - Ciao never sends it. The exec edits it in the app, copies it and sends it.
 *
 * Rules kept here:
 *  - Every read and write carries rep_id. Owners and admins with money access
 *    only (canSeeBoardUpdate), never employees.
 *  - Once per company per month: (rep_id, month) is unique and each notice
 *    key is a lock (unique rep_id + key). No notice when there is nothing to say.
 *  - Kill switch CXO_BOARD_UPDATE=off. Until the table exists, a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices } from '@/lib/followups/engine'
import { assistantNameForIds } from '@/lib/assistantNameServer'
import { assistantNameWithCompany } from '@/lib/assistantNameFromRows'
import { isPaused } from '@/lib/followups/shared'
import { getPinnacleOverview } from '@/lib/pinnacle/cache'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { listTargets } from '@/lib/plan/data'
import { planByMonth } from '@/lib/plan/shared'
import { loadQboMonths } from '@/lib/qbo/data'
import { attainment } from '@/lib/employees/shared'
import {
  BOARD_UPDATE_ANCHOR,
  BOARD_UPDATE_ROLES,
  boardUpdateOn,
  canSeeBoardUpdate,
  composeSections,
  composeText,
  coveredMonth,
  hasContent,
  isDraftTime,
  localDate,
  monthBounds,
  nextBody,
  noticeKey,
  noticeText,
  parseMonthKey,
  shiftMonth,
  type BoardFacts,
  type BoardSections,
  type Money2,
  type QboSlice,
} from './shared'

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

const T = 'cxo_board_updates'
const COLS = 'id, rep_id, month, sections, draft_text, body, status, edited, generated_at, edited_at, sent_at'

export type BoardUpdateRow = {
  id: string
  rep_id: string
  month: string
  sections: BoardSections
  draft_text: string
  body: string
  status: 'draft' | 'edited' | 'sent'
  edited: boolean
  generated_at: string
  edited_at: string | null
  sent_at: string | null
}

export type BoardTenant = { id: string; timezone?: string | null; company?: string | null; display_name?: string | null }

const n = (v: unknown) => Number(v) || 0
const safe = async <T>(p: Promise<T>, fallback: T, what: string): Promise<T> => {
  try {
    return await p
  } catch (err) {
    console.error('[board-update]', what, err instanceof Error ? err.message : err)
    return fallback
  }
}

// ── Gathering ──────────────────────────────────────────────────────────────

async function bookFacts(tenant: BoardTenant, month: string): Promise<BoardFacts['book']> {
  if (!pinnacleAllowed(tenant.id)) return null
  const overview = await safe(getPinnacleOverview(tenant.id, { view: 'overview', tz: tenant.timezone }), null, 'book')
  const rows = overview && overview.configured ? overview.pinnacleRows : []
  if (!rows.length) return null
  const { year } = parseMonthKey(month)!
  const b = monthBounds(month, 'UTC')
  const ly = monthBounds(shiftMonth(month, -12), 'UTC')
  let earliest: string | null = null
  let through: string | null = null
  const sum = (start: string, end: string): Money2 => {
    const t = { premium: 0, policies: 0 }
    for (const r of rows) {
      if (r.d < start || r.d > end) continue
      t.premium += n(r.premium)
      t.policies += n(r.policies)
    }
    return t
  }
  for (const r of rows) {
    if (!earliest || r.d < earliest) earliest = r.d
    if (r.d <= b.endDate && (!through || r.d > through)) through = r.d
  }
  const hasLy = (start: string) => !!earliest && earliest <= start
  const lyYtdStart = `${year - 1}-01-01`
  return {
    month: sum(b.startDate, b.endDate),
    monthLastYear: hasLy(ly.startDate) ? sum(ly.startDate, ly.endDate) : null,
    ytd: sum(`${year}-01-01`, b.endDate),
    ytdLastYear: hasLy(lyYtdStart) ? sum(lyYtdStart, ly.endDate) : null,
    through,
  }
}

async function planFacts(repId: string, month: string): Promise<BoardFacts['plan']> {
  const { year, month: m } = parseMonthKey(month)!
  const targets = await safe(listTargets(repId, year), [], 'plan')
  if (!targets.length) return null
  const byMonth = planByMonth(targets)
  const ytd = byMonth.slice(0, m).reduce((s, v) => s + v, 0)
  if (ytd <= 0 && byMonth[m - 1] <= 0) return null
  return { month: byMonth[m - 1], ytd }
}

async function qboFacts(repId: string, month: string): Promise<BoardFacts['qbo']> {
  const { year } = parseMonthKey(month)!
  const rows = await safe(loadQboMonths(repId, `${year - 1}-01`, month), [], 'quickbooks')
  if (!rows.length) return null
  const slice = (r: { income: number; net_income: number }): QboSlice => ({ income: n(r.income), net_income: n(r.net_income) })
  const by = new Map(rows.map((r) => [String(r.month).slice(0, 7), r]))
  const lyMonth = shiftMonth(month, -12)
  const sumRange = (from: string, to: string): QboSlice | null => {
    let any = false
    const t = { income: 0, net_income: 0 }
    for (const [k, r] of by) {
      if (k < from || k > to) continue
      any = true
      t.income += n(r.income)
      t.net_income += n(r.net_income)
    }
    return any ? t : null
  }
  const ytd = sumRange(`${year}-01`, month)
  const cur = by.get(month)
  if (!ytd && !cur) return null
  return {
    month: cur ? slice(cur) : null,
    monthLastYear: by.get(lyMonth) ? slice(by.get(lyMonth)!) : null,
    ytd: ytd ?? { income: 0, net_income: 0 },
    ytdLastYear: sumRange(`${year - 1}-01`, lyMonth),
  }
}

async function workFacts(repId: string, month: string, tz: string | null | undefined): Promise<Pick<BoardFacts, 'goalsDone' | 'goalsMissed' | 'kpis' | 'cardsDone' | 'cardsMissed' | 'decisions'>> {
  const b = monthBounds(month, tz)
  const [gDone, gMissed, kpis, actuals, cDone, cDue, dec] = await Promise.all([
    supabase.from('cxo_goals').select('title').eq('rep_id', repId).eq('status', 'done').gte('updated_at', b.startIso).lt('updated_at', b.endIso).order('updated_at', { ascending: true }).limit(50),
    supabase.from('cxo_goals').select('title').eq('rep_id', repId).eq('status', 'active').gte('due_date', b.startDate).lte('due_date', b.endDate).limit(50),
    supabase.from('cxo_employee_kpis').select('id, target, lower_is_better').eq('rep_id', repId).eq('period', 'month').limit(2000),
    supabase.from('cxo_kpi_actuals').select('kpi_id, actual').eq('rep_id', repId).eq('period_key', month).limit(5000),
    supabase.from('cxo_board_cards').select('title', { count: 'exact' }).eq('rep_id', repId).gte('done_at', b.startIso).lt('done_at', b.endIso).order('done_at', { ascending: true }).limit(MAX_TITLES),
    supabase.from('cxo_board_cards').select('title, done_at').eq('rep_id', repId).gte('due_date', b.startDate).lte('due_date', b.endDate).limit(500),
    supabase.from('cxo_decisions').select('text, meeting_title, decided_at').eq('rep_id', repId).is('reversed_by_id', null).gte('decided_at', b.startIso).lt('decided_at', b.endIso).order('decided_at', { ascending: true }).limit(20),
  ])
  const titles = (r: { data: unknown }) => ((r.data ?? []) as Array<{ title: string | null }>).map((x) => String(x.title ?? '').trim()).filter(Boolean)

  const kpiById = new Map(((kpis.data ?? []) as Array<{ id: string; target: number | null; lower_is_better: boolean | null }>).map((k) => [k.id, k]))
  let hit = 0
  let missedK = 0
  for (const a of (actuals.data ?? []) as Array<{ kpi_id: string; actual: number | null }>) {
    const k = kpiById.get(a.kpi_id)
    if (!k) continue
    const att = attainment({ target: n(k.target), lower_is_better: !!k.lower_is_better }, a.actual == null ? null : Number(a.actual))
    if (att == null) continue
    if (att >= 1) hit++
    else missedK++
  }

  const dueRows = (cDue.data ?? []) as Array<{ title: string | null; done_at: string | null }>
  const lateOrOpen = dueRows.filter((c) => !c.done_at || c.done_at >= b.endIso)
  return {
    goalsDone: titles(gDone),
    goalsMissed: titles(gMissed),
    kpis: { hit, missed: missedK },
    cardsDone: { count: cDone.count ?? titles(cDone).length, titles: titles(cDone) },
    cardsMissed: { count: lateOrOpen.length, titles: lateOrOpen.map((c) => String(c.title ?? '').trim()).filter(Boolean).slice(0, MAX_TITLES) },
    decisions: ((dec.data ?? []) as Array<{ text: string; meeting_title: string | null; decided_at: string }>).filter((d) => String(d.text ?? '').trim()),
  }
}
const MAX_TITLES = 5

/** Every fact the draft uses for one month, from rollups only. */
export async function gatherFacts(tenant: BoardTenant, month: string): Promise<BoardFacts> {
  const [book, plan, qbo, work] = await Promise.all([
    bookFacts(tenant, month),
    planFacts(tenant.id, month),
    qboFacts(tenant.id, month),
    workFacts(tenant.id, month, tenant.timezone),
  ])
  return { month, company: tenant.company || tenant.display_name || null, book, plan, qbo, ...work }
}

// ── Rows ───────────────────────────────────────────────────────────────────

export async function getBoardUpdate(repId: string, month?: string | null): Promise<BoardUpdateRow | null> {
  let q = supabase.from(T).select(COLS).eq('rep_id', repId)
  if (month) q = q.eq('month', month)
  const { data, error } = await q.order('month', { ascending: false }).limit(1)
  if (missing(error)) return null
  if (error) throw new Error(`${T}: ${error.message}`)
  return ((data ?? []) as BoardUpdateRow[])[0] ?? null
}

export type DraftResult = { row: BoardUpdateRow | null; created: boolean; regenerated: boolean; tableMissing?: boolean }

/**
 * Draft (or redraft) the update for one month. Without `regenerate` an
 * existing draft is returned as is. Regenerating refreshes the numbers and
 * keeps the exec's own edited text unless keepEdits is false.
 */
export async function draftBoardUpdate(
  tenant: BoardTenant,
  month: string,
  opts: { regenerate?: boolean; keepEdits?: boolean; by?: string | null; now?: Date; sections?: BoardSections } = {},
): Promise<DraftResult> {
  if (!parseMonthKey(month)) throw new Error(`bad month ${month}`)
  const now = opts.now ?? new Date()
  const { data: have, error: hErr } = await supabase.from(T).select(COLS).eq('rep_id', tenant.id).eq('month', month).limit(1)
  if (missing(hErr)) return { row: null, created: false, regenerated: false, tableMissing: true }
  if (hErr) throw new Error(`${T}: ${hErr.message}`)
  const current = ((have ?? []) as BoardUpdateRow[])[0] ?? null
  if (current && !opts.regenerate) return { row: current, created: false, regenerated: false }

  const sections = opts.sections ?? composeSections(await gatherFacts(tenant, month))
  // A company document: the company's name for the assistant.
  const draftText = composeText(sections, await assistantNameForIds(tenant.id))
  if (!current) {
    const { data, error } = await supabase
      .from(T)
      .upsert([{ rep_id: tenant.id, month, sections, draft_text: draftText, body: draftText, status: 'draft', edited: false, generated_at: now.toISOString(), generated_by: opts.by ?? null, updated_at: now.toISOString() }], {
        onConflict: 'rep_id,month',
        ignoreDuplicates: true,
      })
      .select(COLS)
    if (missing(error)) return { row: null, created: false, regenerated: false, tableMissing: true }
    if (error) throw new Error(`${T}: ${error.message}`)
    const row = ((data ?? []) as BoardUpdateRow[])[0]
    if (row) return { row, created: true, regenerated: false }
    return { row: await getBoardUpdate(tenant.id, month), created: false, regenerated: false } // another check got there first
  }
  const body = nextBody(current, draftText, opts.keepEdits !== false)
  const { data, error } = await supabase
    .from(T)
    .update({
      sections,
      draft_text: draftText,
      body: body.body,
      edited: body.edited,
      status: current.status === 'sent' ? 'sent' : body.edited ? 'edited' : 'draft',
      generated_at: now.toISOString(),
      generated_by: opts.by ?? null,
      updated_at: now.toISOString(),
    })
    .eq('rep_id', tenant.id)
    .eq('id', current.id)
    .select(COLS)
  if (error) throw new Error(`${T}: ${error.message}`)
  return { row: ((data ?? []) as BoardUpdateRow[])[0] ?? null, created: false, regenerated: true }
}

export async function saveBoardUpdate(repId: string, memberId: string, id: string, body: string): Promise<BoardUpdateRow | null> {
  const now = new Date().toISOString()
  const { data: cur } = await supabase.from(T).select('status').eq('rep_id', repId).eq('id', id).limit(1)
  const wasSent = ((cur ?? []) as Array<{ status: string }>)[0]?.status === 'sent'
  const { data, error } = await supabase
    .from(T)
    .update({ body, edited: true, status: wasSent ? 'sent' : 'edited', edited_at: now, edited_by: memberId, updated_at: now })
    .eq('rep_id', repId)
    .eq('id', id)
    .select(COLS)
  if (missing(error)) return null
  if (error) throw new Error(`${T}: ${error.message}`)
  return ((data ?? []) as BoardUpdateRow[])[0] ?? null
}

/** The exec's own note that they sent it themselves. Ciao sends nothing. */
export async function markBoardUpdateSent(repId: string, id: string, sent = true): Promise<BoardUpdateRow | null> {
  const now = new Date().toISOString()
  const { data: cur } = await supabase.from(T).select('edited').eq('rep_id', repId).eq('id', id).limit(1)
  const edited = !!((cur ?? []) as Array<{ edited: boolean }>)[0]?.edited
  const { data, error } = await supabase
    .from(T)
    .update(sent ? { status: 'sent', sent_at: now, updated_at: now } : { status: edited ? 'edited' : 'draft', sent_at: null, updated_at: now })
    .eq('rep_id', repId)
    .eq('id', id)
    .select(COLS)
  if (missing(error)) return null
  if (error) throw new Error(`${T}: ${error.message}`)
  return ((data ?? []) as BoardUpdateRow[])[0] ?? null
}

// ── The tick ───────────────────────────────────────────────────────────────

type TenantRow = { id: string; brand: string | null; timezone: string | null; company: string | null; display_name: string | null }
type MemberRow = { id: string; role: string | null; settings: Record<string, unknown> | null }

/** Months already handled in this process, per tenant. */
const handled = new Set<string>()

async function notifyExecs(tenant: TenantRow, row: BoardUpdateRow, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from('members')
    .select('id, role, settings')
    .eq('rep_id', tenant.id)
    .eq('is_active', true)
    .in('role', [...BOARD_UPDATE_ROLES])
    .limit(200)
  if (error) throw new Error(error.message)
  const execs = ((data ?? []) as MemberRow[]).filter((m) => canSeeBoardUpdate(m) && !isPaused(m, now))
  if (!execs.length) return 0
  const company = await assistantNameForIds(tenant.id)
  const rows = await insertNotices(
    execs.map((m) => {
      const text = noticeText(row.sections, assistantNameWithCompany(company, m.settings))
      return {
        rep_id: tenant.id,
        member_id: m.id,
        key: noticeKey(row.month, m.id),
        kind: 'report',
        item_kind: 'report',
        item_id: row.id,
        title: text.title.slice(0, 300),
        body: text.body.slice(0, 8000),
        href: `/dashboard#${BOARD_UPDATE_ANCHOR}`,
        due_date: null,
      }
    }),
  )
  return rows.length
}

async function tenantTick(tenant: TenantRow, now: Date): Promise<{ drafted: number; notices: number }> {
  const tz = tenant.timezone || 'America/New_York'
  if (!isDraftTime(now, tz)) return { drafted: 0, notices: 0 }
  const month = coveredMonth(now, tz)
  const lock = `${tenant.id}:${month}`
  const emptyLock = `${lock}:empty:${localDate(now, tz)}`
  if (handled.has(lock) || handled.has(emptyLock)) return { drafted: 0, notices: 0 }
  const { data: have, error: hErr } = await supabase.from(T).select(COLS).eq('rep_id', tenant.id).eq('month', month).limit(1)
  if (hErr) {
    if (missing(hErr)) throw new TableMissing()
    throw new Error(hErr.message)
  }
  let row: BoardUpdateRow | null = ((have ?? []) as BoardUpdateRow[])[0] ?? null
  let drafted = 0
  if (!row) {
    // Nothing to say (no numbers, wins, misses or decisions): no draft, no notice.
    const sections = composeSections(await gatherFacts(tenant, month))
    if (!hasContent(sections)) {
      // Look again tomorrow (QuickBooks or the book may sync later), not every tick.
      handled.add(emptyLock)
      return { drafted: 0, notices: 0 }
    }
    const res = await draftBoardUpdate(tenant, month, { now, sections })
    if (res.tableMissing) throw new TableMissing()
    row = res.row
    if (res.created) drafted = 1
  }
  handled.add(lock)
  if (!row || !hasContent(row.sections)) return { drafted, notices: 0 }
  // Notice keys are locks: an exec who already got this month's notice gets no second one.
  return { drafted, notices: await notifyExecs(tenant, row, now) }
}

export type BoardUpdateTickResult = { tenants: number; drafted: number; notices: number; errors: number }

/** One check across every Suite CXO tenant. Never throws. */
export async function runBoardUpdateTick(now = new Date()): Promise<BoardUpdateTickResult> {
  const out: BoardUpdateTickResult = { tenants: 0, drafted: 0, notices: 0, errors: 0 }
  if (!boardUpdateOn()) return out
  const { data, error } = await supabase.from('reps').select('id, brand, timezone, company, display_name').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[board-update] tenants', error.message)
    out.errors++
    return out
  }
  for (const tenant of (data ?? []) as TenantRow[]) {
    try {
      out.tenants++
      const r = await tenantTick(tenant, now)
      out.drafted += r.drafted
      out.notices += r.notices
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[board-update] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** For Ciao's tool and the API: the month a fresh draft covers right now. */
export function currentBoardMonth(now: Date, tz: string | null | undefined): string {
  return coveredMonth(now, tz)
}
