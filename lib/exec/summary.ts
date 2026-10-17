// AI-written executive summary + Pinnacle revenue brief data for the formal
// email digest. Claude calls live HERE (in the
// cron path) — never in buildExecDigest, which runs on every dashboard load.

import type * as AI from '@/lib/aiTypes'
import { getAI } from '@/lib/ai'
import { fetchMonthSummary, fetchBreakdown, fetchPremiumSeries, PINNACLE_BASE_ID } from '@/lib/pinnacle/rollup'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { dataThroughOf, monthToDate } from '@/lib/pinnacle/kpis'
import type { ExecDigest } from './digest'
import { textModelId } from '@/lib/aiProvider'

const MODEL = textModelId()

/**
 * Month-to-date pace, exactly as the Revenue card computes it (owner 10-09):
 * submitted premium month to date vs the SAME number of days last month,
 * counted only through the day the book has data for. There is no month-end
 * projection anywhere (removed 2026-10-17, see lib/pinnacle/kpis.ts).
 */
export type MonthPace = {
  mtdPremium: number
  sameDaysLastMonthPremium: number
  /** Days compared (min of today and the book's data-through day). 0 = no data this month yet. */
  daysCompared: number
  /** MTD vs the same days last month, as a fraction (-0.12 = down 12%). Null when last month has no data for those days. */
  vsLastMonthPct: number | null
  dataThrough: string | null
}

export async function fetchMonthPace(todayIso: string): Promise<MonthPace | null> {
  const rows = (await fetchPremiumSeries().catch(() => [])).filter((r) => r.base_id === PINNACLE_BASE_ID)
  if (rows.length === 0) return null
  const dataThrough = dataThroughOf(rows, todayIso)
  const m = monthToDate(rows, new Date(`${todayIso}T12:00:00Z`), dataThrough)
  return {
    mtdPremium: m.mtd.premium,
    sameDaysLastMonthPremium: m.lm.premium,
    daysCompared: m.through,
    vsLastMonthPct: m.vsLastMonth.pct,
    dataThrough,
  }
}

export type PinnacleBriefData = MonthPace & {
  placementPct: number
  topTeams: Array<{ name: string; premium: number }>
}

/** "down 12% vs the same 17 days last month", or null when there is nothing to compare. */
export function paceWords(p: MonthPace): string | null {
  if (p.daysCompared === 0 || p.vsLastMonthPct == null) return null
  const n = Math.round(p.vsLastMonthPct * 100)
  const dir = n > 0 ? `up ${n}%` : n < 0 ? `down ${-n}%` : 'level'
  return `${dir} vs the same ${p.daysCompared} day${p.daysCompared === 1 ? '' : 's'} last month`
}

/** Format a dollar amount compactly ($1.2M / $340K / $900). */
export function fmtM(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

/**
 * Build the current-month Pinnacle snapshot used in the brief/email. Returns
 * null if there's no data, or the tenant is not mapped to the Pinnacle book.
 */
export async function buildPinnacleBriefData(tenantId: string, todayIso: string): Promise<PinnacleBriefData | null> {
  if (!pinnacleAllowed(tenantId)) return null
  const [ms, pace] = await Promise.all([fetchMonthSummary().catch(() => null), fetchMonthPace(todayIso)])
  if (!ms || !pace) return null
  const placementPct = ms.this_month_total > 0 ? ms.this_month_paid / ms.this_month_total : 0
  const monthStart = `${todayIso.slice(0, 7)}-01`
  const teams = await fetchBreakdown('team', 'All', monthStart, todayIso, 3).catch(() => [])
  return {
    ...pace,
    placementPct,
    topTeams: teams.map((t) => ({ name: t.label, premium: t.premium })),
  }
}

/**
 * Claude-written 2-3 sentence executive read. Best-effort: returns '' on any
 * failure (no key, API error) so the brief still sends without it.
 */
export async function generateExecSummary(input: {
  digest: ExecDigest
  pinnacle: PinnacleBriefData | null
  name: string
}): Promise<string> {
  const facts = {
    as_of: new Date().toISOString(),
    meetings_today: input.digest.todayEvents?.length ?? 0,
    drafts_to_approve: input.digest.pendingDrafts,
    emails_to_answer: input.digest.unansweredThreads,
    deals_gone_quiet: input.digest.quietDeals.length,
    hot_warm_leads: input.digest.topLeads.length,
    overnight_changes: input.digest.overnightChanges,
    revenue: input.pinnacle
      ? {
          mtd_premium: Math.round(input.pinnacle.mtdPremium),
          data_through: input.pinnacle.dataThrough,
          same_days_last_month_premium: Math.round(input.pinnacle.sameDaysLastMonthPremium),
          pace_vs_same_days_last_month: paceWords(input.pinnacle),
          placement_pct: Math.round(input.pinnacle.placementPct * 100),
          top_team: input.pinnacle.topTeams[0] ?? null,
        }
      : null,
  }
  try {
    const res = await getAI().messages.create({
      model: MODEL,
      max_tokens: 220,
      system:
        'You are a sharp chief of staff writing the opening 2-3 sentence read for a busy executive\'s morning brief. Lead with what matters most today. If revenue data is present, anchor on `pace_vs_same_days_last_month` (month to date vs the same days last month) in plain terms. Never project, forecast or estimate a month-end figure, and never compare month to date with last month\'s full total. Name the single biggest thing waiting on them. No greeting, no signoff, no bullet points, no markdown. Under 55 words. Numbers are as of `as_of`; never add figures that are not in the facts. Specific and confident — "$12.9M month to date, down 9% vs the same 17 days last month" not "things look good".',
      messages: [
        {
          role: 'user',
          content: `Executive: ${input.name}. Today's facts (JSON):\n${JSON.stringify(facts)}\n\nWrite the brief.`,
        },
      ],
    })
    return res.content
      .filter((b): b is AI.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()
  } catch {
    return ''
  }
}
