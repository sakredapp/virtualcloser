// Weekly Ciao learnings pass — Suite CXO tenants only. Runs from the Hetzner
// worker (hetzner-worker/index.ts, checked every ~2h); the manual route
// app/api/cron/exec-brief is a thin wrapper around it.
//
// For every active owner/admin it mines their Ciao chat history for durable
// learnings and capability gaps (plaud_agent_guidance / fix_requests), then the
// note-agent self-teaches from action + recommendation outcomes (what the exec
// approves vs dismisses). All output is DB writes the app reads; nothing is
// sent to anyone.
//
// Idempotency: each finished unit writes a job_runs row (job =
// WEEKLY_LEARNINGS_JOB, meta = {rep_id, member_id, week}) via recordJobRun.
// A member (or the tenant-level outcome pass, member_id null) is skipped when
// a row for the current tenant-local ISO week already exists. No schema change.
//
// Cost: AI goes through lib/ai (OpenRouter GLM only), one call per member, at
// most maxMembers per tick; the rest roll over to the next check.

import { supabase } from '@/lib/supabase'
import { logError } from '@/lib/errors'
import { recordJobRun } from '@/lib/health'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { analyzeConversations } from '@/lib/agent/conversationLearnings'
import { analyzeActionOutcomes, analyzeRecommendationOutcomes } from '@/lib/agent/outcomeLearnings'
import type { Member } from '@/types'
import {
  DEFAULT_TZ,
  WEEKLY_LEARNINGS_JOB,
  doneKeysFromRuns,
  dueMembers,
  isInWeeklyRunWindow,
  isoWeekKey,
  markerKey,
  memberHistory,
} from '@/lib/agent/weeklyLearningsSchedule'

export const DEFAULT_MAX_MEMBERS_PER_TICK = 10
// ISO week is 7 days; 9 covers any timezone offset at the edges.
const MARKER_LOOKBACK_DAYS = 9

export type WeeklyLearningsTickResult = {
  cxoTenants: number
  tenantsInWindow: number
  analyzed: number
  outcomePasses: number
  deferred: number
  errors: number
  results: Array<{ slug: string; analyzed: number }>
  skippedReason?: string
}

async function loadDoneKeys(now: Date): Promise<Set<string> | null> {
  const since = new Date(now.getTime() - MARKER_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('job_runs')
    .select('meta, ok')
    .eq('job', WEEKLY_LEARNINGS_JOB)
    .gte('started_at', since)
    .limit(5000)
  if (error) return null
  return doneKeysFromRuns((data ?? []) as Array<{ meta: unknown; ok: boolean | null }>)
}

export async function runWeeklyLearningsTick(
  opts: { force?: boolean; maxMembers?: number; now?: Date } = {},
): Promise<WeeklyLearningsTickResult> {
  const now = opts.now ?? new Date()
  const force = Boolean(opts.force)
  const envCap = parseInt(process.env.CIAO_LEARNINGS_MAX_MEMBERS_PER_TICK ?? '', 10)
  const maxMembers = opts.maxMembers ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : DEFAULT_MAX_MEMBERS_PER_TICK)

  const out: WeeklyLearningsTickResult = {
    cxoTenants: 0,
    tenantsInWindow: 0,
    analyzed: 0,
    outcomePasses: 0,
    deferred: 0,
    errors: 0,
    results: [],
  }

  const tenants = (await getAllActiveTenants()).filter(
    (t) => (t.brand ?? 'virtualcloser') === 'cxo',
  )
  out.cxoTenants = tenants.length
  const inWindow = force ? tenants : tenants.filter((t) => isInWeeklyRunWindow(now, t.timezone || DEFAULT_TZ))
  out.tenantsInWindow = inWindow.length
  if (inWindow.length === 0) return out

  // Fail closed: if the markers can't be read we can't prove a member is not
  // done, so skip rather than risk re-running paid AI every check.
  const done = force ? new Set<string>() : await loadDoneKeys(now)
  if (!done) {
    out.skippedReason = 'job_runs markers unreadable'
    console.warn('[weekly-learnings] could not read job_runs markers; skipping this check')
    return out
  }

  let budget = maxMembers
  for (const tenant of inWindow) {
    const week = isoWeekKey(now, tenant.timezone || DEFAULT_TZ)
    try {
      const members = await listMembers(tenant.id)
      const due = dueMembers(tenant.id, members, week, done)
      const take = due.slice(0, Math.max(0, budget))
      out.deferred += due.length - take.length

      let analyzed = 0
      for (const m of take) {
        budget--
        try {
          await recordJobRun(
            WEEKLY_LEARNINGS_JOB,
            () =>
              analyzeConversations({
                repId: tenant.id,
                memberId: m.id,
                createdBy: (m as Member).display_name,
                history: memberHistory(m),
              }),
            { rep_id: tenant.id, member_id: m.id, week },
          )
          done.add(markerKey(tenant.id, m.id, week))
          analyzed++
        } catch (err) {
          out.errors++
          await reportError(tenant, 'member_learnings_failed', err, m.id)
        }
      }
      out.analyzed += analyzed
      if (analyzed > 0) out.results.push({ slug: tenant.slug, analyzed })

      // Tenant-level outcome pass: pure statistics, no AI, once per week.
      if (!done.has(markerKey(tenant.id, null, week))) {
        await recordJobRun(
          WEEKLY_LEARNINGS_JOB,
          async () => {
            await analyzeActionOutcomes({ repId: tenant.id }).catch(() => {})
            await analyzeRecommendationOutcomes({ repId: tenant.id }).catch(() => {})
          },
          { rep_id: tenant.id, member_id: null, week },
        )
        done.add(markerKey(tenant.id, null, week))
        out.outcomePasses++
      }
    } catch (err) {
      out.errors++
      await reportError(tenant, 'tenant_learnings_failed', err, null)
    }
  }
  return out
}

async function reportError(tenant: Tenant, errorType: string, err: unknown, memberId: string | null) {
  await logError({
    source: 'worker/weekly-learnings',
    errorType,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    repId: tenant.id,
    ...(memberId ? { memberId } : {}),
    context: { tenant: tenant.slug, memberId },
  }).catch(() => {})
}
