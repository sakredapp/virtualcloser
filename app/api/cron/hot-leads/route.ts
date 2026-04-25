import { NextRequest, NextResponse } from 'next/server'
import { draftFollowUp } from '@/lib/claude'
import { getAllLeads, logAgentAction, logAgentRun } from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { isAuthorizedCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function runForTenant(tenant: Tenant) {
  const leads = await getAllLeads(tenant.id)
  const hotLeads = leads.filter((lead) => lead.status === 'hot')
  let actionsCreated = 0

  for (const lead of hotLeads) {
    const draft = await draftFollowUp({
      name: lead.name,
      company: lead.company || '',
      status: 'hot',
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

  await logAgentRun({
    repId: tenant.id,
    runType: 'hot_pulse',
    leadsProcessed: hotLeads.length,
    actionsCreated,
    status: 'success',
  })

  return { tenant: tenant.slug, leadsProcessed: hotLeads.length, actionsCreated }
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
      console.error(`Hot pulse failed for ${tenant.slug}:`, err)
      await logAgentRun({
        repId: tenant.id,
        runType: 'hot_pulse',
        leadsProcessed: 0,
        actionsCreated: 0,
        status: 'error',
        error: String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, tenants: results })
}
