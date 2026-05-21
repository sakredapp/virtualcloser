// AI-written executive summary + Pinnacle revenue brief data for the daily
// brief (Telegram) and the formal email digest. Claude calls live HERE (in the
// cron path) — never in buildExecDigest, which runs on every dashboard load.

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { fetchMonthSummary, fetchBreakdown } from '@/lib/pinnacle/rollup'
import type { ExecDigest } from './digest'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

export type PinnacleBriefData = {
  mtdPremium: number
  projected: number
  pacePct: number | null
  placementPct: number
  topTeams: Array<{ name: string; premium: number }>
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
 * null if there's no data. Callers must already have gated on isPinnacleViewer.
 */
export async function buildPinnacleBriefData(todayIso: string): Promise<PinnacleBriefData | null> {
  const ms = await fetchMonthSummary().catch(() => null)
  if (!ms) return null
  const day = Number(todayIso.slice(8, 10)) || 1
  const daysInMonth = new Date(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)), 0).getDate()
  const projected = (ms.this_month_premium / day) * daysInMonth
  const pacePct = ms.prev_month_premium > 0 ? projected / ms.prev_month_premium - 1 : null
  const placementPct = ms.this_month_total > 0 ? ms.this_month_paid / ms.this_month_total : 0
  const monthStart = `${todayIso.slice(0, 7)}-01`
  const teams = await fetchBreakdown('team', 'All', monthStart, todayIso, 3).catch(() => [])
  return {
    mtdPremium: ms.this_month_premium,
    projected,
    pacePct,
    placementPct,
    topTeams: teams.map((t) => ({ name: t.label, premium: t.premium })),
  }
}

/** One-line revenue summary for the Telegram brief (Markdown). */
export function renderRevenueLine(p: PinnacleBriefData): string {
  const pace =
    p.pacePct != null ? ` (${p.pacePct >= 0 ? '+' : ''}${Math.round(p.pacePct * 100)}% vs last mo)` : ''
  const top = p.topTeams[0] ? ` · top team ${p.topTeams[0].name} ${fmtM(p.topTeams[0].premium)}` : ''
  return `💰 *Revenue MTD:* ${fmtM(p.mtdPremium)} → projected ${fmtM(p.projected)}${pace} · placement ${Math.round(
    p.placementPct * 100,
  )}%${top}`
}

/**
 * Claude-written 2-3 sentence executive read. Best-effort: returns '' on any
 * failure (no key, API error) so the brief still sends without it.
 */
export async function generateExecSummary(input: {
  digest: ExecDigest
  pinnacle: PinnacleBriefData | null
  name: string
  claudeKey?: string | null
}): Promise<string> {
  const facts = {
    meetings_today: input.digest.todayEvents?.length ?? 0,
    drafts_to_approve: input.digest.pendingDrafts,
    emails_to_answer: input.digest.unansweredThreads,
    deals_gone_quiet: input.digest.quietDeals.length,
    hot_warm_leads: input.digest.topLeads.length,
    overnight_changes: input.digest.overnightChanges,
    revenue: input.pinnacle
      ? {
          mtd_premium: Math.round(input.pinnacle.mtdPremium),
          projected_month_end: Math.round(input.pinnacle.projected),
          pace_vs_prev_month_pct: input.pinnacle.pacePct != null ? Math.round(input.pinnacle.pacePct * 100) : null,
          placement_pct: Math.round(input.pinnacle.placementPct * 100),
          top_team: input.pinnacle.topTeams[0] ?? null,
        }
      : null,
  }
  try {
    return await runWithClaudeKey(input.claudeKey, async () => {
      const res = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 220,
        system:
          'You are a sharp chief of staff writing the opening 2-3 sentence read for a busy executive\'s morning brief. Lead with what matters most today. If revenue data is present, anchor on the pace (ahead/behind last month) in plain terms. Name the single biggest thing waiting on them. No greeting, no signoff, no bullet points, no markdown. Under 55 words. Specific and confident — "projected $26M, ~14% ahead of last month" not "things look good".',
        messages: [
          {
            role: 'user',
            content: `Executive: ${input.name}. Today's facts (JSON):\n${JSON.stringify(facts)}\n\nWrite the brief.`,
          },
        ],
      })
      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim()
    })
  } catch {
    return ''
  }
}
