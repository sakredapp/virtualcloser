import { supabase } from './supabase'
import { pushStageToCRM } from './crm-sync'

// Kinds of board a rep / manager / executive can run. 'sales' keeps using
// the leads table for cards (legacy + CRM mirror). Everything else stores
// cards in `pipeline_items` — so a recruiting board never leaks into the
// sales CRM and vice versa.
export type PipelineKind = 'sales' | 'recruiting' | 'team' | 'project' | 'custom'

export type Pipeline = {
  id: string
  rep_id: string
  name: string
  kind: PipelineKind
  description: string | null
  owner_member_id: string | null
  crm_source: string | null
  crm_pipeline_id: string | null
  crm_last_synced_at: string | null
  created_at: string
  updated_at: string
  stages: PipelineStage[]
}

export type PipelineItem = {
  id: string
  rep_id: string
  pipeline_id: string
  pipeline_stage_id: string | null
  owner_member_id: string | null
  title: string
  subtitle: string | null
  notes: string | null
  value: number | null
  value_currency: string | null
  status: 'open' | 'active' | 'blocked' | 'done' | 'archived'
  metadata: Record<string, unknown>
  position: number
  created_at: string
  updated_at: string
}

export type PipelineStage = {
  id: string
  pipeline_id: string
  rep_id: string
  name: string
  position: number
  color: string
  crm_stage_id: string | null
  created_at: string
  updated_at: string
}

export type PipelineLead = {
  id: string
  name: string
  company: string | null
  status: string
  pipeline_stage_id: string | null
  deal_value: number | null
}

// Per-kind seed stages. Reps can rename/delete/reorder freely after creation.
const DEFAULT_STAGES_BY_KIND: Record<PipelineKind, Array<{ name: string; color: string }>> = {
  sales: [
    { name: 'New Lead', color: '#94a3b8' },
    { name: 'Contacted', color: '#60a5fa' },
    { name: 'Demo', color: '#a78bfa' },
    { name: 'Proposal', color: '#f59e0b' },
    { name: 'Closed Won', color: '#22c55e' },
  ],
  recruiting: [
    { name: 'Sourced', color: '#94a3b8' },
    { name: 'Screening', color: '#60a5fa' },
    { name: 'Interview', color: '#a78bfa' },
    { name: 'Offer', color: '#f59e0b' },
    { name: 'Hired', color: '#22c55e' },
  ],
  team: [
    { name: 'Onboarding', color: '#94a3b8' },
    { name: 'Ramping', color: '#60a5fa' },
    { name: 'Performing', color: '#22c55e' },
    { name: 'Coaching', color: '#f59e0b' },
    { name: 'At Risk', color: '#ef4444' },
  ],
  project: [
    { name: 'Backlog', color: '#94a3b8' },
    { name: 'In Progress', color: '#60a5fa' },
    { name: 'Review', color: '#a78bfa' },
    { name: 'Blocked', color: '#ef4444' },
    { name: 'Done', color: '#22c55e' },
  ],
  custom: [
    { name: 'To Do', color: '#94a3b8' },
    { name: 'Doing', color: '#60a5fa' },
    { name: 'Done', color: '#22c55e' },
  ],
}

export async function getPipelinesForRep(repId: string): Promise<Pipeline[]> {
  const { data: pipelines, error } = await supabase
    .from('pipelines')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!pipelines?.length) return []

  const pipelineIds = pipelines.map((p) => p.id)
  const { data: stages, error: stagesError } = await supabase
    .from('pipeline_stages')
    .select('*')
    .in('pipeline_id', pipelineIds)
    .order('position', { ascending: true })
  if (stagesError) throw stagesError

  return pipelines.map((p) => ({
    ...p,
    stages: (stages ?? []).filter((s) => s.pipeline_id === p.id),
  })) as Pipeline[]
}

export async function createPipeline(
  repId: string,
  name: string,
  opts: {
    kind?: PipelineKind
    description?: string | null
    ownerMemberId?: string | null
  } = {},
): Promise<Pipeline> {
  const kind: PipelineKind = opts.kind ?? 'sales'
  const { data: pipeline, error } = await supabase
    .from('pipelines')
    .insert({
      rep_id: repId,
      name,
      kind,
      description: opts.description ?? null,
      owner_member_id: opts.ownerMemberId ?? null,
    })
    .select()
    .single()
  if (error) throw error

  const seed = DEFAULT_STAGES_BY_KIND[kind] ?? DEFAULT_STAGES_BY_KIND.sales
  const stageInserts = seed.map((s, i) => ({
    pipeline_id: pipeline.id,
    rep_id: repId,
    name: s.name,
    position: i,
    color: s.color,
  }))
  const { data: stages, error: stagesError } = await supabase
    .from('pipeline_stages')
    .insert(stageInserts)
    .select()
  if (stagesError) throw stagesError

  return { ...pipeline, stages: stages ?? [] } as Pipeline
}

export async function updatePipelineMeta(
  pipelineId: string,
  repId: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (typeof patch.name === 'string') update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description
  if (!Object.keys(update).length) return
  const { error } = await supabase
    .from('pipelines')
    .update(update)
    .eq('id', pipelineId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function updatePipeline(pipelineId: string, repId: string, name: string): Promise<void> {
  return updatePipelineMeta(pipelineId, repId, { name })
}

export async function deletePipeline(pipelineId: string, repId: string): Promise<void> {
  // Unassign all leads from this pipeline first
  await supabase
    .from('leads')
    .update({ pipeline_id: null, pipeline_stage_id: null })
    .eq('rep_id', repId)
    .eq('pipeline_id', pipelineId)

  const { error } = await supabase
    .from('pipelines')
    .delete()
    .eq('id', pipelineId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function addStage(
  pipelineId: string,
  repId: string,
  name: string,
  color?: string,
): Promise<PipelineStage> {
  const { data: existing } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: false })
    .limit(1)
  const maxPos = (existing?.[0] as { position: number } | undefined)?.position ?? -1

  const { data, error } = await supabase
    .from('pipeline_stages')
    .insert({
      pipeline_id: pipelineId,
      rep_id: repId,
      name,
      position: maxPos + 1,
      color: color ?? '#94a3b8',
    })
    .select()
    .single()
  if (error) throw error
  return data as PipelineStage
}

export async function updateStage(
  stageId: string,
  repId: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  const { error } = await supabase
    .from('pipeline_stages')
    .update(patch)
    .eq('id', stageId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function deleteStage(stageId: string, repId: string): Promise<void> {
  await supabase
    .from('leads')
    .update({ pipeline_stage_id: null })
    .eq('rep_id', repId)
    .eq('pipeline_stage_id', stageId)

  const { error } = await supabase
    .from('pipeline_stages')
    .delete()
    .eq('id', stageId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function reorderStages(
  pipelineId: string,
  repId: string,
  orderedStageIds: string[],
): Promise<void> {
  await Promise.all(
    orderedStageIds.map((id, i) =>
      supabase
        .from('pipeline_stages')
        .update({ position: i })
        .eq('id', id)
        .eq('pipeline_id', pipelineId)
        .eq('rep_id', repId),
    ),
  )
}

export async function moveLeadToStage(
  leadId: string,
  repId: string,
  pipelineId: string | null,
  stageId: string | null,
): Promise<{ crmPushed: boolean; crmSource?: string }> {
  const { error } = await supabase
    .from('leads')
    .update({ pipeline_id: pipelineId, pipeline_stage_id: stageId })
    .eq('id', leadId)
    .eq('rep_id', repId)
  if (error) throw error

  // Mirror the move in the external CRM if this lead has a CRM link and
  // the stage has a mapped crm_stage_id. Fire-and-forget from the caller's
  // perspective — failures are logged but don't throw.
  if (stageId) {
    const result = await pushStageToCRM(repId, leadId, stageId).catch((err) => {
      console.error('[pipelines] CRM push error', err)
      return { pushed: false }
    })
    return { crmPushed: result.pushed, crmSource: result.crmSource }
  }
  return { crmPushed: false }
}

export async function getLeadsForPipeline(
  pipelineId: string,
  repId: string,
): Promise<PipelineLead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, company, status, pipeline_stage_id, deal_value')
    .eq('rep_id', repId)
    .eq('pipeline_id', pipelineId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PipelineLead[]
}

export async function getUnassignedLeads(repId: string): Promise<PipelineLead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, company, status, pipeline_stage_id, deal_value')
    .eq('rep_id', repId)
    .is('pipeline_id', null)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as PipelineLead[]
}

/**
 * Fuzzy-match a stage by name across all of a rep's pipelines.
 * Used by the Telegram bot to resolve stage names from free text.
 */
export async function findStageByName(
  repId: string,
  stageName: string,
): Promise<PipelineStage | null> {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('rep_id', repId)
  if (error || !data?.length) return null

  const lower = stageName.toLowerCase()
  const exact = data.find((s) => s.name.toLowerCase() === lower)
  if (exact) return exact as PipelineStage

  const partial = data.find(
    (s) =>
      s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()),
  )
  return (partial ?? null) as PipelineStage | null
}

// ────────────────────────────────────────────────────────────────────────────
// Generic kanban items (used by every pipeline kind EXCEPT 'sales', which
// keeps reading from the leads table). Lets a manager run a recruiting board
// or an exec run a team board without polluting the sales CRM.
// ────────────────────────────────────────────────────────────────────────────

export async function getItemsForPipeline(
  pipelineId: string,
  repId: string,
): Promise<PipelineItem[]> {
  const { data, error } = await supabase
    .from('pipeline_items')
    .select('*')
    .eq('rep_id', repId)
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PipelineItem[]
}

export async function createItem(
  repId: string,
  pipelineId: string,
  patch: {
    title: string
    subtitle?: string | null
    notes?: string | null
    value?: number | null
    pipeline_stage_id?: string | null
    owner_member_id?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<PipelineItem> {
  const { data, error } = await supabase
    .from('pipeline_items')
    .insert({
      rep_id: repId,
      pipeline_id: pipelineId,
      title: patch.title,
      subtitle: patch.subtitle ?? null,
      notes: patch.notes ?? null,
      value: patch.value ?? null,
      pipeline_stage_id: patch.pipeline_stage_id ?? null,
      owner_member_id: patch.owner_member_id ?? null,
      metadata: patch.metadata ?? {},
    })
    .select()
    .single()
  if (error) throw error
  return data as PipelineItem
}

export async function updateItem(
  itemId: string,
  repId: string,
  patch: {
    title?: string
    subtitle?: string | null
    notes?: string | null
    value?: number | null
    status?: PipelineItem['status']
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (typeof patch.title === 'string') update.title = patch.title
  if (patch.subtitle !== undefined) update.subtitle = patch.subtitle
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.value !== undefined) update.value = patch.value
  if (patch.status !== undefined) update.status = patch.status
  if (patch.metadata !== undefined) update.metadata = patch.metadata
  if (!Object.keys(update).length) return
  const { error } = await supabase
    .from('pipeline_items')
    .update(update)
    .eq('id', itemId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function moveItemToStage(
  itemId: string,
  repId: string,
  stageId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('pipeline_items')
    .update({ pipeline_stage_id: stageId })
    .eq('id', itemId)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function deleteItem(itemId: string, repId: string): Promise<void> {
  const { error } = await supabase
    .from('pipeline_items')
    .delete()
    .eq('id', itemId)
    .eq('rep_id', repId)
  if (error) throw error
}
