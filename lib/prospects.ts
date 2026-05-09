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
  reminder_24h_sent_at: string | null
  reminder_1h_sent_at: string | null
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
  const source = input.source ?? 'cal.com'
  const row = {
    source,
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

  // 1. Same booking (reschedule / update) — exact match by source + external_id.
  if (row.external_id) {
    const { data: existing } = await supabase
      .from('prospects')
      .select('id')
      .eq('source', source)
      .eq('external_id', row.external_id)
      .maybeSingle()

    if (existing) {
      const { data, error } = await supabase
        .from('prospects')
        .update(row)
        .eq('id', existing.id)
        .select()
        .single()
      if (error) throw error
      return data as Prospect
    }
  }

  // 2. Returning prospect — different booking ID but same email.
  //    Update the existing row's booking fields; never touch pipeline_stage or status.
  if (row.email) {
    const byEmail = await findProspectByEmail(row.email)
    if (byEmail) {
      const existingHistory = Array.isArray(
        (byEmail.payload as Record<string, unknown>)?.booking_history
      )
        ? [...((byEmail.payload as Record<string, unknown>).booking_history as unknown[])]
        : []

      // Append this new booking to history
      existingHistory.push({
        external_id: row.external_id,
        source,
        meeting_at: row.meeting_at,
        booked_at: new Date().toISOString(),
        name: row.name,
      })

      const patch: Record<string, unknown> = {
        meeting_at: row.meeting_at ?? byEmail.meeting_at,
        payload: {
          ...(byEmail.payload as Record<string, unknown>),
          booking_history: existingHistory,
        },
      }
      // Advance external_id to the latest booking so future reschedules resolve correctly
      if (row.external_id) patch.external_id = row.external_id
      if (row.booking_url) patch.booking_url = row.booking_url
      // Fill in fields that were blank on the original record
      if (!byEmail.name && row.name) patch.name = row.name
      if (!byEmail.phone && row.phone) patch.phone = row.phone
      if (!byEmail.company && row.company) patch.company = row.company
      if (!byEmail.timezone && row.timezone) patch.timezone = row.timezone

      const { data, error } = await supabase
        .from('prospects')
        .update(patch)
        .eq('id', byEmail.id)
        .select()
        .single()
      if (error) throw error
      return data as Prospect
    }
  }

  // 3. Genuinely new prospect — insert.
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

// Returns the oldest prospect row for this email (canonical record).
export async function findProspectByEmail(email: string): Promise<Prospect | null> {
  const { data } = await supabase
    .from('prospects')
    .select('*')
    .ilike('email', email.trim())
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as Prospect | null) ?? null
}

// Returns all prospect rows for this email, newest first — used for booking history.
export async function listProspectsByEmail(email: string): Promise<Prospect[]> {
  const { data } = await supabase
    .from('prospects')
    .select('*')
    .ilike('email', email.trim())
    .order('created_at', { ascending: false })
  return (data ?? []) as Prospect[]
}
