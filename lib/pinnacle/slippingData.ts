/**
 * Builds the slipping detector's input from the same numbers the Revenue page
 * and Ciao's pinnacle_revenue tool read: the tenant's cached daily rollup
 * (lib/mcp/data Loader) for company pace and placement, and the named
 * breakdown rollup (pinnacle_breakdown_v2) for agencies and carriers.
 * Read only. Pinnacle-viewer tenants only (the Loader's tenant is checked).
 */
import { Loader, addDays, addMonths, sumStatus } from '@/lib/mcp/data'
import { PINNACLE_BASE_ID, fetchBreakdown, type BreakdownRow } from './rollup'
import { MONTH_NAMES_LONG, dataThroughOf, monthToDate } from './kpis'
import { pinnacleAllowed } from './access'
import type { SlipInput, SlipSegment } from './slipping'

function segments(now: BreakdownRow[], prior: BreakdownRow[]): SlipSegment[] {
  const cur = new Map(now.map((r) => [r.label, r.premium]))
  return prior.filter((r) => r.label).map((r) => ({ name: r.label, now: cur.get(r.label) ?? 0, prior: r.premium }))
}

function lastDayOf(monthStart: string): string {
  return addDays(addMonths(monthStart, 1), -1)
}

/** This month's first `through` days and the same days last month (capped at last month's end). */
export function slipWindows(today: string, through: number): { now: { start: string; end: string }; prior: { start: string; end: string } } {
  const monthStart = `${today.slice(0, 7)}-01`
  const lmStart = addMonths(monthStart, -1)
  const lmEndRaw = addDays(lmStart, through - 1)
  const lmLast = lastDayOf(lmStart)
  return { now: { start: monthStart, end: addDays(monthStart, through - 1) }, prior: { start: lmStart, end: lmEndRaw > lmLast ? lmLast : lmEndRaw } }
}

async function readSegments(through: number, today: string) {
  const w = slipWindows(today, through)
  const [tNow, tPrior, cNow, cPrior] = await Promise.all([
    fetchBreakdown('team', 'All', w.now.start, w.now.end, 500),
    fetchBreakdown('team', 'All', w.prior.start, w.prior.end, 500),
    fetchBreakdown('carrier', 'All', w.now.start, w.now.end, 500),
    fetchBreakdown('carrier', 'All', w.prior.start, w.prior.end, 500),
  ])
  return { agencies: segments(tNow, tPrior), carriers: segments(cNow, cPrior) }
}

/** Null when there is nothing to compare yet (no book, or no rows this month). */
export async function loadSlipInput(L: Loader): Promise<SlipInput | null> {
  if (!pinnacleAllowed(L.tenant.id)) return null
  const today = L.today
  // The breakdowns start with the daily series instead of after it: the book
  // almost always has data through today (Health effective dates run ahead),
  // so the guess holds and only a miss pays a second round trip.
  const guess = Number(today.slice(8, 10))
  const early = readSegments(guess, today).catch(() => null)
  const [allRows, statuses] = await Promise.all([L.series(), L.statuses()])
  const rows = allRows.filter((r) => r.base_id === PINNACLE_BASE_ID)
  if (!rows.length) return null
  const m = monthToDate(rows, new Date(`${today}T12:00:00Z`), dataThroughOf(rows, today))
  const monthStart = `${today.slice(0, 7)}-01`
  const lmStart = addMonths(monthStart, -1)

  let agencies: SlipSegment[] = []
  let carriers: SlipSegment[] = []
  if (m.through > 0) {
    const seg = (m.through === guess ? await early : null) ?? (await readSegments(m.through, today))
    agencies = seg.agencies
    carriers = seg.carriers
  }

  // Placement: the last full month vs the month before (both have had time to issue).
  const pStart = lmStart
  const ppStart = addMonths(monthStart, -2)
  const pNow = sumStatus(statuses, pStart, lastDayOf(pStart))
  const pPrior = sumStatus(statuses, ppStart, lastDayOf(ppStart))
  const pct = (s: { paid: number; total: number }) => (s.total > 0 ? (s.paid / s.total) * 100 : null)

  return {
    monthKey: today.slice(0, 7),
    daysCompared: m.through,
    company: { now: m.mtd.premium, lastMonth: m.lm.premium, lastYear: m.ly.premium > 0 ? m.ly.premium : null },
    agencies,
    carriers,
    placement: {
      label: MONTH_NAMES_LONG[Number(pStart.slice(5, 7)) - 1],
      priorLabel: MONTH_NAMES_LONG[Number(ppStart.slice(5, 7)) - 1],
      nowPct: pct(pNow),
      priorPct: pct(pPrior),
      nowApps: pNow.total,
    },
  }
}
