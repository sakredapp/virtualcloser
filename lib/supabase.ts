import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AgentAction,
  AgentRun,
  BrainDump,
  BrainItem,
  BrainItemHorizon,
  BrainItemStatus,
  BrainItemType,
  Lead,
  LeadStatus,
} from '@/types'

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    )
  }
  _client = createClient(url, key)
  return _client
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = getClient() as unknown as Record<string | symbol, unknown>
    const v = c[prop]
    return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(c) : v
  },
})

const STATUS_PRIORITY: Record<LeadStatus, number> = {
  hot: 0,
  warm: 1,
  cold: 2,
  dormant: 3,
}

export async function getAllLeads(repId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('rep_id', repId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Lead[]
}

export async function getLeadsByPriority(repId: string): Promise<Lead[]> {
  const leads = await getAllLeads(repId)

  return leads.sort((a, b) => {
    const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
    if (statusDiff !== 0) return statusDiff

    const aDate = new Date(a.updated_at).getTime()
    const bDate = new Date(b.updated_at).getTime()
    return bDate - aDate
  })
}

export async function getDormantLeads(repId: string, dayThreshold = 14): Promise<Lead[]> {
  const cutoff = new Date(Date.now() - dayThreshold * 86400000).toISOString()

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('rep_id', repId)
    .or(`last_contact.lt.${cutoff},last_contact.is.null`)
    .neq('status', 'dormant')

  if (error) throw error
  return (data ?? []) as Lead[]
}

export async function getPendingEmailDrafts(repId: string): Promise<
  Array<{
    action: AgentAction
    lead: Lead | null
    draft: { subject: string; body: string }
  }>
> {
  const { data: actions, error: actionError } = await supabase
    .from('agent_actions')
    .select('*')
    .eq('rep_id', repId)
    .eq('action_type', 'email_draft')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (actionError) throw actionError

  const typedActions = (actions ?? []) as AgentAction[]
  const leadIds = Array.from(new Set(typedActions.map((action) => action.lead_id).filter(Boolean)))

  const leadsById = new Map<string, Lead>()
  if (leadIds.length > 0) {
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('rep_id', repId)
      .in('id', leadIds as string[])

    if (leadError) throw leadError
    for (const lead of (leads ?? []) as Lead[]) {
      leadsById.set(lead.id, lead)
    }
  }

  return typedActions.map((action) => {
    let parsed = { subject: 'Draft email', body: action.content }
    try {
      const content = JSON.parse(action.content)
      parsed = {
        subject: typeof content.subject === 'string' ? content.subject : 'Draft email',
        body: typeof content.body === 'string' ? content.body : action.content,
      }
    } catch {
      // Keep fallback values if content is plain text.
    }

    return {
      action,
      lead: action.lead_id ? leadsById.get(action.lead_id) ?? null : null,
      draft: parsed,
    }
  })
}

export async function getTodayRunSummary(repId: string): Promise<{
  runsToday: number
  leadsProcessed: number
  actionsCreated: number
  latestRunType: string | null
  latestRunAt: string | null
}> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('rep_id', repId)
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: false })

  if (error) throw error

  const runs = (data ?? []) as AgentRun[]
  return {
    runsToday: runs.length,
    leadsProcessed: runs.reduce((sum, run) => sum + (run.leads_processed ?? 0), 0),
    actionsCreated: runs.reduce((sum, run) => sum + (run.actions_created ?? 0), 0),
    latestRunType: runs[0]?.run_type ?? null,
    latestRunAt: runs[0]?.created_at ?? null,
  }
}

export async function updateLeadStatus(leadId: string, status: LeadStatus, repId: string) {
  const { error } = await supabase
    .from('leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('rep_id', repId)

  if (error) throw error
}

export async function setAgentActionStatus(
  actionId: string,
  status: AgentAction['status'],
  repId: string
) {
  const { error } = await supabase
    .from('agent_actions')
    .update({ status })
    .eq('id', actionId)
    .eq('rep_id', repId)

  if (error) throw error
}

export async function logAgentAction(action: {
  repId: string
  leadId?: string
  actionType: AgentAction['action_type']
  content: string
}) {
  const { error } = await supabase.from('agent_actions').insert({
    rep_id: action.repId,
    lead_id: action.leadId,
    action_type: action.actionType,
    content: action.content,
    status: 'pending',
  })

  if (error) throw error
}

export async function logAgentRun(run: {
  repId: string
  runType: AgentRun['run_type']
  leadsProcessed: number
  actionsCreated: number
  status: AgentRun['status']
  error?: string
}) {
  const { error } = await supabase.from('agent_runs').insert({
    rep_id: run.repId,
    run_type: run.runType,
    leads_processed: run.leadsProcessed,
    actions_created: run.actionsCreated,
    status: run.status,
    error: run.error,
  })

  if (error) throw error
}

// ── Brain dump / items ──────────────────────────────────────────────────────

export async function createBrainDump(dump: {
  repId: string
  rawText: string
  summary?: string
  source?: 'mic' | 'manual' | 'import'
}): Promise<BrainDump> {
  const { data, error } = await supabase
    .from('brain_dumps')
    .insert({
      rep_id: dump.repId,
      raw_text: dump.rawText,
      summary: dump.summary,
      source: dump.source ?? 'mic',
    })
    .select()
    .single()

  if (error) throw error
  return data as BrainDump
}

export async function createBrainItems(
  repId: string,
  brainDumpId: string,
  items: Array<{
    item_type: BrainItemType
    content: string
    priority?: 'low' | 'normal' | 'high'
    horizon?: BrainItemHorizon | null
    due_date?: string | null
  }>
): Promise<BrainItem[]> {
  if (items.length === 0) return []

  const rows = items.map((i) => ({
    rep_id: repId,
    brain_dump_id: brainDumpId,
    item_type: i.item_type,
    content: i.content,
    priority: i.priority ?? 'normal',
    horizon: i.horizon ?? null,
    due_date: i.due_date ?? null,
    status: 'open' as const,
  }))

  const { data, error } = await supabase.from('brain_items').insert(rows).select()
  if (error) throw error
  return (data ?? []) as BrainItem[]
}

export async function getOpenBrainItems(repId: string): Promise<BrainItem[]> {
  const { data, error } = await supabase
    .from('brain_items')
    .select('*')
    .eq('rep_id', repId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as BrainItem[]
}

export async function getRecentBrainDumps(repId: string, limit = 10): Promise<BrainDump[]> {
  const { data, error } = await supabase
    .from('brain_dumps')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as BrainDump[]
}

export async function setBrainItemStatus(
  itemId: string,
  status: BrainItemStatus,
  repId: string
) {
  const { error } = await supabase
    .from('brain_items')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('rep_id', repId)

  if (error) throw error
}