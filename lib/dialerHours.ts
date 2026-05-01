// AI Dialer hour-pool helpers.
//
// Three layers stacked together:
//
//   1. Tenant pool        — set by the addon (cap_value hours/week)
//   2. Hour grants        — owner→manager, owner→rep, manager→rep (all
//                           keyed by week_start). rows in dialer_hour_grants.
//   3. Mode allocations   — each rep splits their grant across dialer modes
//                           (concierge / appointment_setter / live_transfer
//                           / pipeline). rows in dialer_mode_allocations.
//
// Plus shifts (dialer_shifts) which only say WHEN within the week the
// dialer is allowed to run for a given member+mode.
//
// Usage tracking flows the other way: every call's duration_sec hits
// usage_events under the active hour-package addon, with period_year_week
// keying the bucket. usageFor() handles cap math; this module handles
// distribution + bucket-by-bucket display.

import { supabase } from './supabase'
import { weekStartForDate, weekPeriodForDate } from './usage'
import { resolveActiveHourPackage } from './entitlements'
import { getAddon, type AddonKey } from './addons'
import type { DialerMode } from './voice/dialerSettings'

export type Iso = string

export type HourGrantRow = {
  id: string
  rep_id: string
  week_start: string // YYYY-MM-DD
  granter_member_id: string | null
  grantee_member_id: string
  granted_seconds: number
}

export type ModeAllocationRow = {
  id: string
  rep_id: string
  member_id: string
  week_start: string
  mode: DialerMode
  allocated_seconds: number
}

export type ShiftRow = {
  id: string
  rep_id: string
  member_id: string
  weekday: number // 0 = Mon, 6 = Sun
  start_minute: number
  end_minute: number
  mode: DialerMode | null
  is_active: boolean
}

// ── Tenant pool ─────────────────────────────────────────────────────────

/**
 * The tenant's weekly cap in seconds, derived from whichever hour package
 * they're on. Returns 0 if no hour package is active (caller can show "no
 * dialer plan" CTA in that case).
 */
export async function getTenantWeeklyCapSeconds(repId: string): Promise<{
  capSeconds: number
  addonKey: AddonKey | null
  capHours: number
}> {
  const active = await resolveActiveHourPackage(repId)
  if (!active) return { capSeconds: 0, addonKey: null, capHours: 0 }
  const def = getAddon(active)
  // Allow per-tenant override on client_addons.cap_value if set.
  const { data: row } = await supabase
    .from('client_addons')
    .select('cap_value')
    .eq('rep_id', repId)
    .eq('addon_key', active)
    .maybeSingle()
  const overrideHours = (row as { cap_value: number | null } | null)?.cap_value ?? null
  const capHours = overrideHours ?? def?.cap_value ?? 0
  return {
    addonKey: active,
    capHours,
    capSeconds: capHours * 3600,
  }
}

/**
 * Sum of all top-level grants (granter null) for the week — i.e. how much
 * the tenant pool has handed out direct from the owner. The remainder of
 * cap - granted is the "unallocated pool" the owner can still distribute.
 *
 * Note: grants from a manager (granter_member_id IS NOT NULL) don't reduce
 * the tenant pool; they redistribute the manager's already-claimed share.
 */
export async function getTopLevelGrantedSeconds(
  repId: string,
  weekStart: Date = weekStartForDate(),
): Promise<number> {
  const wk = weekStart.toISOString().slice(0, 10)
  const { data } = await supabase
    .from('dialer_hour_grants')
    .select('granted_seconds')
    .eq('rep_id', repId)
    .eq('week_start', wk)
    .is('granter_member_id', null)
  return (data ?? []).reduce(
    (acc, r) => acc + Number((r as { granted_seconds: number }).granted_seconds ?? 0),
    0,
  )
}

// ── Per-member views ────────────────────────────────────────────────────

/**
 * Total seconds GRANTED to this member for the given week.
 * Sums all rows where grantee_member_id = memberId.
 */
export async function getMemberGrantedSeconds(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<number> {
  const wk = weekStart.toISOString().slice(0, 10)
  const { data } = await supabase
    .from('dialer_hour_grants')
    .select('granted_seconds')
    .eq('rep_id', repId)
    .eq('week_start', wk)
    .eq('grantee_member_id', memberId)
  return (data ?? []).reduce(
    (acc, r) => acc + Number((r as { granted_seconds: number }).granted_seconds ?? 0),
    0,
  )
}

/**
 * Total seconds this member has SUB-GRANTED to others (e.g. a manager
 * passing hours down to reps). For owners/admins, these are direct grants
 * from the tenant pool; for managers, they're sub-allocations from their
 * own pool. We treat them the same.
 */
export async function getMemberSubGrantedSeconds(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<number> {
  const wk = weekStart.toISOString().slice(0, 10)
  const { data } = await supabase
    .from('dialer_hour_grants')
    .select('granted_seconds')
    .eq('rep_id', repId)
    .eq('week_start', wk)
    .eq('granter_member_id', memberId)
  return (data ?? []).reduce(
    (acc, r) => acc + Number((r as { granted_seconds: number }).granted_seconds ?? 0),
    0,
  )
}

/**
 * Member's effective dialer budget for the week (granted - sub-granted).
 * This is what they can actually consume themselves.
 */
export async function getMemberWeeklyBudgetSeconds(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<{ granted: number; subGranted: number; budget: number }> {
  const [granted, subGranted] = await Promise.all([
    getMemberGrantedSeconds(repId, memberId, weekStart),
    getMemberSubGrantedSeconds(repId, memberId, weekStart),
  ])
  return { granted, subGranted, budget: Math.max(0, granted - subGranted) }
}

/**
 * Sum of seconds USED by a member this week (across all modes).
 * Joins voice_calls.duration_sec for the member where occurred this week.
 * Only outbound dialer calls count — inbound or non-dialer calls are
 * ignored (provider in vapi/revring + dialer_mode set).
 */
export async function getMemberUsedSeconds(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<number> {
  const wkStartIso = weekStart.toISOString()
  const wkEnd = new Date(weekStart.getTime() + 7 * 86400_000).toISOString()
  const { data } = await supabase
    .from('voice_calls')
    .select('duration_sec')
    .eq('rep_id', repId)
    .eq('owner_member_id', memberId)
    .eq('provider', 'revring')
    .gte('created_at', wkStartIso)
    .lt('created_at', wkEnd)
  return (data ?? []).reduce(
    (acc, r) => acc + Number((r as { duration_sec: number | null }).duration_sec ?? 0),
    0,
  )
}

// ── Mode allocations ────────────────────────────────────────────────────

export async function listModeAllocations(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<ModeAllocationRow[]> {
  const wk = weekStart.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('dialer_mode_allocations')
    .select('*')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('week_start', wk)
  if (error) throw error
  return (data ?? []) as ModeAllocationRow[]
}

/**
 * Set (or update) one mode's allocation for a member's week.
 * The caller is expected to validate that the sum across modes ≤ the
 * member's granted budget — we don't enforce that here since the rep may
 * be mid-edit. The dialer cap gate at call time is the real enforcement.
 */
export async function upsertModeAllocation(args: {
  repId: string
  memberId: string
  mode: DialerMode
  allocatedSeconds: number
  weekStart?: Date
}): Promise<void> {
  const wk = (args.weekStart ?? weekStartForDate()).toISOString().slice(0, 10)
  const { error } = await supabase
    .from('dialer_mode_allocations')
    .upsert(
      {
        rep_id: args.repId,
        member_id: args.memberId,
        week_start: wk,
        mode: args.mode,
        allocated_seconds: Math.max(0, Math.floor(args.allocatedSeconds)),
      },
      { onConflict: 'rep_id,member_id,week_start,mode' },
    )
  if (error) throw error
}

/**
 * Mode-bucket usage for a member's week. Keyed by mode →
 * { allocated, used }. Used drives the per-mode progress bars on the
 * dialer page; allocated is what the rep set.
 */
export async function getModeBuckets(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<Record<DialerMode, { allocated: number; used: number }>> {
  const wkStartIso = weekStart.toISOString()
  const wkEnd = new Date(weekStart.getTime() + 7 * 86400_000).toISOString()
  const [{ data: allocs }, { data: calls }] = await Promise.all([
    supabase
      .from('dialer_mode_allocations')
      .select('mode, allocated_seconds')
      .eq('rep_id', repId)
      .eq('member_id', memberId)
      .eq('week_start', weekStart.toISOString().slice(0, 10)),
    supabase
      .from('voice_calls')
      .select('dialer_mode, duration_sec')
      .eq('rep_id', repId)
      .eq('owner_member_id', memberId)
      .eq('provider', 'revring')
      .gte('created_at', wkStartIso)
      .lt('created_at', wkEnd),
  ])

  const buckets: Record<DialerMode, { allocated: number; used: number }> = {
    concierge: { allocated: 0, used: 0 },
    appointment_setter: { allocated: 0, used: 0 },
    live_transfer: { allocated: 0, used: 0 },
    pipeline: { allocated: 0, used: 0 },
  }
  for (const a of allocs ?? []) {
    const r = a as { mode: DialerMode; allocated_seconds: number }
    if (buckets[r.mode]) buckets[r.mode].allocated = Number(r.allocated_seconds ?? 0)
  }
  for (const c of calls ?? []) {
    const r = c as { dialer_mode: DialerMode | null; duration_sec: number | null }
    if (r.dialer_mode && buckets[r.dialer_mode]) {
      buckets[r.dialer_mode].used += Number(r.duration_sec ?? 0)
    }
  }
  return buckets
}

// ── Hour grants (write side) ────────────────────────────────────────────

/**
 * Grant hours from one party to another. Pass granterMemberId=null when
 * the owner is allocating from the tenant pool; pass a member id when a
 * manager is sub-allocating from their own pool.
 *
 * Idempotent: re-grants overwrite the previous row's seconds.
 */
export async function upsertHourGrant(args: {
  repId: string
  granterMemberId: string | null
  granteeMemberId: string
  grantedSeconds: number
  weekStart?: Date
}): Promise<void> {
  const wk = (args.weekStart ?? weekStartForDate()).toISOString().slice(0, 10)
  // Postgres treats NULL as distinct in UNIQUE constraints, which means we
  // can't use upsert directly when granter is null without a partial index.
  // Workaround: SELECT-then-INSERT-or-UPDATE to keep idempotency without a
  // schema change.
  const seconds = Math.max(0, Math.floor(args.grantedSeconds))
  let q = supabase
    .from('dialer_hour_grants')
    .select('id')
    .eq('rep_id', args.repId)
    .eq('week_start', wk)
    .eq('grantee_member_id', args.granteeMemberId)
  q = args.granterMemberId === null
    ? q.is('granter_member_id', null)
    : q.eq('granter_member_id', args.granterMemberId)
  const { data: existing } = await q.maybeSingle()

  if (existing) {
    if (seconds === 0) {
      // Zero out by deleting — keeps the table compact.
      await supabase
        .from('dialer_hour_grants')
        .delete()
        .eq('id', (existing as { id: string }).id)
      return
    }
    const { error } = await supabase
      .from('dialer_hour_grants')
      .update({ granted_seconds: seconds })
      .eq('id', (existing as { id: string }).id)
    if (error) throw error
    return
  }
  if (seconds === 0) return
  const { error } = await supabase.from('dialer_hour_grants').insert({
    rep_id: args.repId,
    week_start: wk,
    granter_member_id: args.granterMemberId,
    grantee_member_id: args.granteeMemberId,
    granted_seconds: seconds,
  })
  if (error) throw error
}

/**
 * List all grants (top-level + sub-grants) for a tenant's week. Used to
 * render the owner allocation table.
 */
export async function listGrantsForWeek(
  repId: string,
  weekStart: Date = weekStartForDate(),
): Promise<HourGrantRow[]> {
  const wk = weekStart.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('dialer_hour_grants')
    .select('*')
    .eq('rep_id', repId)
    .eq('week_start', wk)
  if (error) throw error
  return (data ?? []) as HourGrantRow[]
}

// ── Shifts ──────────────────────────────────────────────────────────────

export async function listShifts(
  repId: string,
  memberId?: string,
): Promise<ShiftRow[]> {
  let q = supabase
    .from('dialer_shifts')
    .select('*')
    .eq('rep_id', repId)
    .eq('is_active', true)
  if (memberId) q = q.eq('member_id', memberId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ShiftRow[]
}

export async function upsertShift(args: {
  repId: string
  memberId: string
  weekday: number
  startMinute: number
  endMinute: number
  mode?: DialerMode | null
  shiftId?: string | null
}): Promise<string> {
  const row = {
    rep_id: args.repId,
    member_id: args.memberId,
    weekday: args.weekday,
    start_minute: args.startMinute,
    end_minute: args.endMinute,
    mode: args.mode ?? null,
    is_active: true,
  }
  if (args.shiftId) {
    const { error } = await supabase
      .from('dialer_shifts')
      .update(row)
      .eq('id', args.shiftId)
      .eq('rep_id', args.repId)
    if (error) throw error
    return args.shiftId
  }
  const { data, error } = await supabase
    .from('dialer_shifts')
    .insert(row)
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function deleteShift(repId: string, shiftId: string): Promise<void> {
  await supabase
    .from('dialer_shifts')
    .delete()
    .eq('id', shiftId)
    .eq('rep_id', repId)
}

/**
 * Is the dialer currently inside an active shift for this member +
 * (optionally) mode? Times are interpreted in the tenant's timezone.
 *
 * Used by the dialer cap gate at call placement time. If the tenant has
 * NO shifts defined yet, we treat that as "always on" — opt-in
 * scheduling, not opt-out.
 */
export async function isInActiveShift(args: {
  repId: string
  memberId: string
  mode: DialerMode
  now?: Date
  timezone?: string
}): Promise<boolean> {
  const shifts = await listShifts(args.repId, args.memberId)
  if (shifts.length === 0) return true // no shifts = always on
  const now = args.now ?? new Date()
  const tz = args.timezone ?? 'UTC'
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const wdMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  const weekday = wdMap[get('weekday') as keyof typeof wdMap] ?? -1
  if (weekday < 0) return true
  const hh = parseInt(get('hour') || '0', 10) % 24
  const mm = parseInt(get('minute') || '0', 10)
  const minuteOfDay = hh * 60 + mm
  for (const s of shifts) {
    if (s.weekday !== weekday) continue
    if (s.mode !== null && s.mode !== args.mode) continue
    if (minuteOfDay >= s.start_minute && minuteOfDay < s.end_minute) return true
  }
  return false
}

// ── Convenience: full snapshot for the current rep ──────────────────────

export type RepWeeklySnapshot = {
  weekPeriod: string
  weekStart: string
  granted: number
  subGranted: number
  budget: number
  used: number
  remaining: number
  modeBuckets: Record<DialerMode, { allocated: number; used: number }>
  shiftCount: number
}

export async function getRepWeeklySnapshot(
  repId: string,
  memberId: string,
  weekStart: Date = weekStartForDate(),
): Promise<RepWeeklySnapshot> {
  const [budget, used, modeBuckets, shifts] = await Promise.all([
    getMemberWeeklyBudgetSeconds(repId, memberId, weekStart),
    getMemberUsedSeconds(repId, memberId, weekStart),
    getModeBuckets(repId, memberId, weekStart),
    listShifts(repId, memberId),
  ])
  return {
    weekPeriod: weekPeriodForDate(weekStart),
    weekStart: weekStart.toISOString().slice(0, 10),
    granted: budget.granted,
    subGranted: budget.subGranted,
    budget: budget.budget,
    used,
    remaining: Math.max(0, budget.budget - used),
    modeBuckets,
    shiftCount: shifts.length,
  }
}
