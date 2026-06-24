// Recommendations engine — the proactive overseer.
//
// Turns live business signals (from the exec digest already computed on the
// dashboard) into concrete, trackable recommendations, and reconciles them
// against what's already stored so we never duplicate or resurrect a dismissed
// one. Rule-based + cheap (no LLM): runs inline on dashboard load.

import { supabase } from '@/lib/supabase'
import type { ExecDigest } from '@/lib/exec/digest'

export type RecommendationPriority = 'low' | 'normal' | 'high'

export type Recommendation = {
  id: string
  rep_id: string
  dedupe_key: string
  kind: string
  title: string
  detail: string | null
  reasoning: string | null
  priority: RecommendationPriority
  status: 'open' | 'acted' | 'dismissed' | 'stale'
  signal: Record<string, unknown> | null
  created_at: string
}

type Candidate = {
  dedupe_key: string
  kind: string
  title: string
  detail: string
  reasoning: string
  priority: RecommendationPriority
  signal: Record<string, unknown>
}

function money(n: number | null): string {
  if (n == null) return ''
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n)}`
}

/** Current-month revenue snapshot (Pinnacle month summary), for pace signals. */
export type RevenuePace = { thisMonth: number; prevMonth: number; total: number; paid: number }
/** A team/account goal, for at-risk signals. */
export type TeamGoalLite = {
  metric: string
  total: number
  targetValue: number
  teamName: string | null
  periodType: string
  scope: string
}
export type RecommendationInputs = {
  pinnacle?: RevenuePace | null
  teamGoals?: TeamGoalLite[]
}

/**
 * Derive candidate recommendations from the exec digest plus optional revenue
 * and team-goal signals. No I/O; reads the wall clock for pace math.
 */
export function recommendationsFromDigest(digest: ExecDigest, inputs: RecommendationInputs = {}): Candidate[] {
  const out: Candidate[] = []

  // Deals gone quiet — one rec each (these are the highest-leverage nudges).
  for (const d of digest.quietDeals.slice(0, 6)) {
    const co = d.company ? ` (${d.company})` : ''
    const val = d.value ? ` worth ${money(d.value)}` : ''
    out.push({
      dedupe_key: `quiet_deal:${d.name.toLowerCase()}:${(d.company ?? '').toLowerCase()}`,
      kind: 'quiet_deal',
      title: `Re-engage ${d.name}${co}`,
      detail: `No contact in ${d.days} days${val}. Send a check-in or move it forward.`,
      reasoning: `Deals that go quiet past ~${d.days} days rarely self-revive — a nudge now protects the pipeline.`,
      priority: (d.value ?? 0) >= 5000 || d.days >= 14 ? 'high' : 'normal',
      signal: { name: d.name, company: d.company, value: d.value, days: d.days },
    })
  }

  // Approval queue backing up.
  if (digest.pendingDrafts > 0) {
    out.push({
      dedupe_key: 'drafts_backlog',
      kind: 'drafts_backlog',
      title: `Clear ${digest.pendingDrafts} draft${digest.pendingDrafts === 1 ? '' : 's'} awaiting approval`,
      detail: `The assistant has ${digest.pendingDrafts} reply/action draft${digest.pendingDrafts === 1 ? '' : 's'} ready for your OK.`,
      reasoning: 'Drafts left in the queue mean prepared follow-ups never go out — fast approvals keep momentum.',
      priority: digest.pendingDrafts >= 5 ? 'high' : 'normal',
      signal: { pendingDrafts: digest.pendingDrafts },
    })
  }

  // Unanswered inbound threads.
  if (digest.unansweredThreads > 0) {
    out.push({
      dedupe_key: 'unanswered_threads',
      kind: 'unanswered_threads',
      title: `Reply to ${digest.unansweredThreads} unanswered thread${digest.unansweredThreads === 1 ? '' : 's'}`,
      detail: `${digest.unansweredThreads} inbound email${digest.unansweredThreads === 1 ? '' : 's'} still waiting on a response.`,
      reasoning: 'Response time is the single biggest driver of reply + close rates — answer these first.',
      priority: digest.unansweredThreads >= 5 ? 'high' : 'normal',
      signal: { unansweredThreads: digest.unansweredThreads },
    })
  }

  // Hot leads to strike while intent is high.
  const hot = digest.topLeads
    .filter((l) => l.status === 'hot')
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 2)
  for (const l of hot) {
    const co = l.company ? ` (${l.company})` : ''
    const val = l.value ? ` worth ${money(l.value)}` : ''
    out.push({
      dedupe_key: `hot_lead:${l.name.toLowerCase()}:${(l.company ?? '').toLowerCase()}`,
      kind: 'hot_lead',
      title: `Reach out to ${l.name}${co} while hot`,
      detail: `Top hot lead${val}. Contact today while intent is high.`,
      reasoning: 'Hot leads cool fast — a same-day touch materially lifts conversion.',
      priority: (l.value ?? 0) >= 5000 ? 'high' : 'normal',
      signal: { name: l.name, company: l.company, value: l.value },
    })
  }

  // Revenue pace + placement (Pinnacle viewers only — pinnacle passed in).
  const p = inputs.pinnacle
  if (p && p.prevMonth > 0) {
    const now = new Date()
    const day = now.getUTCDate()
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
    const projected = day > 0 ? (p.thisMonth / day) * daysInMonth : 0
    const pace = projected / p.prevMonth - 1
    if (pace <= -0.1) {
      out.push({
        dedupe_key: 'revenue_pace',
        kind: 'revenue_pace',
        title: `Revenue pacing ${Math.round(pace * 100)}% vs last month`,
        detail: `On current pace, month-end lands near ${money(projected)} vs ${money(p.prevMonth)} last month. Push the pipeline to close the gap.`,
        reasoning: 'Catching a pace shortfall mid-month leaves time to act; by month-end it’s locked in.',
        priority: pace <= -0.2 ? 'high' : 'normal',
        signal: { thisMonth: p.thisMonth, prevMonth: p.prevMonth, projected, pace },
      })
    }
  }
  if (p && p.total >= 20) {
    const placement = p.paid / p.total
    if (placement < 0.5) {
      out.push({
        dedupe_key: 'placement_rate',
        kind: 'placement_rate',
        title: `Placement rate at ${Math.round(placement * 100)}% this month`,
        detail: `${p.paid} of ${p.total} apps issued-paid. Tighten follow-ups / underwriting fit to lift placement.`,
        reasoning: 'Low placement means written premium isn’t converting to paid — the biggest silent revenue leak.',
        priority: placement < 0.35 ? 'high' : 'normal',
        signal: { paid: p.paid, total: p.total, placement },
      })
    }
  }

  // Team / account goals tracking far behind.
  const goals = (inputs.teamGoals ?? [])
    .filter((g) => g.targetValue > 0 && g.total / g.targetValue < 0.4)
    .sort((a, b) => a.total / a.targetValue - b.total / b.targetValue)
    .slice(0, 2)
  for (const g of goals) {
    const pct = Math.round((g.total / g.targetValue) * 100)
    const who = g.scope === 'account' ? 'The account' : (g.teamName ?? 'The team')
    const metric = g.metric.replace(/_/g, ' ')
    out.push({
      dedupe_key: `team_goal:${g.metric}:${g.scope}:${(g.teamName ?? 'account').toLowerCase()}`,
      kind: 'team_goal',
      title: `${who} is at ${pct}% of its ${metric} goal`,
      detail: `${g.total} of ${g.targetValue} this ${g.periodType}. Rally activity or re-set the target.`,
      reasoning: 'Goals that stall early in the period rarely recover without a deliberate push.',
      priority: pct < 20 ? 'high' : 'normal',
      signal: { metric: g.metric, total: g.total, targetValue: g.targetValue, scope: g.scope },
    })
  }

  return out
}

/**
 * Reconcile candidates against stored recs:
 *  - new key → insert (open)
 *  - existing open → refresh copy, keep open
 *  - existing acted/dismissed → leave alone (respect the exec's decision)
 *  - stored open whose signal cleared → mark stale
 * Returns the current open recommendations, highest priority first.
 */
export async function syncRecommendations(
  repId: string,
  candidates: Candidate[],
): Promise<Recommendation[]> {
  const { data: existingRows } = await supabase
    .from('recommendations')
    .select('*')
    .eq('rep_id', repId)
  const existing = (existingRows ?? []) as Recommendation[]
  const byKey = new Map(existing.map((r) => [r.dedupe_key, r]))
  const candidateKeys = new Set(candidates.map((c) => c.dedupe_key))
  const now = new Date().toISOString()

  const toInsert: Array<Record<string, unknown>> = []
  for (const c of candidates) {
    const prev = byKey.get(c.dedupe_key)
    if (!prev) {
      toInsert.push({
        rep_id: repId,
        dedupe_key: c.dedupe_key,
        kind: c.kind,
        title: c.title,
        detail: c.detail,
        reasoning: c.reasoning,
        priority: c.priority,
        signal: c.signal,
      })
    } else if (prev.status === 'open' || prev.status === 'stale') {
      // Refresh content + reopen if it had gone stale.
      await supabase
        .from('recommendations')
        .update({ title: c.title, detail: c.detail, reasoning: c.reasoning, priority: c.priority, signal: c.signal, status: 'open', updated_at: now })
        .eq('id', prev.id)
    }
    // acted/dismissed → intentionally left as-is.
  }
  if (toInsert.length > 0) {
    await supabase.from('recommendations').insert(toInsert)
  }

  // Close open recs whose signal no longer fires.
  const staleIds = existing
    .filter((r) => r.status === 'open' && !candidateKeys.has(r.dedupe_key))
    .map((r) => r.id)
  if (staleIds.length > 0) {
    await supabase.from('recommendations').update({ status: 'stale', updated_at: now }).in('id', staleIds)
  }

  return listOpenRecommendations(repId)
}

export async function listOpenRecommendations(repId: string): Promise<Recommendation[]> {
  const { data } = await supabase
    .from('recommendations')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as Recommendation[]
  const rank: Record<string, number> = { high: 0, normal: 1, low: 2 }
  return rows.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1))
}
