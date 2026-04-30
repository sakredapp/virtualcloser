// ============================================================================
// Entitlements — runtime gate for cap-counted features.
//
// Every code path that costs us money calls `assertCanUse(repId, addonKey)`
// before doing the work:
//   - Vapi dialer dispatch
//   - Roleplay session creation
//   - (future) heavy CRM sync jobs
//
// Returns { ok, reason } so the caller can short-circuit cleanly. On the
// FIRST denial of a billing cycle we trigger a cap-hit email + flip
// client_addons.status='over_cap' (so the dashboard shows the upgrade CTA
// instead of a normal action button).
//
// Auto-reset on cycle close is handled by the close-billing-period cron.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { getAddon, HOUR_PACKAGE_KEYS, isHourPackage } from '@/lib/addons'
import type { AddonKey } from '@/lib/addons'
import {
  recordUsage,
  usageFor,
  capHitEmailSent,
  periodForDate,
  weekPeriodForDate,
} from '@/lib/usage'

export type EntitlementResult =
  | { ok: true; addon: AddonKey; used: number; cap: number | null; remaining: number | null }
  | { ok: false; reason: 'addon_not_active' | 'over_cap' | 'unknown_addon'; used?: number; cap?: number | null; addon: AddonKey }

/**
 * Set of addon keys that are currently active|over_cap for this tenant.
 * Used by the dashboard nav to decide which feature tabs are unlocked vs.
 * shown in the locked state. Cheap (single round-trip).
 */
export async function getActiveAddonKeys(repId: string): Promise<Set<AddonKey>> {
  const { data } = await supabase
    .from('client_addons')
    .select('addon_key, status')
    .eq('rep_id', repId)
    .in('status', ['active', 'over_cap'])
  const out = new Set<AddonKey>()
  for (const row of (data ?? []) as Array<{ addon_key: string }>) {
    out.add(row.addon_key as AddonKey)
  }
  return out
}

export async function isAddonActive(repId: string, addonKey: AddonKey): Promise<boolean> {
  const { data } = await supabase
    .from('client_addons')
    .select('status')
    .eq('rep_id', repId)
    .eq('addon_key', addonKey)
    .maybeSingle()
  return data?.status === 'active'
}

export async function assertCanUse(
  repId: string,
  addonKey: AddonKey,
): Promise<EntitlementResult> {
  const def = getAddon(addonKey)
  if (!def) return { ok: false, reason: 'unknown_addon', addon: addonKey }

  // Check active status first — caller might not have purchased the add-on at all.
  const { data: addonRow } = await supabase
    .from('client_addons')
    .select('status')
    .eq('rep_id', repId)
    .eq('addon_key', addonKey)
    .maybeSingle()

  if (!addonRow || addonRow.status === 'cancelled' || addonRow.status === 'paused') {
    return { ok: false, reason: 'addon_not_active', addon: addonKey, cap: def.cap_value }
  }

  // Already over cap from a prior call this cycle — short-circuit.
  if (addonRow.status === 'over_cap') {
    const snap = await usageFor(repId, addonKey)
    return { ok: false, reason: 'over_cap', addon: addonKey, used: snap.used, cap: snap.effective_cap }
  }

  // Cap math. usageFor() resolves the cap from client_addons.cap_value
  // (per-tenant override) → catalog default → +period overrides. Null
  // effective_cap means unlimited and `over_cap` will always be false.
  const snap = await usageFor(repId, addonKey)
  if (snap.over_cap) {
    // Trip the cap: flip status + fire email (idempotent — checked inside)
    await tripCap(repId, addonKey)
    return { ok: false, reason: 'over_cap', addon: addonKey, used: snap.used, cap: snap.effective_cap }
  }

  return {
    ok: true,
    addon: addonKey,
    used: snap.used,
    cap: snap.effective_cap,
    remaining: snap.remaining,
  }
}

/**
 * Resolve which hour-package addon (if any) the tenant has active. Used by
 * the dialer cap gate, the dashboard hour-pool widget, and the demo
 * paywall — they all need "is the SDR hire on for this tenant, and how
 * many hours/week did they buy?" without hardcoding the SKU list.
 *
 * Hour packages are mutually exclusive (each excludes the others), so we
 * return the first active one. Returns null if no hour package is on.
 */
export async function resolveActiveHourPackage(repId: string): Promise<AddonKey | null> {
  const { data } = await supabase
    .from('client_addons')
    .select('addon_key')
    .eq('rep_id', repId)
    .in('status', ['active', 'over_cap'])
    .in('addon_key', HOUR_PACKAGE_KEYS as unknown as string[])
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return (data as { addon_key: AddonKey }).addon_key
}

// Flip the client_addons row to over_cap and fire one email. Idempotent —
// repeat calls within the same period are silent no-ops.
async function tripCap(repId: string, addonKey: AddonKey): Promise<void> {
  // Flip status (idempotent — only updates if currently active)
  await supabase
    .from('client_addons')
    .update({ status: 'over_cap', updated_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('addon_key', addonKey)
    .eq('status', 'active')

  // Already emailed this cycle? Don't spam. Hour-package addons key on the
  // ISO week so we can re-arm the email when the week rolls over.
  const period = isHourPackage(addonKey) ? weekPeriodForDate() : periodForDate()
  const sent = await capHitEmailSent(repId, addonKey, period)
  if (sent) return

  // Stamp the bookkeeping event FIRST so concurrent callers don't double-fire.
  await recordUsage({
    repId,
    addonKey,
    eventType: 'cap_hit_email_sent',
    quantity: 0,
    costCentsEstimate: 0,
    metadata: { triggered_at: new Date().toISOString() },
  })

  // Best-effort email — failure shouldn't crash the request that tripped it.
  try {
    const { sendCapHitEmail } = await import('@/lib/email')
    await sendCapHitEmail({ repId, addonKey })
  } catch (err) {
    console.error('[entitlements] sendCapHitEmail failed', err)
  }
}
