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
  pinned_to_dashboard: boolean
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
  // Money / outcomes
  revenue: { key: 'revenue', label: 'Revenue' },
  sales: { key: 'revenue', label: 'Revenue' },
  gross: { key: 'revenue', label: 'Revenue' },
  gp: { key: 'gross_profit', label: 'Gross Profit' },
  gross_profit: { key: 'gross_profit', label: 'Gross Profit' },
  commission: { key: 'commission', label: 'Commission' },
  commissions: { key: 'commission', label: 'Commission' },
  comm: { key: 'commission', label: 'Commission' },
  paychecks: { key: 'commission', label: 'Commission' },
  pay: { key: 'commission', label: 'Commission' },
  // Activity
  presentation: { key: 'presentations', label: 'Presentations' },
  presentations: { key: 'presentations', label: 'Presentations' },
  pres: { key: 'presentations', label: 'Presentations' },
  demo: { key: 'demos', label: 'Demos' },
  demos: { key: 'demos', label: 'Demos' },
  pitch: { key: 'pitches', label: 'Pitches' },
  pitches: { key: 'pitches', label: 'Pitches' },
  followup: { key: 'follow_ups', label: 'Follow-Ups' },
  follow_up: { key: 'follow_ups', label: 'Follow-Ups' },
  follow_ups: { key: 'follow_ups', label: 'Follow-Ups' },
  followups: { key: 'follow_ups', label: 'Follow-Ups' },
  referral: { key: 'referrals', label: 'Referrals' },
  referrals: { key: 'referrals', label: 'Referrals' },
  refs: { key: 'referrals', label: 'Referrals' },
  quote: { key: 'quotes_sent', label: 'Quotes Sent' },
  quotes: { key: 'quotes_sent', label: 'Quotes Sent' },
  quotes_sent: { key: 'quotes_sent', label: 'Quotes Sent' },
  proposal: { key: 'proposals_sent', label: 'Proposals Sent' },
  proposals: { key: 'proposals_sent', label: 'Proposals Sent' },
  proposals_sent: { key: 'proposals_sent', label: 'Proposals Sent' },
  contract: { key: 'contracts_sent', label: 'Contracts Sent' },
  contracts: { key: 'contracts_sent', label: 'Contracts Sent' },
  contracts_signed: { key: 'contracts_signed', label: 'Contracts Signed' },
  meeting: { key: 'meetings_held', label: 'Meetings Held' },
  meetings: { key: 'meetings_held', label: 'Meetings Held' },
  meetings_held: { key: 'meetings_held', label: 'Meetings Held' },
  shows: { key: 'shows', label: 'Shows' },
  no_shows: { key: 'no_shows', label: 'No-Shows' },
  // Recruiting
  interviews: { key: 'interviews', label: 'Interviews' },
  hires: { key: 'hires', label: 'Hires' },
  recruits: { key: 'recruits', label: 'Recruits' },
}

const CURRENCY_KEYS = new Set(['revenue', 'commission', 'gross_profit'])

export function isCurrencyMetric(key: string): boolean {
  return CURRENCY_KEYS.has(key)
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
  opts: { pinnedOnly?: boolean } = {},
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
  if (opts.pinnedOnly) {
    q = q.eq('pinned_to_dashboard', true)
  }
  const { data } = await q
  return (data ?? []) as KpiCard[]
}

/**
 * Find any non-archived card for this metric regardless of period —
 * used when the rep logs a number and we want to update whatever card
 * already exists (day OR week OR month) instead of demanding a period
 * choice they already made earlier.
 */
export async function findAnyCardForMetric(
  repId: string,
  memberId: string | null,
  metricKey: string,
): Promise<KpiCard | null> {
  let q = supabase
    .from('kpi_cards')
    .select('*')
    .eq('rep_id', repId)
    .eq('metric_key', metricKey)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
  if (memberId) {
    q = q.or(`member_id.eq.${memberId},member_id.is.null`)
  } else {
    q = q.is('member_id', null)
  }
  const { data } = await q
  return ((data ?? [])[0] as KpiCard | undefined) ?? null
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
  pinnedToDashboard?: boolean
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
      pinned_to_dashboard: input.pinnedToDashboard ?? true,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as KpiCard
}

export async function setCardPinned(
  repId: string,
  cardId: string,
  pinned: boolean,
): Promise<void> {
  await supabase
    .from('kpi_cards')
    .update({ pinned_to_dashboard: pinned, updated_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('id', cardId)
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

/**
 * Bulk-fetch entries for many cards at once (used by /dashboard +
 * /dashboard/analytics so each render is a single round-trip instead of
 * one per card). Returns a map keyed by card id, ordered oldest → newest.
 */
export async function getEntriesForCardsSince(
  cardIds: string[],
  sinceDay: string,
): Promise<Record<string, Array<{ day: string; value: number }>>> {
  if (cardIds.length === 0) return {}
  const { data } = await supabase
    .from('kpi_entries')
    .select('kpi_card_id, day, value')
    .in('kpi_card_id', cardIds)
    .gte('day', sinceDay)
    .order('day', { ascending: true })
  const map: Record<string, Array<{ day: string; value: number }>> = {}
  for (const row of data ?? []) {
    const r = row as { kpi_card_id: string; day: string; value: number | string }
    const list = map[r.kpi_card_id] ?? (map[r.kpi_card_id] = [])
    list.push({ day: r.day, value: Number(r.value) })
  }
  return map
}
