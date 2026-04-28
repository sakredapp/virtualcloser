import { supabase } from './supabase'

export type ProspectStatus = 'new' | 'contacted' | 'booked' | 'won' | 'lost' | 'canceled'

export type Prospect = {
  id: string
  source: string
  external_id: string | null
  name: string | null
  email: string | null
  company: string | null
  phone: string | null
  tier_interest: string | null
  notes: string | null
  booking_url: string | null
  meeting_at: string | null
  timezone: string | null
  status: ProspectStatus
  payload: Record<string, unknown>
  rep_id: string | null
  // Build planning
  build_brief: string | null
  build_plan: string | null
  build_summary: string | null
  build_cost_estimate: number | null
  maintenance_estimate: number | null
  plan_generated_at: string | null
  // Per-prospect feature selection
  selected_features: string[] | null
  // Per-prospect add-on cart (mirrors /offer cart, copied to client_addons on convert)
  selected_addons: string[] | null
  created_at: string
  updated_at: string
}

export type ProspectUpsert = {
  source?: string
  external_id?: string | null
  name?: string | null
  email?: string | null
  company?: string | null
  phone?: string | null
  tier_interest?: string | null
  notes?: string | null
  booking_url?: string | null
  meeting_at?: string | null
  timezone?: string | null
  status?: ProspectStatus
  payload?: Record<string, unknown>
}

export async function upsertProspect(input: ProspectUpsert): Promise<Prospect> {
  const row = {
    source: input.source ?? 'cal.com',
    external_id: input.external_id ?? null,
    name: input.name ?? null,
    email: input.email ?? null,
    company: input.company ?? null,
    phone: input.phone ?? null,
    tier_interest: input.tier_interest ?? null,
    notes: input.notes ?? null,
    booking_url: input.booking_url ?? null,
    meeting_at: input.meeting_at ?? null,
    timezone: input.timezone ?? null,
    status: input.status ?? 'new',
    payload: input.payload ?? {},
  }
  if (row.external_id) {
    const { data, error } = await supabase
      .from('prospects')
      .upsert(row, { onConflict: 'source,external_id' })
      .select()
      .single()
    if (error) throw error
    return data as Prospect
  }
  const { data, error } = await supabase.from('prospects').insert(row).select().single()
  if (error) throw error
  return data as Prospect
}

export async function listProspects(limit = 200): Promise<Prospect[]> {
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Prospect[]
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Prospect | null) ?? null
}

export async function updateProspect(
  id: string,
  patch: Partial<Prospect>
): Promise<void> {
  const { error } = await supabase.from('prospects').update(patch).eq('id', id)
  if (error) throw error
}
