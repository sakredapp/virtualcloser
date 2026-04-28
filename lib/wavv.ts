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
