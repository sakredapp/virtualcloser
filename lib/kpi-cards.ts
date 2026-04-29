import { supabase } from './supabase'

export type KpiPeriod = 'day' | 'week' | 'month'

export type KpiCard = {
  id: string
  rep_id: string
  member_id: string | null
  metric_key: string
  label: string
  unit: string | null
  period: KpiPeriod
  goal_value: number | null
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type KpiEntry = {
  id: string
  kpi_card_id: string
  rep_id: string
  member_id: string | null
  day: string
  value: number
  note: string | null
}

/**
 * Canonical metric keys the bot recognizes. Free-form labels still work —
 * anything not in this map gets a slugified key. We just normalize the
 * common sales metrics so "calls", "dials", "outbound calls" all point at
 * the same card instead of creating three.
 */
const METRIC_ALIASES: Record<string, { key: string; label: string }> = {
  dial: { key: 'dials', label: 'Dials' },
  dials: { key: 'dials', label: 'Dials' },
  call: { key: 'dials', label: 'Dials' },
  calls: { key: 'dials', label: 'Dials' },
  outbound: { key: 'dials', label: 'Dials' },
  outbound_call: { key: 'dials', label: 'Dials' },
  outbound_calls: { key: 'dials', label: 'Dials' },
  cold_call: { key: 'dials', label: 'Dials' },
  cold_calls: { key: 'dials', label: 'Dials' },
  conversation: { key: 'conversations', label: 'Conversations' },
  conversations: { key: 'conversations', label: 'Conversations' },
  convo: { key: 'conversations', label: 'Conversations' },
  convos: { key: 'conversations', label: 'Conversations' },
  talks: { key: 'conversations', label: 'Conversations' },
  contacts: { key: 'conversations', label: 'Conversations' },
  appointment: { key: 'appointments_set', label: 'Appointments Set' },
  appointments: { key: 'appointments_set', label: 'Appointments Set' },
  appointments_set: { key: 'appointments_set', label: 'Appointments Set' },
  appts: { key: 'appointments_set', label: 'Appointments Set' },
  appt: { key: 'appointments_set', label: 'Appointments Set' },
  set: { key: 'appointments_set', label: 'Appointments Set' },
  sets: { key: 'appointments_set', label: 'Appointments Set' },
  meetings_booked: { key: 'appointments_set', label: 'Appointments Set' },
  bookings: { key: 'appointments_set', label: 'Appointments Set' },
  voicemail: { key: 'voicemails', label: 'Voicemails' },
  voicemails: { key: 'voicemails', label: 'Voicemails' },
  vm: { key: 'voicemails', label: 'Voicemails' },
  vms: { key: 'voicemails', label: 'Voicemails' },
  no_answer: { key: 'no_answers', label: 'No Answers' },
  no_answers: { key: 'no_answers', label: 'No Answers' },
  na: { key: 'no_answers', label: 'No Answers' },
  nas: { key: 'no_answers', label: 'No Answers' },
  deals_closed: { key: 'deals_closed', label: 'Deals Closed' },
  deals: { key: 'deals_closed', label: 'Deals Closed' },
  closes: { key: 'deals_closed', label: 'Deals Closed' },
  closed: { key: 'deals_closed', label: 'Deals Closed' },
  emails: { key: 'emails_sent', label: 'Emails Sent' },
  emails_sent: { key: 'emails_sent', label: 'Emails Sent' },
  texts: { key: 'texts_sent', label: 'Texts Sent' },
  texts_sent: { key: 'texts_sent', label: 'Texts Sent' },
  doors: { key: 'doors_knocked', label: 'Doors Knocked' },
  knocks: { key: 'doors_knocked', label: 'Doors Knocked' },
  doors_knocked: { key: 'doors_knocked', label: 'Doors Knocked' },
}

export function slugifyMetric(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48) || 'metric'
  )
}

/**
 * Normalize a free-form label (or NLU-supplied key) into a canonical
 * { key, label } pair. Falls back to slug + title-cased original.
 */
export function normalizeMetric(input: { key?: string | null; label: string }): {
  key: string
  label: string
} {
  const candidates = [input.key, input.label].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  )
  for (const c of candidates) {
    const slug = slugifyMetric(c)
    if (METRIC_ALIASES[slug]) return METRIC_ALIASES[slug]
  }
  const slug = slugifyMetric(input.label)
  // Title-case the rep's wording for the display label.
  const label = input.label
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase())
  return { key: slug, label: label || 'Metric' }
}

export async function listKpiCards(
  repId: string,
  memberId: string | null,
): Promise<KpiCard[]> {
  let q = supabase
    .from('kpi_cards')
    .select('*')
    .eq('rep_id', repId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (memberId) {
    q = q.or(`member_id.eq.${memberId},member_id.is.null`)
  } else {
    q = q.is('member_id', null)
  }
  const { data } = await q
  return (data ?? []) as KpiCard[]
}

export async function findCard(
  repId: string,
  memberId: string | null,
  metricKey: string,
  period: KpiPeriod = 'day',
): Promise<KpiCard | null> {
  let q = supabase
    .from('kpi_cards')
    .select('*')
    .eq('rep_id', repId)
    .eq('metric_key', metricKey)
    .eq('period', period)
    .is('archived_at', null)
    .limit(1)
  if (memberId) q = q.eq('member_id', memberId)
  else q = q.is('member_id', null)
  const { data } = await q
  return ((data ?? [])[0] as KpiCard) ?? null
}

export async function createCard(input: {
  repId: string
  memberId: string | null
  metricKey: string
  label: string
  unit?: string | null
  period?: KpiPeriod
  goalValue?: number | null
}): Promise<KpiCard> {
  const { data, error } = await supabase
    .from('kpi_cards')
    .insert({
      rep_id: input.repId,
      member_id: input.memberId,
      metric_key: input.metricKey,
      label: input.label,
      unit: input.unit ?? null,
      period: input.period ?? 'day',
      goal_value: input.goalValue ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as KpiCard
}

export async function archiveCard(repId: string, cardId: string): Promise<void> {
  await supabase
    .from('kpi_cards')
    .update({ archived_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('id', cardId)
}

/**
 * Upsert a daily entry. mode='set' replaces the day's value (so "I made 100
 * dials today" sent twice doesn't double); mode='increment' adds to it.
 */
export async function logEntry(input: {
  repId: string
  memberId: string | null
  cardId: string
  day: string
  value: number
  note?: string | null
  mode?: 'set' | 'increment'
}): Promise<KpiEntry> {
  const mode = input.mode ?? 'set'
  let nextValue = input.value
  if (mode === 'increment') {
    const { data: existing } = await supabase
      .from('kpi_entries')
      .select('value')
      .eq('kpi_card_id', input.cardId)
      .eq('day', input.day)
      .maybeSingle()
    nextValue = (existing ? Number(existing.value) : 0) + input.value
  }
  const { data, error } = await supabase
    .from('kpi_entries')
    .upsert(
      {
        kpi_card_id: input.cardId,
        rep_id: input.repId,
        member_id: input.memberId,
        day: input.day,
        value: nextValue,
        note: input.note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'kpi_card_id,day' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as KpiEntry
}

export async function getRecentEntries(
  cardId: string,
  days: number = 7,
): Promise<KpiEntry[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days + 1)
  const sinceIso = since.toISOString().slice(0, 10)
  const { data } = await supabase
    .from('kpi_entries')
    .select('*')
    .eq('kpi_card_id', cardId)
    .gte('day', sinceIso)
    .order('day', { ascending: false })
  return (data ?? []) as KpiEntry[]
}

export async function getEntryForDay(
  cardId: string,
  day: string,
): Promise<KpiEntry | null> {
  const { data } = await supabase
    .from('kpi_entries')
    .select('*')
    .eq('kpi_card_id', cardId)
    .eq('day', day)
    .maybeSingle()
  return (data as KpiEntry | null) ?? null
}
