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
  /** Plaud actions the assistant prepared and is waiting on approval for. */
  pendingApprovals?: number
  /** Overdue open tasks/commitments (from the brain "overdue" bucket). */
  overdue?: { count: number; topTitle: string | null }
  /** Today's calendar: count + the next upcoming meeting. */
  calendar?: { count: number; nextSummary: string | null; nextTime: string | null }
  /** Aging unresolved follow-ups the assistant prepared from calls. */
  agingFollowups?: { count: number; topAction: string | null; topRecording: string | null; topDays: number | null }
}

/**
 * Derive candidate recommendations from the exec digest plus optional revenue
 * and team-goal signals. No I/O; reads the wall clock for pace math.
 */
export function recommendationsFromDigest(digest: ExecDigest, inputs: RecommendationInputs = {}): Candidate[] {
  const out: Candidate[] = []

  // EXECUTIVE-ASSISTANT signal #1: work the assistant prepared from recordings
  // that's sitting on the exec's approval. This is the heart of the chief-of-
  // staff loop — prepared, ready, just needs a yes.
  const approvals = inputs.pendingApprovals ?? 0
  if (approvals > 0) {
    out.push({
      dedupe_key: 'pending_approvals',
      kind: 'pending_approvals',
      title: `${approvals} prepared action${approvals === 1 ? '' : 's'} awaiting your approval`,
      detail: `Your assistant drafted ${approvals} email/calendar action${approvals === 1 ? '' : 's'} from recent recordings — approve or adjust on the Plaud tab.`,
      reasoning: 'These go out the moment you approve — the fastest, lowest-effort wins on the board.',
      priority: approvals >= 3 ? 'high' : 'normal',
      signal: { pendingApprovals: approvals },
    })
  }

  // EXECUTIVE-ASSISTANT signal #1b: follow-ups from calls that have gone stale —
  // "you said you'd follow up and it still hasn't happened."
  const af = inputs.agingFollowups
  if (af && af.count > 0 && af.topAction) {
    const fromRec = af.topRecording ? ` from “${af.topRecording}”` : ''
    const ageStr = af.topDays != null ? ` (${af.topDays}d ago)` : ''
    out.push({
      dedupe_key: 'aging_followup',
      kind: 'call_followup',
      title: af.count > 1
        ? `${af.count} follow-ups from your calls are still open`
        : 'A follow-up from your call is still open',
      detail: `Oldest${fromRec}${ageStr}: ${af.topAction}. Approve it, send it, or drop it.`,
      reasoning: 'Commitments made on calls that sit unactioned are where deals and trust quietly leak.',
      priority: (af.topDays ?? 0) >= 4 || af.count >= 3 ? 'high' : 'normal',
      signal: { count: af.count, days: af.topDays },
    })
  }

  // EXECUTIVE-ASSISTANT signal #2: commitments the exec owes that are overdue.
  const overdue = inputs.overdue
  if (overdue && overdue.count > 0) {
    out.push({
      dedupe_key: 'overdue_commitments',
      kind: 'overdue_commitments',
      title: `${overdue.count} commitment${overdue.count === 1 ? '' : 's'} overdue`,
      detail: overdue.topTitle
        ? `Including “${overdue.topTitle}”. Clear it or reschedule before it slips further.`
        : 'Clear or reschedule them before they slip further.',
      reasoning: 'Overdue commitments are where trust quietly erodes — close or renegotiate them explicitly.',
      priority: overdue.count >= 3 ? 'high' : 'normal',
      signal: { count: overdue.count },
    })
  }

  // EXECUTIVE-ASSISTANT signal #3: prep for the next meeting on today's calendar.
  const cal = inputs.calendar
  if (cal && cal.count > 0 && cal.nextSummary) {
    out.push({
      dedupe_key: 'calendar_prep',
      kind: 'calendar_prep',
      title: `Prep for “${cal.nextSummary}”${cal.nextTime ? ` at ${cal.nextTime}` : ''}`,
      detail: cal.count > 1 ? `${cal.count} meetings on your calendar today — this one is next.` : 'Next on your calendar today.',
      reasoning: 'Walking in prepped is the difference between a meeting that moves things and one that doesn’t.',
      priority: 'normal',
      signal: { count: cal.count, next: cal.nextSummary },
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
