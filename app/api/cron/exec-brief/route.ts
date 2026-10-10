import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { logError } from '@/lib/errors'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { analyzeConversations } from '@/lib/agent/conversationLearnings'
import { analyzeActionOutcomes, analyzeRecommendationOutcomes } from '@/lib/agent/outcomeLearnings'
import type { BrandKey } from '@/lib/brand'
import type { Member } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Weekly learnings pass — CXO Suite tenants only.
 *
 * Runs hourly; acts once a week, Monday at 7am tenant-local. For every active
 * owner/admin it mines their Mira chat history for durable learnings and
 * capability gaps (plaud_agent_guidance / fix_requests), then lets the
 * note-agent self-teach from action + recommendation outcomes (what the exec
 * approves vs dismisses). All output is DB writes the app reads; nothing is
 * sent to anyone.
 */

const RUN_LOCAL_HOUR = 7

function localHour(tz: string | null | undefined, ref: Date = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hour: 'numeric', hour12: false }).format(ref),
    )
  } catch {
    return ref.getUTCHours()
  }
}

async function learnTenant(tenant: Tenant, force: boolean): Promise<number> {
  const tz = tenant.timezone || 'America/New_York'
  const weekday = new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
  if (!force && (weekday !== 'Mon' || localHour(tz) !== RUN_LOCAL_HOUR)) return 0

  const members = await listMembers(tenant.id)
  const execs = members.filter(
    (m: Member) => m.is_active && (m.role === 'owner' || m.role === 'admin'),
  )

  let analyzed = 0
  for (const m of execs) {
    try {
      await analyzeConversations({
        repId: tenant.id,
        memberId: m.id,
        createdBy: m.display_name,
        history: ((m.settings as Record<string, unknown>)?.agent_history as Array<{ role: string; content: string }>) ?? [],
      })
      analyzed++
    } catch (err) {
      console.error('[exec-brief] learnings failed for member', m.id, err)
      await logError({
        source: 'cron/exec-brief',
        errorType: 'member_learnings_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        memberId: m.id,
        context: { tenant: tenant.slug, memberId: m.id },
      })
    }
  }

  await analyzeActionOutcomes({ repId: tenant.id }).catch(() => {})
  await analyzeRecommendationOutcomes({ repId: tenant.id }).catch(() => {})
  return analyzed
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ?force=1 runs the pass now, ignoring the Monday 7am gate.
  const force = req.nextUrl.searchParams.get('force') === '1'

  const tenants = await getAllActiveTenants()
  const cxoTenants = tenants.filter(
    (t) => ((t as { brand?: BrandKey }).brand ?? 'virtualcloser') === 'cxo',
  )

  let totalAnalyzed = 0
  const results: Array<{ slug: string; analyzed: number }> = []
  for (const tenant of cxoTenants) {
    try {
      const analyzed = await learnTenant(tenant, force)
      if (analyzed > 0) results.push({ slug: tenant.slug, analyzed })
      totalAnalyzed += analyzed
    } catch (err) {
      console.error('[exec-brief] tenant failed', tenant.slug, err)
      await logError({
        source: 'cron/exec-brief',
        errorType: 'tenant_learnings_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        context: { tenant: tenant.slug },
      })
    }
  }

  return NextResponse.json({ ok: true, cxoTenants: cxoTenants.length, totalAnalyzed, results })
}
