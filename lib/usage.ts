// ============================================================================
// Usage tracking — append-only event log + helpers for cap math.
//
// Every cap-counted event (Vapi appt confirmed, roleplay minute, WAVV dial)
// flows through `recordUsage()`. The event lands in usage_events with a
// denormalized period_year_month so the billing dashboard can aggregate any
// month in O(rows-in-month).
//
// `usageFor()` returns the current period's used / cap / over-cap state for
// a given client+addon. Cap math factors in per-period admin overrides
// stored on billing_periods.cap_overrides.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { ADDON_CATALOG, getAddon } from '@/lib/addons'
import type { AddonKey, CapUnit } from '@/lib/addons'

export type UsageEventType =
  | 'appt_confirmed'
  | 'appt_rescheduled'
  | 'roleplay_minute'
  | 'wavv_dial'
  | 'cap_hit_email_sent'

export type RecordUsageInput = {
  repId: string
  addonKey: AddonKey
  eventType: UsageEventType
  quantity?: number
  unit?: CapUnit
  costCentsEstimate?: number
  sourceTable?: string
  sourceId?: string | null
  occurredAt?: Date
  metadata?: Record<string, unknown>
}

export function periodForDate(d: Date = new Date()): string {
  // '2026-04' format. Server-side, in UTC. Billing periods are calendar
  // months in UTC — keeps the 1st-of-month cron simple.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export async function recordUsage(input: RecordUsageInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const def = getAddon(input.addonKey)
  if (!def) return { ok: false, error: `unknown addon ${input.addonKey}` }

  const occurredAt = input.occurredAt ?? new Date()
  const period = periodForDate(occurredAt)
  const quantity = input.quantity ?? 1
  const unit = input.unit ?? def.cap_unit
  const costCents =
    input.costCentsEstimate ??
    Math.round(quantity * (def.our_cost_per_unit_cents ?? 0))

  const { data, error } = await supabase
    .from('usage_events')
    .insert({
      rep_id: input.repId,
      addon_key: input.addonKey,
      event_type: input.eventType,
      quantity,
      unit,
      cost_cents_estimate: costCents,
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
      occurred_at: occurredAt.toISOString(),
      period_year_month: period,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error) {
    // Don't bubble — usage tracking failure shouldn't block the call placement.
    console.error('[usage] recordUsage failed', error.message, input)
    return { ok: false, error: error.message }
  }
  return { ok: true, id: data?.id }
}

// ─────────────────────────────────────────────────────────────────────────
// Cap math
// ─────────────────────────────────────────────────────────────────────────

export type UsageSnapshot = {
  used: number
  cap: number | null            // null = unlimited
  effective_cap: number | null  // cap + per-period override
  remaining: number | null
  percent: number               // 0–100; 100 = at cap; >100 = over cap
  over_cap: boolean
  period: string
}

export async function usageFor(
  repId: string,
  addonKey: AddonKey,
  period: string = periodForDate(),
): Promise<UsageSnapshot> {
  // Sum cap-counted events. We exclude bookkeeping rows like
  // 'cap_hit_email_sent' from the usage total.
  const def = getAddon(addonKey)
  const baseSnapshot: UsageSnapshot = {
    used: 0,
    cap: def?.cap_value ?? null,
    effective_cap: def?.cap_value ?? null,
    remaining: def?.cap_value ?? null,
    percent: 0,
    over_cap: false,
    period,
  }

  const [{ data: events }, { data: billingRow }, { data: addonRow }] = await Promise.all([
    supabase
      .from('usage_events')
      .select('quantity,event_type')
      .eq('rep_id', repId)
      .eq('addon_key', addonKey)
      .eq('period_year_month', period),
    supabase
      .from('billing_periods')
      .select('cap_overrides')
      .eq('rep_id', repId)
      .eq('period_year_month', period)
      .maybeSingle(),
    // Per-tenant cap_value REPLACES the catalog default. Used for
    // per-minute add-ons where the customer agreed to a specific minute
    // cap on the offer/quote (admin sets it on the prospect/client page).
    supabase
      .from('client_addons')
      .select('cap_value')
      .eq('rep_id', repId)
      .eq('addon_key', addonKey)
      .maybeSingle(),
  ])

  let used = 0
  for (const e of events ?? []) {
    if (e.event_type === 'cap_hit_email_sent') continue
    used += Number(e.quantity ?? 0)
  }

  // Resolution order for the cap:
  //   1. client_addons.cap_value (if explicitly set by admin) — REPLACES default
  //   2. catalog default cap_value
  //   3. then add any per-period bump from billing_periods.cap_overrides (additive)
  const customCap =
    addonRow && Object.prototype.hasOwnProperty.call(addonRow, 'cap_value')
      ? (addonRow as { cap_value: number | null }).cap_value
      : undefined
  const baseCap =
    customCap === null
      ? null // admin explicitly set unlimited for this client
      : customCap !== undefined
        ? customCap
        : (def?.cap_value ?? null)

  let effective_cap = baseCap
  if (effective_cap !== null) {
    const overrides = (billingRow?.cap_overrides ?? {}) as Record<string, number>
    const bump = Number(overrides[addonKey] ?? 0)
    if (bump > 0) effective_cap += bump
  }

  const remaining = effective_cap === null ? null : Math.max(0, effective_cap - used)
  const percent =
    effective_cap === null || effective_cap === 0
      ? 0
      : Math.round((used / effective_cap) * 100)
  const over_cap = effective_cap !== null && used >= effective_cap

  return {
    used,
    cap: baseCap,
    effective_cap,
    remaining,
    percent,
    over_cap,
    period,
  }
}

// Convenience: roll up every active add-on for a client into one snapshot.
// Used by the dashboard usage strips and the admin billing drill-down.
export async function usageRollup(
  repId: string,
  period: string = periodForDate(),
): Promise<Record<AddonKey, UsageSnapshot>> {
  const { data: rows } = await supabase
    .from('client_addons')
    .select('addon_key')
    .eq('rep_id', repId)
    .in('status', ['active', 'over_cap'])

  const out: Partial<Record<AddonKey, UsageSnapshot>> = {}
  for (const r of rows ?? []) {
    const key = r.addon_key as AddonKey
    if (!ADDON_CATALOG[key]) continue
    out[key] = await usageFor(repId, key, period)
  }
  return out as Record<AddonKey, UsageSnapshot>
}

// Has a cap-hit notification email already been sent for this addon in the
// current period? (We only want to notify the rep once per cycle.)
export async function capHitEmailSent(
  repId: string,
  addonKey: AddonKey,
  period: string = periodForDate(),
): Promise<boolean> {
  const { data } = await supabase
    .from('usage_events')
    .select('id')
    .eq('rep_id', repId)
    .eq('addon_key', addonKey)
    .eq('period_year_month', period)
    .eq('event_type', 'cap_hit_email_sent')
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

// Resolve which sibling add-on (e.g. dialer Lite vs Pro) the client has
// active. Returns the first active key from the candidate list, or null
// if none. Used by webhook handlers that don't know upfront which tier the
// client purchased.
export async function resolveActiveAddon(
  repId: string,
  candidates: AddonKey[],
): Promise<AddonKey | null> {
  const { data } = await supabase
    .from('client_addons')
    .select('addon_key')
    .eq('rep_id', repId)
    .in('status', ['active', 'over_cap'])
    .in('addon_key', candidates)
  if (!data || data.length === 0) return null
  // Prefer Pro over Lite if both somehow exist (shouldn't, but defensive).
  const ranked = data.sort((a, b) => {
    const ra = a.addon_key.includes('pro') ? 0 : 1
    const rb = b.addon_key.includes('pro') ? 0 : 1
    return ra - rb
  })
  return ranked[0].addon_key as AddonKey
}
