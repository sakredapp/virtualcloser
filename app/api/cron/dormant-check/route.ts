import { NextRequest, NextResponse } from 'next/server'
import { draftFollowUp } from '@/lib/claude'
import {
  getDormantLeads,
  logAgentAction,
  logAgentRun,
  updateLeadStatus,
} from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'

async function runForTenant(tenant: Tenant) {
  const dormantCandidates = await getDormantLeads(tenant.id, 14)
  let actionsCreated = 0

  for (const lead of dormantCandidates) {
    const draft = await draftFollowUp({
      name: lead.name,
      company: lead.company || '',
      status: 'dormant',
      notes: lead.notes || '',
      lastContact: lead.last_contact,
    })

    await updateLeadStatus(lead.id, 'dormant', tenant.id)
    await logAgentAction({
      repId: tenant.id,
      leadId: lead.id,
      actionType: 'dormant_flag',
      content: JSON.stringify(draft),
    })

    actionsCreated++
  }

  await logAgentRun({
    repId: tenant.id,
    runType: 'dormant_check',
    leadsProcessed: dormantCandidates.length,
    actionsCreated,
    status: 'success',
  })

  return { tenant: tenant.slug, leadsProcessed: dormantCandidates.length, actionsCreated }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenants = await getAllActiveTenants()
  const results = []
  for (const tenant of tenants) {
    try {
      results.push(await runForTenant(tenant))
    } catch (err) {
      console.error(`Dormant check failed for ${tenant.slug}:`, err)
      await logAgentRun({
        repId: tenant.id,
        runType: 'dormant_check',
        leadsProcessed: 0,
        actionsCreated: 0,
        status: 'error',
        error: String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, tenants: results })
}
