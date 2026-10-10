import { NextRequest, NextResponse } from 'next/server'
import {
  getAllLeads,
  getLatestEmailDraftAction,
  logAgentAction,
  logAgentRun,
  shouldDraftForLead,
  updateLeadStatus,
} from '@/lib/supabase'
import {
  classifyLead,
  draftFollowUp,
} from '@/lib/claude'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { logError } from '@/lib/errors'
import { listMembers } from '@/lib/members'
import { refreshTargetProgress } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import type { LeadStatus } from '@/types'

async function runForTenant(tenant: Tenant) {
  // ── Timezone gate: only run at 9 AM local time ────────────────────────
  // Fires hourly; we gate internally so every timezone gets its scan at the
  // right local 9 AM. Output is DB-only: lead statuses, email drafts for the
  // approval queue, target progress and the agent run log.
  let members: Awaited<ReturnType<typeof listMembers>> = []
  try {
    members = await listMembers(tenant.id)
  } catch (err) {
    console.error(`[${tenant.slug}] listMembers failed`, err)
    await logError({
      source: 'cron/morning-scan',
      errorType: 'list_members_failed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      repId: tenant.id,
      context: { tenant: tenant.slug },
    })
  }
  const owner = members.find((m) => m.role === 'owner') ?? null
  const tz = owner?.timezone ?? tenant.timezone ?? 'UTC'
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  )
  if (localHour !== 9) {
    return { tenant: tenant.slug, skipped: `not 9am local (hour=${localHour} tz=${tz})` }
  }

  const leads = await getAllLeads(tenant.id)
  let actionsCreated = 0

  for (const lead of leads) {
    try {
      const { status } = await classifyLead({
        name: lead.name,
        company: lead.company || '',
        lastContact: lead.last_contact,
        notes: lead.notes || '',
      })

      if (status !== lead.status) {
        await updateLeadStatus(lead.id, status as LeadStatus, tenant.id)
      }

      if (status === 'hot' || status === 'warm') {
        // Skip if the lead already has a pending draft, or a dismissed/sent one
        // with no new contact since — otherwise dismissed drafts reappear here
        // on every daily run.
        const latestDraft = await getLatestEmailDraftAction(tenant.id, lead.id)
        if (shouldDraftForLead(latestDraft, lead.last_contact)) {
          const draft = await draftFollowUp({
            name: lead.name,
            company: lead.company || '',
            status,
            notes: lead.notes || '',
            lastContact: lead.last_contact,
          })

          await logAgentAction({
            repId: tenant.id,
            leadId: lead.id,
            actionType: 'email_draft',
            content: JSON.stringify(draft),
          })

          actionsCreated++
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 300))
    } catch (err) {
      console.error(`[${tenant.slug}] Error processing lead ${lead.id}:`, err)
      await logError({
        source: 'cron/morning-scan',
        errorType: 'lead_processing_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        context: { tenant: tenant.slug, leadId: lead.id },
      })
    }
  }

  // Refresh goal progress so the dashboard goal cards are current.
  try {
    await refreshTargetProgress(tenant.id)
  } catch (err) {
    console.error(`[${tenant.slug}] refreshTargetProgress failed`, err)
    await logError({
      source: 'cron/morning-scan',
      errorType: 'refresh_target_progress_failed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      repId: tenant.id,
      context: { tenant: tenant.slug },
    })
  }

  await logAgentRun({
    repId: tenant.id,
    runType: 'morning_scan',
    leadsProcessed: leads.length,
    actionsCreated,
    status: 'success',
  })

  return { tenant: tenant.slug, leadsProcessed: leads.length, actionsCreated }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!isAuthorizedCron(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenants = await getAllActiveTenants()
  const results = []
  for (const tenant of tenants) {
    try {
      results.push(await runForTenant(tenant))
    } catch (err) {
      console.error(`Morning scan failed for ${tenant.slug}:`, err)
      await logError({
        source: 'cron/morning-scan',
        errorType: 'tenant_scan_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        context: { tenant: tenant.slug },
      })
      await logAgentRun({
        repId: tenant.id,
        runType: 'morning_scan',
        leadsProcessed: 0,
        actionsCreated: 0,
        status: 'error',
        error: String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, tenants: results })
}
