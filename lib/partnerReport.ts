/**
 * "Send a report" — the one place a partner-facing number is written.
 *
 * Mira, the MCP server and the Partners page all call composePartnerReport
 * with the same inputs (lines × windows) and get the same deterministic,
 * plain-text executive email built from lib/mcp/data.ts rollups. No model
 * writes a figure; the model only picks lines and windows and may add an
 * opening or closing sentence.
 *
 * A window with no rows at all says so in the draft instead of sending $0.
 */

import { Loader, WINDOW_KEYS, money, periodStats, resolveWindow, sumRows, type LineFilter, type WindowInput, type WindowKey } from '@/lib/mcp/data'
import type { Partner } from '@/lib/partners'

export { REPORT_LINES, REPORT_WINDOWS, type ReportLine } from '@/lib/partnersShared'
import type { ReportLine } from '@/lib/partnersShared'

export type ReportRequest = {
  /** One entry per line the exec wants, each with its own window. */
  items: Array<{ line: ReportLine | 'All'; window: WindowInput }>
  intro?: string | null
  closing?: string | null
}

export type ReportSection = {
  line: string
  window: { key: string; start: string; end: string; label: string; pretty: string }
  issued_premium: number | null
  policies_issued: number | null
  vs_prior_pct: number | null
  prior_label: string | null
  has_data: boolean
}

export type ComposedReport = {
  subject: string
  body: string
  sections: ReportSection[]
  data_through: string
  missing: string[]
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function prettyWindow(label: string, start: string, end: string): string {
  const l = label.replace(/^trailing (\d+) months$/, 'the last $1 months')
  return `${l} (${prettyDate(start)} – ${prettyDate(end)})`
}

export function asReportLine(v: unknown): ReportLine | 'All' {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'health') return 'Health'
  if (s === 'life') return 'Life'
  if (s === 'annuity' || s === 'annuities') return 'Annuity'
  return 'All'
}

export function asWindow(v: unknown): WindowInput {
  if (v && typeof v === 'object' && 'start' in v && 'end' in v) return v as { start: string; end: string }
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
  const map: Record<string, WindowKey> = {
    '3m': '3m', '3months': '3m', 'last3months': '3m', 'threemonths': '3m',
    '6m': '6m', '6months': '6m', 'last6months': '6m', 'sixmonths': '6m',
    '12m': '12m', '12months': '12m', 'last12months': '12m', 'year': '12m', 'trailingyear': '12m',
    ytd: 'ytd', yeartodate: 'ytd', mtd: 'mtd', monthtodate: 'mtd', qtd: 'qtd', quartertodate: 'qtd',
    lastmonth: 'last_month', last_month: 'last_month', lastyear: 'last_year', last_year: 'last_year', all: 'all', alltime: 'all',
  }
  if (map[s]) return map[s]
  if ((WINDOW_KEYS as readonly string[]).includes(s)) return s as WindowKey
  return 'ytd'
}

export async function composePartnerReport(L: Loader, partner: Pick<Partner, 'name' | 'org'>, req: ReportRequest, sender: { name: string; company: string }): Promise<ComposedReport> {
  const rows = await L.series()
  const today = L.today
  const through = await L.syncedThrough()
  const sections: ReportSection[] = []
  const missing: string[] = []

  for (const it of req.items.slice(0, 8)) {
    const w = resolveWindow(it.window, today)
    const line: LineFilter = it.line
    const any = sumRows(rows, w.start, w.end, line, 'all')
    const rowCount = rows.filter((r) => r.d >= w.start && r.d <= w.end && (line === 'All' || r.line === line)).length
    const pretty = prettyWindow(w.label, w.start, w.end)
    const key = typeof it.window === 'string' ? it.window : 'custom'
    if (rowCount === 0 && any.premium === 0) {
      sections.push({ line: it.line, window: { key, start: w.start, end: w.end, label: w.label, pretty }, issued_premium: null, policies_issued: null, vs_prior_pct: null, prior_label: null, has_data: false })
      missing.push(`${it.line === 'All' ? 'Total' : it.line} premium for ${pretty}`)
      continue
    }
    const st = periodStats(rows, w, line, 'pinnacle')
    sections.push({
      line: it.line,
      window: { key, start: w.start, end: w.end, label: w.label, pretty },
      issued_premium: st.issued_premium,
      policies_issued: st.policies_issued,
      vs_prior_pct: st.vs_prior.premium_delta_pct,
      prior_label: st.prior?.label ?? null,
      has_data: true,
    })
  }

  const first = partner.name.split(/\s+/)[0]
  const lines: string[] = []
  lines.push(`Hi ${first},`)
  lines.push('')
  lines.push(req.intro?.trim() || `Here are the ${sender.company} production figures you asked for.`)
  lines.push('')
  for (const s of sections) {
    const label = s.line === 'All' ? 'Total issued premium' : `${s.line} issued premium`
    if (!s.has_data) {
      lines.push(`${label}, ${s.window.pretty}: no data synced for this period yet. I will follow up once it is in.`)
      continue
    }
    const delta = s.vs_prior_pct === null ? '' : ` (${s.vs_prior_pct >= 0 ? 'up' : 'down'} ${Math.abs(s.vs_prior_pct).toFixed(0)}% vs ${s.prior_label})`
    lines.push(`${label}, ${s.window.pretty}: ${money(s.issued_premium ?? 0)} across ${(s.policies_issued ?? 0).toLocaleString('en-US')} policies${delta}.`)
  }
  lines.push('')
  lines.push(`Data through ${through.label}.`)
  lines.push('')
  lines.push(req.closing?.trim() || 'Happy to walk through any of it on a call.')
  lines.push('')
  lines.push(sender.name)
  lines.push(sender.company)

  const parts = sections.map((s) => `${s.line === 'All' ? 'Total' : s.line} ${s.window.label}`)
  const subject = `${sender.company} production — ${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ` +${parts.length - 3}` : ''}`

  return { subject, body: lines.join('\n'), sections, data_through: through.label, missing }
}
