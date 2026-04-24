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

// ── Lead write helpers (used by Telegram NL router) ────────────────────────

export async function findLeadByName(repId: string, query: string): Promise<Lead | null> {
  const clean = query.trim()
  if (!clean) return null
  // Try exact, then ilike on name/company/email.
  const { data: exact } = await supabase
    .from('leads')
    .select('*')
    .eq('rep_id', repId)
    .ilike('name', clean)
    .limit(1)
  if (exact && exact.length > 0) return exact[0] as Lead

  const pattern = `%${clean}%`
  const { data: fuzzy } = await supabase
    .from('leads')
    .select('*')
    .eq('rep_id', repId)
    .or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`)
    .order('updated_at', { ascending: false })
    .limit(1)
  return (fuzzy && fuzzy.length > 0 ? (fuzzy[0] as Lead) : null)
}

export async function upsertLead(input: {
  repId: string
  name: string
  company?: string | null
  email?: string | null
  status?: LeadStatus
  notes?: string | null
  source?: string | null
  touchContact?: boolean
}): Promise<Lead> {
  // Try to find an existing lead by name/company first.
  const existing = await findLeadByName(input.repId, input.name)
  const nowIso = new Date().toISOString()

  if (existing) {
    const merged: Partial<Lead> = {}
    if (input.company && !existing.company) merged.company = input.company
    if (input.email && !existing.email) merged.email = input.email
    if (input.status) merged.status = input.status
    if (input.notes) {
      const existingNotes = existing.notes ? `${existing.notes}\n` : ''
      merged.notes = `${existingNotes}[${nowIso.slice(0, 10)}] ${input.notes}`
    }
    if (input.touchContact) merged.last_contact = nowIso

    if (Object.keys(merged).length === 0) return existing

    const { data, error } = await supabase
      .from('leads')
      .update(merged)
      .eq('id', existing.id)
      .eq('rep_id', input.repId)
      .select()
      .single()
    if (error) throw error
    return data as Lead
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      rep_id: input.repId,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      status: input.status ?? 'warm',
      notes: input.notes ?? null,
      source: input.source ?? 'telegram',
      last_contact: input.touchContact ? nowIso : null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Lead
}

export async function getRecentLeadNames(repId: string, limit = 40): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('rep_id', repId)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Lead[]
}

export async function getBrainItemsDueOnOrBefore(
  repId: string,
  dateIso: string
): Promise<BrainItem[]> {
  const { data, error } = await supabase
    .from('brain_items')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'open')
    .not('due_date', 'is', null)
    .lte('due_date', dateIso)
    .order('due_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as BrainItem[]
}

/**
 * Brain-as-nucleus dashboard view. Groups all open brain_items into
 * focus buckets so the dashboard reflects whatever the rep has been
 * dumping into Telegram (or the brain page).
 *
 * Buckets:
 *  - overdue: open items with due_date < today
 *  - today: due_date = today OR (no due_date AND horizon='day')
 *  - thisWeek: due_date in next 7 days OR horizon='week'
 *  - thisMonth: due_date in next 31 days OR horizon='month'
 *  - longRange: horizon in ('quarter','year')
 *  - goals: item_type='goal' (kept separate, pinned at top of UI)
 *  - inbox: everything else (idea/note/plan with no horizon or 'none')
 */
export type BrainBuckets = {
  overdue: BrainItem[]
  today: BrainItem[]
  thisWeek: BrainItem[]
  thisMonth: BrainItem[]
  longRange: BrainItem[]
  goals: BrainItem[]
  inbox: BrainItem[]
}

export async function getBrainBuckets(repId: string): Promise<BrainBuckets> {
  const { data, error } = await supabase
    .from('brain_items')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'open')
    .order('priority', { ascending: false })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  const items = (data ?? []) as BrainItem[]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString().slice(0, 10)
  const in7 = new Date(today)
  in7.setDate(in7.getDate() + 7)
  const in7Iso = in7.toISOString().slice(0, 10)
  const in31 = new Date(today)
  in31.setDate(in31.getDate() + 31)
  const in31Iso = in31.toISOString().slice(0, 10)

  const buckets: BrainBuckets = {
    overdue: [],
    today: [],
    thisWeek: [],
    thisMonth: [],
    longRange: [],
    goals: [],
    inbox: [],
  }

  for (const it of items) {
    if (it.item_type === 'goal') {
      buckets.goals.push(it)
      continue
    }

    const due = it.due_date // 'YYYY-MM-DD' or null

    if (due) {
      if (due < todayIso) {
        buckets.overdue.push(it)
      } else if (due === todayIso) {
        buckets.today.push(it)
      } else if (due <= in7Iso) {
        buckets.thisWeek.push(it)
      } else if (due <= in31Iso) {
        buckets.thisMonth.push(it)
      } else {
        buckets.longRange.push(it)
      }
      continue
    }

    // No due_date — fall back to horizon.
    switch (it.horizon) {
      case 'day':
        buckets.today.push(it)
        break
      case 'week':
        buckets.thisWeek.push(it)
        break
      case 'month':
        buckets.thisMonth.push(it)
        break
      case 'quarter':
      case 'year':
        buckets.longRange.push(it)
        break
      default:
        buckets.inbox.push(it)
    }
  }

  return buckets
}