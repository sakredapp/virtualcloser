/**
 * "Which number is slipping" — the pure detector (no database, no AI).
 *
 * Input: month-to-date premium for the company, each agency (team) and each
 * carrier, against the SAME number of days last month (the Revenue card's
 * pace), plus placement for the last full month vs the month before.
 * Output: at most MAX_SLIP_ITEMS plain-words items, worst first. An empty list
 * means nothing is slipping, and then nobody hears anything (owner rule: no
 * nothing-to-do notifications).
 *
 * Used by Ciao's daily in-app alert (lib/pinnacle/slippingTick.ts, Hetzner
 * worker) and by the on-demand whats_slipping tool, so both say the same thing.
 * Executive data only.
 */
import { fmtMoney } from './kpis'

/** Company premium month to date down this much (percent) vs the same days last month. */
export const COMPANY_PACE_DROP_PCT = 15
/** One agency (or carrier) down this much (percent) vs the same days last month. */
export const AGENCY_DROP_PCT = 25
/** Ignore books smaller than this share (percent) of last month's same-days premium. */
export const MIN_BOOK_SHARE_PCT = 5
/** Placement down this many points, last full month vs the month before. */
export const PLACEMENT_DROP_PTS = 10
/** Too early in the month to judge pace before this many days of data. */
export const MIN_DAYS_COMPARED = 3
/** Placement needs at least this many applications in the month to be judged. */
export const MIN_PLACEMENT_APPS = 20
/** Never more than this many items in one alert. */
export const MAX_SLIP_ITEMS = 3

export type SlipSegment = { name: string; now: number; prior: number }

export type SlipInput = {
  /** "October 2026" style month key, YYYY-MM (signatures). */
  monthKey: string
  /** Days of this month compared with the same days last month. */
  daysCompared: number
  company: { now: number; lastMonth: number; lastYear: number | null }
  agencies: SlipSegment[]
  carriers: SlipSegment[]
  placement: { label: string; priorLabel: string; nowPct: number | null; priorPct: number | null; nowApps: number } | null
}

export type SlipKind = 'company' | 'agency' | 'carrier' | 'placement'

export type SlipItem = {
  kind: SlipKind
  name: string | null
  /** Percent drop (positive number) for pace items. */
  drop_pct: number | null
  /** Point drop (positive number) for placement. */
  drop_pts: number | null
  now: number | null
  prior: number | null
  /** How far past its threshold (1 = exactly at it); ranks worst first. */
  severity: number
  /** Stable per month: the same slip is alerted once a month, not every day. */
  signature: string
  line: string
}

const round1 = (n: number) => Math.round(n * 10) / 10
const dropPct = (now: number, prior: number) => (prior > 0 ? ((prior - now) / prior) * 100 : 0)
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

const KIND_ORDER: Record<SlipKind, number> = { company: 0, placement: 1, agency: 2, carrier: 3 }

function segmentItems(kind: 'agency' | 'carrier', rows: SlipSegment[], input: SlipInput): SlipItem[] {
  const base = rows.reduce((s, r) => s + Math.max(r.prior, 0), 0)
  if (!(base > 0)) return []
  const out: SlipItem[] = []
  for (const r of rows) {
    if (!r.name || !(r.prior > 0)) continue
    const sharePct = (r.prior / base) * 100
    if (sharePct < MIN_BOOK_SHARE_PCT) continue
    const d = dropPct(r.now, r.prior)
    if (d < AGENCY_DROP_PCT) continue
    const who = kind === 'carrier' ? `Carrier ${r.name}` : r.name
    out.push({
      kind,
      name: r.name,
      drop_pct: round1(d),
      drop_pts: null,
      now: Math.round(r.now),
      prior: Math.round(r.prior),
      severity: d / AGENCY_DROP_PCT,
      signature: `${kind}:${r.name.toLowerCase()}:${input.monthKey}`,
      line: `${who} is down ${Math.round(d)}% vs the same ${days(input.daysCompared)} last month (${fmtMoney(r.now)} vs ${fmtMoney(r.prior)}; ${Math.round(sharePct)}% of the book).`,
    })
  }
  return out
}

/** Everything slipping right now, worst first, at most MAX_SLIP_ITEMS. */
export function detectSlipping(input: SlipInput): SlipItem[] {
  const items: SlipItem[] = []
  if (input.daysCompared >= MIN_DAYS_COMPARED) {
    const c = input.company
    const d = dropPct(c.now, c.lastMonth)
    if (c.lastMonth > 0 && d >= COMPANY_PACE_DROP_PCT) {
      const ly = c.lastYear && c.lastYear > 0 ? Math.round(((c.now - c.lastYear) / c.lastYear) * 100) : null
      items.push({
        kind: 'company',
        name: null,
        drop_pct: round1(d),
        drop_pts: null,
        now: Math.round(c.now),
        prior: Math.round(c.lastMonth),
        severity: d / COMPANY_PACE_DROP_PCT,
        signature: `company:${input.monthKey}`,
        line:
          `Company premium is down ${Math.round(d)}% vs the same ${days(input.daysCompared)} last month (${fmtMoney(c.now)} vs ${fmtMoney(c.lastMonth)})` +
          (ly == null ? '.' : `; ${ly >= 0 ? 'up' : 'down'} ${Math.abs(ly)}% vs the same days last year.`),
      })
    }
    items.push(...segmentItems('agency', input.agencies, input), ...segmentItems('carrier', input.carriers, input))
  }
  const p = input.placement
  if (p && p.nowPct != null && p.priorPct != null && p.nowApps >= MIN_PLACEMENT_APPS) {
    const pts = p.priorPct - p.nowPct
    if (pts >= PLACEMENT_DROP_PTS) {
      items.push({
        kind: 'placement',
        name: null,
        drop_pct: null,
        drop_pts: round1(pts),
        now: round1(p.nowPct),
        prior: round1(p.priorPct),
        severity: pts / PLACEMENT_DROP_PTS,
        signature: `placement:${input.monthKey}`,
        line: `Placement fell ${Math.round(pts)} points: ${p.label} ${Math.round(p.nowPct)}% vs ${p.priorLabel} ${Math.round(p.priorPct)}%.`,
      })
    }
  }
  return items
    .sort((a, b) => b.severity - a.severity || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    .slice(0, MAX_SLIP_ITEMS)
}

// ── The daily in-app notice ────────────────────────────────────────────────

/** Every slipping notice key starts with this (lib/followups/notices shows them to execs). */
export const SLIP_KEY_PREFIX = 'slipping-'

/** One notice per member per day: the cxo_followup_notices (rep_id, key) row is the once-a-day lock. */
export function slippingNoticeKey(day: string, memberId: string): string {
  return `${SLIP_KEY_PREFIX}${day}-${memberId}`
}

/** Keys from the month so far, for "already told them about this slip". */
export function slippingMonthKeyPattern(day: string): string {
  return `${SLIP_KEY_PREFIX}${day.slice(0, 7)}-%`
}

/** Drop slips already alerted this month; the rest are new. */
export function newSlips(items: SlipItem[], alreadySent: Iterable<string>): SlipItem[] {
  const seen = new Set(alreadySent)
  return items.filter((i) => !seen.has(i.signature))
}

/** The notice's title and body, plain words. */
export function slippingNoticeText(items: SlipItem[]): { title: string; body: string } {
  const first = items[0]
  const head =
    first.kind === 'company'
      ? `Company premium is down ${Math.round(first.drop_pct ?? 0)}% vs last month`
      : first.kind === 'placement'
        ? `Placement fell ${Math.round(first.drop_pts ?? 0)} points`
        : `${first.kind === 'carrier' ? 'Carrier ' : ''}${first.name} is down ${Math.round(first.drop_pct ?? 0)}% vs last month`
  const title = items.length > 1 ? `Slipping: ${head}, and ${items.length - 1} more` : `Slipping: ${head}`
  return { title: title.slice(0, 300), body: items.map((i) => `- ${i.line}`).join('\n').slice(0, 8000) }
}

/**
 * Pure gate: may today's alert run for this tenant? Only once the day's
 * Airtable sync has finished (in the tenant's zone) and the rollups have been
 * rebuilt after it (a sweep at or after the finish).
 */
export function syncDoneToday(opts: { today: string; finishedAt: string | null; sweptAt: string | null; tz: string; now?: Date }): boolean {
  if (!opts.finishedAt) return false
  const fin = new Date(opts.finishedAt)
  if (!(fin.getTime() > 0)) return false
  if (dayIn(fin, opts.tz) !== opts.today) return false
  if (opts.sweptAt) return new Date(opts.sweptAt).getTime() >= fin.getTime()
  // No sweep stamp at all: give the post-sync rollup 40 minutes.
  return (opts.now ?? new Date()).getTime() - fin.getTime() >= 40 * 60_000
}

export function dayIn(at: Date, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}
