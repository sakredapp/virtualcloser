/**
 * The recurring production report (cxo_report_jobs kind 'production'):
 * month to date vs the same days last month (the last full month in the
 * first days of a month). Totals, top producers, who is slipping, new
 * producers. Plain text, no AI; null when there is no book or no business.
 */
import { fetchProducers, bookStatus } from './data'
import {
  money,
  newProducers,
  rankProducers,
  resolvePeriod,
  slippingProducers,
  totals,
  type Period,
  type ProducerRow,
} from './production'

export function reportPeriod(todayIso: string): Period {
  return Number(todayIso.slice(8, 10)) <= 3 ? resolvePeriod('last_month', todayIso) : resolvePeriod('mtd', todayIso)
}

const pctWord = (n: number | null) => (n == null ? 'n/a' : `${n}%`)

/** Pure: the report text from two windows of producer rows. */
export function productionReportText(period: Period, now: ProducerRow[], prior: ProducerRow[], dataThrough: string | null): { title: string; body: string; count: number } | null {
  const t = totals(now)
  if (!t.applications && !t.submitted_ap) return null
  const p = totals(prior)
  const change = p.submitted_ap > 0 ? Math.round(((t.submitted_ap - p.submitted_ap) / p.submitted_ap) * 1000) / 10 : null
  const top = rankProducers(now, 'submitted_ap', { limit: 5 }).ranked
  const { slipping } = slippingProducers(now, prior, 5)
  const fresh = newProducers(now, period)
  const lines: string[] = []
  lines.push(`Period: ${period.label}${dataThrough ? `, data through ${dataThrough}` : ''}.`)
  lines.push(
    `Submitted AP ${money(t.submitted_ap)}${change != null ? ` (${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% vs ${period.priorLabel})` : ''}; issued AP ${money(t.issued_ap)}; ${t.applications} applications from ${t.producers_writing} producers; placement ${pctWord(t.placement_pct)}.`,
  )
  if (top.length) lines.push('', 'Top producers (submitted AP):', ...top.map((r) => `  ${r.rank}. ${r.name}${r.team ? ` (${r.team})` : ''}: ${money(r.submitted_ap)}, ${r.applications} apps`))
  if (slipping.length) lines.push('', `Slipping vs ${period.priorLabel}:`, ...slipping.map((c) => `  - ${c.name}: ${money(c.now_submitted_ap)} vs ${money(c.prior_submitted_ap)}${c.ap_change_pct != null ? ` (${c.ap_change_pct}%)` : ''}`))
  if (fresh.length) lines.push('', `New producers: ${fresh.length}`, ...fresh.slice(0, 5).map((r) => `  - ${r.name}${r.team ? ` (${r.team})` : ''}: ${money(r.submitted_ap)}, ${r.applications} apps`))
  return { title: `Producer production: ${money(t.submitted_ap)} submitted AP`, body: lines.join('\n').slice(0, 7900), count: t.producers_writing }
}

/** Server: the report for one tenant, or null (no book, or nothing written). Callers check canSeeBook first. */
export async function buildProductionReport(tenantId: string, todayIso: string) {
  const status = await bookStatus(tenantId)
  if (!status.connected) return null
  const period = reportPeriod(todayIso)
  const [now, prior] = await Promise.all([fetchProducers(tenantId, period), fetchProducers(tenantId, period.prior)])
  return productionReportText(period, now, prior, status.data_through)
}
