/**
 * Team-goal coordination: when leadership sets a team or account-scope target,
 * this module is the single place that:
 *   1. Resolves which members are in scope (whole-account or one team).
 *   2. Sends each in-scope member a Telegram ping with the new target.
 *   3. Builds the daily-reminder string used by the morning cron.
 *
 * The assistant is the middleman: managers never need to message reps directly
 * about goals — they just set them, the bot fans the message out.
 */

import { supabase } from '@/lib/supabase'
import { sendTelegramMessage } from '@/lib/telegram'
import { getTeamGoalsForMember } from '@/lib/leaderboard'
import type { Member, Target, TargetMetric, TargetPeriod, TargetVisibility } from '@/types'

const VISIBILITY_RANK: Record<TargetVisibility, number> = { all: 0, managers: 1, owners: 2 }
const ROLE_RANK: Record<string, number> = { observer: 0, rep: 0, manager: 1, admin: 2, owner: 2 }

function canSeeVisibility(viewerRole: string | undefined, visibility: TargetVisibility | undefined): boolean {
  const v = visibility ?? 'all'
  const need = VISIBILITY_RANK[v] ?? 0
  const have = ROLE_RANK[viewerRole ?? 'rep'] ?? 0
  return have >= need
}

const METRIC_LABEL: Record<TargetMetric, string> = {
  calls: 'calls',
  conversations: 'conversations',
  meetings_booked: 'meetings booked',
  deals_closed: 'deals closed',
  revenue: 'revenue',
  custom: 'custom metric',
}

const PERIOD_LABEL: Record<TargetPeriod, string> = {
  day: 'today',
  week: 'this week',
  month: 'this month',
  quarter: 'this quarter',
  year: 'this year',
}

export function describeTarget(t: Pick<Target, 'metric' | 'target_value' | 'period_type'>): string {
  return `${t.target_value} ${METRIC_LABEL[t.metric] ?? t.metric} ${PERIOD_LABEL[t.period_type] ?? t.period_type}`
}

/** Members in scope for a given target (excluding the manager who set it, optionally). */
export async function membersInScope(
  repId: string,
  scope: 'team' | 'account',
  teamId: string | null,
  excludeMemberId?: string | null,
): Promise<Member[]> {
  if (scope === 'account') {
    const { data } = await supabase
      .from('members')
      .select('*')
      .eq('rep_id', repId)
      .eq('is_active', true)
    const all = (data ?? []) as Member[]
    return excludeMemberId ? all.filter((m) => m.id !== excludeMemberId) : all
  }
  if (!teamId) return []
  const { data: roster } = await supabase
    .from('team_members')
    .select('member_id')
    .eq('team_id', teamId)
  const ids = (roster ?? [])
    .map((r) => (r as { member_id: string | null }).member_id)
    .filter((x): x is string => Boolean(x))
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('members')
    .select('*')
    .in('id', ids)
    .eq('is_active', true)
  const all = (data ?? []) as Member[]
  return excludeMemberId ? all.filter((m) => m.id !== excludeMemberId) : all
}

/** Broadcast a freshly-set/updated target to every member in scope via Telegram. */
export async function broadcastNewTeamGoal(
  target: Target,
  setterName: string,
  teamName: string | null,
): Promise<{ delivered: number; skipped: number }> {
  if (target.scope === 'personal') return { delivered: 0, skipped: 0 }
  let recipients = await membersInScope(
    target.rep_id,
    target.scope,
    target.team_id,
    target.owner_member_id,
  )
  // Visibility gate: only recipients whose role can see this goal.
  recipients = recipients.filter((m) => canSeeVisibility(m.role, target.visibility))
  const scopeLabel =
    target.scope === 'account' ? 'the whole account' : teamName ? `the *${teamName}* team` : 'your team'
  const msg = [
    `📣 *New goal from ${setterName}* — ${scopeLabel}`,
    '',
    `🎯 *${describeTarget(target)}*`,
    target.notes ? `_${target.notes}_` : '',
    '',
    `Every ${METRIC_LABEL[target.metric]} you log rolls into the team total automatically.`,
    `Reply to me here — "log call with Dana, booked", "Goal: 10 of these this week", "show me my progress" — and I'll keep the score for you.`,
  ]
    .filter(Boolean)
    .join('\n')

  let delivered = 0
  let skipped = 0
  for (const m of recipients) {
    if (!m.telegram_chat_id) {
      skipped++
      continue
    }
    try {
      await sendTelegramMessage(m.telegram_chat_id, msg)
      delivered++
    } catch (err) {
      console.error('[team-goals] broadcast failed', { memberId: m.id, err })
      skipped++
    }
  }
  return { delivered, skipped }
}

/**
 * Build the goals section for a member's daily brief. Includes their personal
 * active targets and any team/account-scope targets that include them, with
 * their contribution and the team total. Returns an empty string when there
 * are no active goals for this member.
 */
export async function buildMemberGoalsBrief(
  repId: string,
  memberId: string,
): Promise<string> {
  // Resolve viewer role for visibility filtering.
  const { data: viewerRow } = await supabase
    .from('members')
    .select('role')
    .eq('id', memberId)
    .maybeSingle()
  const viewerRole = (viewerRow as { role?: string } | null)?.role

  // Personal targets for this member.
  const { data: personalRows } = await supabase
    .from('targets')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'active')
    .eq('scope', 'personal')
    .eq('owner_member_id', memberId)
    .order('period_start', { ascending: false })
  const personal = ((personalRows ?? []) as Target[]).filter((t) =>
    canSeeVisibility(viewerRole, t.visibility),
  )

  const teamGoals = (await getTeamGoalsForMember(repId, memberId)).filter((g) =>
    canSeeVisibility(viewerRole, g.visibility),
  )

  if (personal.length === 0 && teamGoals.length === 0) return ''

  const lines: string[] = ['', '🎯 *Today\u2019s goals*']

  for (const p of personal) {
    const pct = p.target_value > 0 ? Math.min(100, Math.round((Number(p.current_value) / Number(p.target_value)) * 100)) : 0
    lines.push(`• ${describeTarget(p)} — *${Number(p.current_value)}/${Number(p.target_value)}* (${pct}%)`)
  }
  for (const g of teamGoals) {
    const pct = g.targetValue > 0 ? Math.min(100, Math.round((g.total / g.targetValue) * 100)) : 0
    const scopeTag = g.scope === 'account' ? 'Account' : g.teamName ? `Team · ${g.teamName}` : 'Team'
    const period = PERIOD_LABEL[g.periodType as TargetPeriod] ?? g.periodType
    const metric = METRIC_LABEL[g.metric as TargetMetric] ?? g.metric
    lines.push(`• [${scopeTag}] ${g.targetValue} ${metric} ${period} — team *${g.total}/${g.targetValue}* (${pct}%) · you *${g.yours}*`)
  }
  lines.push('')
  lines.push('Reply with what you did today (e.g. _"logged 12 calls, 2 booked"_) and I\u2019ll update the score.')
  return lines.join('\n')
}

/** Send each member of a tenant their own EOD progress prompt. */
export async function sendEodProgressPrompts(
  repId: string,
): Promise<{ sent: number; skipped: number }> {
  const { data: members } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
    .eq('is_active', true)
  const list = (members ?? []) as Member[]
  let sent = 0
  let skipped = 0
  for (const m of list) {
    if (!m.telegram_chat_id) {
      skipped++
      continue
    }
    const goals = await buildMemberGoalsBrief(repId, m.id)
    if (!goals) {
      skipped++
      continue
    }
    const msg = [
      `📊 *End-of-day check-in, ${m.display_name?.split(' ')[0] ?? 'team'}*`,
      goals,
    ].join('\n')
    try {
      await sendTelegramMessage(m.telegram_chat_id, msg)
      sent++
    } catch (err) {
      console.error('[team-goals] eod prompt failed', { memberId: m.id, err })
      skipped++
    }
  }
  return { sent, skipped }
}
