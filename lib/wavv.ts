// WAVV dialer integration. WAVV is a phone dialer most agents use for
// outbound prospecting; we ingest its disposition webhooks into voice_calls
// + dialer_kpis so the rep sees their dial KPIs alongside the AI dialer.
//
// Credentials per-tenant via client_integrations key='wavv':
//   { api_key?: string, account_id?: string, webhook_secret?: string }
//
// The webhook is the primary integration surface — WAVV pushes a payload
// per call disposition. We don't need an API key just to ingest; the API
// key is reserved for an optional pull-based KPI backfill.

import { supabase } from './supabase'

export type WavvDailyKpis = {
  rep_id: string
  day: string                     // YYYY-MM-DD
  dials: number
  connects: number
  conversations: number
  appointments_set: number
  voicemails: number
  no_answers: number
  dial_time_seconds: number
  cost_cents: number
}

/**
 * Recompute today's dialer_kpis row for a rep from voice_calls.
 * Idempotent — safe to call after every WAVV ingest.
 */
export async function recomputeDailyKpis(repId: string, day: string): Promise<void> {
  const startIso = `${day}T00:00:00Z`
  const endIso = `${day}T23:59:59Z`
  const { data, error } = await supabase
    .from('voice_calls')
    .select('outcome, status, duration_sec, cost_cents')
    .eq('rep_id', repId)
    .gte('created_at', startIso)
    .lte('created_at', endIso)
  if (error) throw error
  const rows = data ?? []

  const kpi: WavvDailyKpis = {
    rep_id: repId,
    day,
    dials: rows.length,
    connects: 0,
    conversations: 0,
    appointments_set: 0,
    voicemails: 0,
    no_answers: 0,
    dial_time_seconds: 0,
    cost_cents: 0,
  }
  for (const r of rows) {
    if (r.duration_sec) kpi.dial_time_seconds += r.duration_sec
    if (r.cost_cents) kpi.cost_cents += r.cost_cents
    const o = (r.outcome ?? '') as string
    if (o === 'voicemail') kpi.voicemails++
    if (o === 'no_answer') kpi.no_answers++
    if (o === 'connected' || o === 'confirmed' || o === 'reschedule_requested' || o === 'rescheduled') {
      kpi.connects++
      if ((r.duration_sec ?? 0) >= 30) kpi.conversations++
    }
    if (o === 'confirmed' || o === 'rescheduled') kpi.appointments_set++
  }

  await supabase.from('dialer_kpis').upsert(kpi, { onConflict: 'rep_id,day' })
}

export async function getKpisForRep(
  repId: string,
  opts: { days?: number } = {},
): Promise<WavvDailyKpis[]> {
  const days = opts.days ?? 7
  const since = new Date(Date.now() - days * 86400_000)
  const sinceDay = since.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('dialer_kpis')
    .select('*')
    .eq('rep_id', repId)
    .gte('day', sinceDay)
    .order('day', { ascending: false })
  if (error) throw error
  return (data ?? []) as WavvDailyKpis[]
}

// ── Dashboard helpers ────────────────────────────────────────────────────

export type DispositionBucket = { disposition: string; count: number }

/**
 * Return the raw disposition mix from voice_calls for a rep over the last
 * `days`. We use the un-normalized disposition (from raw.disposition or
 * raw.call_status) so the rep sees "talked, no_answer, voicemail, busy,
 * left_message" — whatever WAVV actually sent — instead of our 5-bucket
 * normalization. Falls back to the normalized `outcome` column if no raw
 * field is present (e.g. older rows).
 */
export async function getDispositionMix(
  repId: string,
  days: number = 30,
): Promise<DispositionBucket[]> {
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('voice_calls')
    .select('outcome, raw')
    .eq('rep_id', repId)
    .in('provider', ['wavv', 'ghl'])
    .gte('created_at', sinceIso)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const raw = (row.raw ?? {}) as Record<string, unknown>
    const dispo =
      (typeof raw.disposition === 'string' && raw.disposition) ||
      (typeof raw.call_status === 'string' && raw.call_status) ||
      (typeof raw.callStatus === 'string' && raw.callStatus) ||
      (typeof raw.outcome === 'string' && raw.outcome) ||
      (row.outcome as string | null) ||
      'unknown'
    counts.set(dispo, (counts.get(dispo) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([disposition, count]) => ({ disposition, count }))
    .sort((a, b) => b.count - a.count)
}

export type RecentCall = {
  id: string
  created_at: string
  to_number: string | null
  from_number: string | null
  duration_sec: number | null
  outcome: string | null
  disposition_raw: string | null
  recording_url: string | null
  lead_id: string | null
  lead_name: string | null
}

// ── Enterprise / team-level helpers ─────────────────────────────────────
//
// These aggregate from voice_calls.owner_member_id, which is populated when
// calls are ingested via a per-member webhook URL or when the WAVV webhook
// payload includes a member identifier. dialer_kpis is still tenant-level
// only; per-member daily rows would require a schema extension.

export type MemberWavvSummary = {
  member_id: string
  dials: number
  connects: number
  conversations: number
  appointments_set: number
  voicemails: number
  no_answers: number
  dial_time_seconds: number
}

/**
 * Aggregate WAVV KPIs from voice_calls for a set of members.
 * Returns one row per member that has calls in the window.
 * Falls back to empty array if owner_member_id is not populated (pre-enterprise data).
 */
export async function getMemberWavvSummaries(
  repId: string,
  memberIds: string[],
  days: number = 14,
): Promise<MemberWavvSummary[]> {
  if (memberIds.length === 0) return []
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('voice_calls')
    .select('owner_member_id, outcome, duration_sec')
    .eq('rep_id', repId)
    .in('provider', ['wavv', 'ghl'])
    .in('owner_member_id', memberIds)
    .gte('created_at', sinceIso)
  if (error) throw error

  const byMember = new Map<string, MemberWavvSummary>()
  for (const row of data ?? []) {
    const mid = row.owner_member_id as string
    if (!mid) continue
    if (!byMember.has(mid)) {
      byMember.set(mid, { member_id: mid, dials: 0, connects: 0, conversations: 0, appointments_set: 0, voicemails: 0, no_answers: 0, dial_time_seconds: 0 })
    }
    const s = byMember.get(mid)!
    s.dials++
    if (row.duration_sec) s.dial_time_seconds += row.duration_sec
    const o = (row.outcome ?? '') as string
    if (o === 'voicemail') s.voicemails++
    if (o === 'no_answer') s.no_answers++
    if (o === 'connected' || o === 'confirmed' || o === 'reschedule_requested' || o === 'rescheduled') {
      s.connects++
      if ((row.duration_sec ?? 0) >= 30) s.conversations++
    }
    if (o === 'confirmed' || o === 'rescheduled') s.appointments_set++
  }
  return Array.from(byMember.values())
}

/**
 * Total WAVV KPIs for a set of member IDs over the last N days.
 * Useful for manager (team total) and owner (account total) summary strips.
 */
export async function getTeamWavvTotals(
  repId: string,
  memberIds: string[] | null, // null = all account members
  days: number = 14,
): Promise<MemberWavvSummary & { member_id: 'TEAM' }> {
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString()
  let q = supabase
    .from('voice_calls')
    .select('outcome, duration_sec')
    .eq('rep_id', repId)
    .in('provider', ['wavv', 'ghl'])
    .gte('created_at', sinceIso)
  if (memberIds !== null) {
    q = q.in('owner_member_id', memberIds)
  }
  const { data, error } = await q
  if (error) throw error

  const totals = { member_id: 'TEAM' as const, dials: 0, connects: 0, conversations: 0, appointments_set: 0, voicemails: 0, no_answers: 0, dial_time_seconds: 0 }
  for (const row of data ?? []) {
    totals.dials++
    if (row.duration_sec) totals.dial_time_seconds += row.duration_sec
    const o = (row.outcome ?? '') as string
    if (o === 'voicemail') totals.voicemails++
    if (o === 'no_answer') totals.no_answers++
    if (o === 'connected' || o === 'confirmed' || o === 'reschedule_requested' || o === 'rescheduled') {
      totals.connects++
      if ((row.duration_sec ?? 0) >= 30) totals.conversations++
    }
    if (o === 'confirmed' || o === 'rescheduled') totals.appointments_set++
  }
  return totals
}

export async function getRecentWavvCallsForMembers(
  repId: string,
  memberIds: string[] | null,
  limit: number = 25,
): Promise<(RecentCall & { owner_member_id: string | null })[]> {
  let q = supabase
    .from('voice_calls')
    .select('id, created_at, to_number, from_number, duration_sec, outcome, recording_url, lead_id, owner_member_id, raw, leads(name)')
    .eq('rep_id', repId)
    .in('provider', ['wavv', 'ghl'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (memberIds !== null) q = q.in('owner_member_id', memberIds)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const raw = (row.raw ?? {}) as Record<string, unknown>
    const dispo_raw =
      (typeof raw.disposition === 'string' && raw.disposition) ||
      (typeof raw.call_status === 'string' && raw.call_status) ||
      (typeof raw.callStatus === 'string' && raw.callStatus) ||
      null
    const lead = row.leads as { name?: string } | null
    return {
      id: row.id as string,
      created_at: row.created_at as string,
      to_number: (row.to_number as string | null) ?? null,
      from_number: (row.from_number as string | null) ?? null,
      duration_sec: (row.duration_sec as number | null) ?? null,
      outcome: (row.outcome as string | null) ?? null,
      disposition_raw: dispo_raw,
      recording_url: (row.recording_url as string | null) ?? null,
      lead_id: (row.lead_id as string | null) ?? null,
      lead_name: lead?.name ?? null,
      owner_member_id: (row.owner_member_id as string | null) ?? null,
    }
  })
}

export async function getRecentWavvCalls(
  repId: string,
  limit: number = 25,
): Promise<RecentCall[]> {
  const { data, error } = await supabase
    .from('voice_calls')
    .select('id, created_at, to_number, from_number, duration_sec, outcome, recording_url, lead_id, raw, leads(name)')
    .eq('rep_id', repId)
    .in('provider', ['wavv', 'ghl'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const raw = (row.raw ?? {}) as Record<string, unknown>
    const dispo_raw =
      (typeof raw.disposition === 'string' && raw.disposition) ||
      (typeof raw.call_status === 'string' && raw.call_status) ||
      (typeof raw.callStatus === 'string' && raw.callStatus) ||
      null
    const lead = row.leads as { name?: string } | null
    return {
      id: row.id as string,
      created_at: row.created_at as string,
      to_number: (row.to_number as string | null) ?? null,
      from_number: (row.from_number as string | null) ?? null,
      duration_sec: (row.duration_sec as number | null) ?? null,
      outcome: (row.outcome as string | null) ?? null,
      disposition_raw: dispo_raw,
      recording_url: (row.recording_url as string | null) ?? null,
      lead_id: (row.lead_id as string | null) ?? null,
      lead_name: lead?.name ?? null,
    }
  })
}
