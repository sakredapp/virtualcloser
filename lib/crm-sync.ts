/**
 * CRM sync layer — lightweight push/pull for pipeline mirroring.
 *
 * Design principles:
 *  - We NEVER replicate full contact records. We only store name + company +
 *    email + the external ID so we can push stage moves back.
 *  - Inbound pull (CRM → dashboard): only runs when a pipeline is configured
 *    with a crm_source. Creates/upserts leads by crm_object_id.
 *  - Outbound push (dashboard → CRM): called automatically when a lead's
 *    pipeline_stage_id changes. Silently no-ops if no CRM is linked.
 *
 * Supported CRMs: 'ghl' (GoHighLevel), 'hubspot'
 */

import { supabase } from './supabase'
import { getIntegrationConfig } from './client-integrations'
import { AgentCRM } from './agentcrm'

// ── Types ─────────────────────────────────────────────────────────────────

export type CrmSource = 'ghl' | 'hubspot'

export type CrmDeal = {
  crm_object_id: string    // native CRM deal/opportunity ID
  crm_stage_id: string     // native CRM stage ID
  name: string             // contact / company name to display
  company?: string | null
  email?: string | null
  deal_value?: number | null
}

export type CrmPipeline = {
  id: string
  name: string
  stages: Array<{ id: string; name: string; order?: number }>
}

// ── Outbound: push a stage move back to the CRM ──────────────────────────

/**
 * After moving a lead to a new stage in our dashboard, call this to
 * mirror the move in the external CRM. Silently returns if the lead
 * has no CRM link or the pipeline has no crm_source.
 */
export async function pushStageToCRM(
  repId: string,
  leadId: string,
  newStageId: string,         // our internal pipeline_stage_id
): Promise<{ pushed: boolean; crmSource?: string }> {
  // Fetch the lead + its linked pipeline stage in one query
  const { data: lead } = await supabase
    .from('leads')
    .select('crm_object_id, crm_source, pipeline_id')
    .eq('id', leadId)
    .eq('rep_id', repId)
    .maybeSingle()

  if (!lead?.crm_object_id || !lead?.crm_source) return { pushed: false }

  // Get the CRM stage ID mapped to our internal stage
  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('crm_stage_id')
    .eq('id', newStageId)
    .eq('rep_id', repId)
    .maybeSingle()

  const crmStageId = (stage as { crm_stage_id: string | null } | null)?.crm_stage_id
  if (!crmStageId) return { pushed: false } // no mapping configured

  const source = lead.crm_source as CrmSource

  if (source === 'ghl') {
    return pushToGHL(repId, lead.crm_object_id, crmStageId)
  }
  if (source === 'hubspot') {
    return pushToHubSpot(repId, lead.crm_object_id, crmStageId)
  }
  return { pushed: false }
}

async function pushToGHL(
  repId: string,
  opportunityId: string,
  stageId: string,
): Promise<{ pushed: boolean; crmSource: string }> {
  const config = await getIntegrationConfig(repId, 'ghl')
  if (!config?.api_key || !config?.location_id) return { pushed: false, crmSource: 'ghl' }
  try {
    const crm = new AgentCRM(config.api_key as string, config.location_id as string)
    await crm.moveOpportunityStage(opportunityId, stageId)
    return { pushed: true, crmSource: 'ghl' }
  } catch (err) {
    console.error('[crm-sync] GHL push failed', err)
    return { pushed: false, crmSource: 'ghl' }
  }
}

async function pushToHubSpot(
  repId: string,
  dealId: string,
  stageId: string,
): Promise<{ pushed: boolean; crmSource: string }> {
  const config = await getIntegrationConfig(repId, 'hubspot')
  const apiKey = config?.api_key as string | undefined
  if (!apiKey) return { pushed: false, crmSource: 'hubspot' }
  try {
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: { dealstage: stageId } }),
      },
    )
    if (!res.ok) throw new Error(`HubSpot ${res.status}`)
    return { pushed: true, crmSource: 'hubspot' }
  } catch (err) {
    console.error('[crm-sync] HubSpot push failed', err)
    return { pushed: false, crmSource: 'hubspot' }
  }
}

// ── Inbound: list CRM pipelines so user can pick one to mirror ───────────

/**
 * Returns available pipelines from the CRM so the admin/owner can pick
 * which one to mirror and map stages. Used in the pipeline settings UI.
 */
export async function fetchCrmPipelines(
  repId: string,
  source: CrmSource,
): Promise<CrmPipeline[]> {
  if (source === 'ghl') return fetchGHLPipelines(repId)
  if (source === 'hubspot') return fetchHubSpotPipelines(repId)
  return []
}

async function fetchGHLPipelines(repId: string): Promise<CrmPipeline[]> {
  const config = await getIntegrationConfig(repId, 'ghl')
  if (!config?.api_key || !config?.location_id) return []
  try {
    const res = await fetch(
      `https://public-api.gohighlevel.com/v1/opportunities/pipelines?locationId=${config.location_id}`,
      { headers: { Authorization: `Bearer ${config.api_key}` } },
    )
    if (!res.ok) return []
    const data = await res.json() as { pipelines?: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string; position?: number }> }> }
    return (data.pipelines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name, order: s.position })),
    }))
  } catch {
    return []
  }
}

async function fetchHubSpotPipelines(repId: string): Promise<CrmPipeline[]> {
  const config = await getIntegrationConfig(repId, 'hubspot')
  const apiKey = config?.api_key as string | undefined
  if (!apiKey) return []
  try {
    const res = await fetch(
      'https://api.hubapi.com/crm/v3/pipelines/deals',
      { headers: { Authorization: `Bearer ${apiKey}` } },
    )
    if (!res.ok) return []
    const data = await res.json() as { results?: Array<{ id: string; label: string; stages?: Array<{ id: string; label: string; displayOrder?: number }> }> }
    return (data.results ?? []).map((p) => ({
      id: p.id,
      name: p.label,
      stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.label, order: s.displayOrder })),
    }))
  } catch {
    return []
  }
}

// ── Inbound: pull deals from CRM → upsert into leads + assign stages ─────

/**
 * Pull all deals for a CRM-linked pipeline and upsert them into `leads`.
 * Only stores: name, company, email, deal_value, crm_object_id, crm_stage_id.
 * Assigns leads to the matching pipeline_stage based on stage mapping.
 * Returns counts of created/updated rows.
 */
export async function pullDealsFromCRM(
  repId: string,
  pipelineId: string,
): Promise<{ created: number; updated: number; error?: string }> {
  // Load the pipeline with its stage mappings
  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('crm_source, crm_pipeline_id')
    .eq('id', pipelineId)
    .eq('rep_id', repId)
    .maybeSingle()

  if (!pipeline?.crm_source || !pipeline?.crm_pipeline_id) {
    return { created: 0, updated: 0, error: 'Pipeline has no CRM source configured' }
  }

  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('id, crm_stage_id')
    .eq('pipeline_id', pipelineId)
    .eq('rep_id', repId)
  const stageMap = new Map<string, string>()
  for (const s of (stages ?? []) as Array<{ id: string; crm_stage_id: string | null }>) {
    if (s.crm_stage_id) stageMap.set(s.crm_stage_id, s.id)
  }

  const source = pipeline.crm_source as CrmSource
  let deals: CrmDeal[] = []
  try {
    if (source === 'ghl') {
      deals = await fetchGHLDeals(repId, pipeline.crm_pipeline_id)
    } else if (source === 'hubspot') {
      deals = await fetchHubSpotDeals(repId, pipeline.crm_pipeline_id)
    }
  } catch (err) {
    return { created: 0, updated: 0, error: String(err) }
  }

  let created = 0
  let updated = 0

  for (const deal of deals) {
    const stageId = stageMap.get(deal.crm_stage_id) ?? null

    // Check if this lead already exists by crm_object_id
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('rep_id', repId)
      .eq('crm_source', source)
      .eq('crm_object_id', deal.crm_object_id)
      .maybeSingle()

    if (existing) {
      // Update stage only — don't overwrite name/company/email if the rep
      // has already enriched those fields
      await supabase
        .from('leads')
        .update({
          pipeline_id: pipelineId,
          pipeline_stage_id: stageId,
          deal_value: deal.deal_value ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id)
        .eq('rep_id', repId)
      updated++
    } else {
      // Create a minimal lead record
      await supabase.from('leads').insert({
        rep_id: repId,
        name: deal.name,
        company: deal.company ?? null,
        email: deal.email ?? null,
        deal_value: deal.deal_value ?? null,
        status: 'warm',
        crm_source: source,
        crm_object_id: deal.crm_object_id,
        pipeline_id: pipelineId,
        pipeline_stage_id: stageId,
        source: source,
      })
      created++
    }
  }

  // Stamp the last sync time on the pipeline
  await supabase
    .from('pipelines')
    .update({ crm_last_synced_at: new Date().toISOString() })
    .eq('id', pipelineId)
    .eq('rep_id', repId)

  return { created, updated }
}

async function fetchGHLDeals(repId: string, pipelineId: string): Promise<CrmDeal[]> {
  const config = await getIntegrationConfig(repId, 'ghl')
  if (!config?.api_key || !config?.location_id) return []

  const params = new URLSearchParams({
    location_id: config.location_id as string,
    pipeline_id: pipelineId,
    limit: '100',
  })
  const res = await fetch(
    `https://public-api.gohighlevel.com/v1/opportunities/search?${params}`,
    { headers: { Authorization: `Bearer ${config.api_key}` } },
  )
  if (!res.ok) throw new Error(`GHL ${res.status}`)
  const data = await res.json() as {
    opportunities?: Array<{
      id: string
      stageId: string
      title: string
      monetaryValue?: number
      contact?: { name?: string; email?: string; companyName?: string }
    }>
  }
  return (data.opportunities ?? []).map((o) => ({
    crm_object_id: o.id,
    crm_stage_id: o.stageId,
    name: o.contact?.name ?? o.title,
    company: o.contact?.companyName ?? null,
    email: o.contact?.email ?? null,
    deal_value: o.monetaryValue ?? null,
  }))
}

async function fetchHubSpotDeals(repId: string, pipelineId: string): Promise<CrmDeal[]> {
  const config = await getIntegrationConfig(repId, 'hubspot')
  const apiKey = config?.api_key as string | undefined
  if (!apiKey) return []

  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: pipelineId },
          { propertyName: 'hs_is_closed_won', operator: 'NEQ', value: 'true' },
        ],
      },
    ],
    properties: ['dealname', 'dealstage', 'amount', 'closedate'],
    limit: 100,
  }

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}`)
  const data = await res.json() as {
    results?: Array<{
      id: string
      properties: {
        dealname?: string
        dealstage?: string
        amount?: string
        associations?: { contacts?: { results?: Array<{ id: string }> } }
      }
    }>
  }

  return (data.results ?? []).map((d) => ({
    crm_object_id: d.id,
    crm_stage_id: d.properties.dealstage ?? '',
    name: d.properties.dealname ?? 'Unknown',
    company: null,   // deal records don't carry company directly — kept null intentionally
    email: null,
    deal_value: d.properties.amount ? parseFloat(d.properties.amount) : null,
  }))
}
