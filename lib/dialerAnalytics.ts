// Dialer analytics — aggregations off voice_calls (provider='revring',
// dialer_mode set). Role-aware: caller passes a `MemberDataScope` from
// resolveMemberDataScope; rep sees self only, manager sees team union,
// owner/admin sees the whole account.
//
// All numbers come from existing columns — no new schema. The opt-out
// signal is a regex sweep across transcripts (good-enough for a
// "tracking coming soon" annotation; real NLU lands later).

import { supabase } from './supabase'
import type { MemberDataScope } from './permissions'

export type DialerMode =
  | 'concierge'
  | 'appointment_setter'
  | 'live_transfer'
  | 'pipeline'

export const DIALER_MODES: DialerMode[] = [
  'concierge',
  'appointment_setter',
  'live_transfer',
  'pipeline',
]

export const MODE_LABELS: Record<DialerMode, string> = {
  concierge: 'Receptionist',
  appointment_setter: 'Appt Setter',
  live_transfer: 'Live Transfer',
  pipeline: 'Workflows',
}

// ── Core perf snapshot ───────────────────────────────────────────────────

export type DialerCorePerf = {
  dials: number
  connects: number
  connectRatePct: number
  talkSeconds: number
  avgDurationSec: number
  appointments: number
  conversionRatePct: number
  /** Talk time as a fraction of total dialer-active time (talk + ring). */
  talkUtilizationPct: number
  costCents: number
  costPerAppointmentCents: number | null
  optOutCount: number
  optOutRatePct: number
}

const OPT_OUT_PATTERNS = [
  /\bdo not call\b/i,
  /\bdon'?t call\b/i,
  /\btake me off\b/i,
  /\bremove me\b/i,
  /\bunsubscribe\b/i,
  /\bstop calling\b/i,
  /\bdon'?t contact\b/i,
  /\bnever call\b/i,
  /\blose my number\b/i,
  /\b(add|put) me on .{0,20}(do not call|dnc|no.?call)\b/i,
]

function detectOptOut(transcript: string | null): boolean {
  if (!transcript) return false
  return OPT_OUT_PATTERNS.some((p) => p.test(transcript))
}

const APPT_OUTCOMES = new Set(['confirmed', 'rescheduled', 'booked'])
const CONNECT_OUTCOMES = new Set([
  'confirmed',
  'rescheduled',
  'booked',
  'connected',
  'reschedule_requested',
  'no_interest',
  'opt_out',
])

type CallRow = {
  id: string
  duration_sec: number | null
  outcome: string | null
  status: string | null
  cost_cents: number | null
  dialer_mode: string | null
  owner_member_id: string | null
  transcript: string | null
  created_at: string
}

async function fetchCalls(
  repId: string,
  scope: MemberDataScope,
  fromIso: string,
  toIso: string,
  modeFilter?: DialerMode,
): Promise<CallRow[]> {
  let q = supabase
    .from('voice_calls')
    .select('id, duration_sec, outcome, status, cost_cents, dialer_mode, owner_member_id, transcript, created_at')
    .eq('rep_id', repId)
    .eq('provider', 'revring')
    .not('dialer_mode', 'is', null)
    .gte('created_at', fromIso)
    .lt('created_at', toIso)
  if (scope.memberIds) {
    q = q.in('owner_member_id', scope.memberIds)
  }
  if (modeFilter) q = q.eq('dialer_mode', modeFilter)
  const { data } = await q
  return (data ?? []) as CallRow[]
}

function summarize(rows: CallRow[]): DialerCorePerf {
  const dials = rows.length
  let connects = 0
  let talkSeconds = 0
  let appointments = 0
  let costCents = 0
  let optOutCount = 0
  let totalActiveSeconds = 0 // talk + ring estimate

  for (const r of rows) {
    const dur = r.duration_sec ?? 0
    talkSeconds += dur
    totalActiveSeconds += dur > 0 ? dur : 30 // assume 30s of ring for unconnected
    costCents += r.cost_cents ?? 0
    const outcome = (r.outcome ?? '').toLowerCase()
    if (CONNECT_OUTCOMES.has(outcome)) connects++
    if (APPT_OUTCOMES.has(outcome)) appointments++
    if (outcome === 'opt_out' || detectOptOut(r.transcript)) optOutCount++
  }

  const connectRatePct = dials > 0 ? Math.round((connects / dials) * 100) : 0
  const conversionRatePct = dials > 0 ? Math.round((appointments / dials) * 100) : 0
  const avgDurationSec = dials > 0 ? Math.round(talkSeconds / dials) : 0
  const talkUtilizationPct =
    totalActiveSeconds > 0 ? Math.round((talkSeconds / totalActiveSeconds) * 100) : 0
  const optOutRatePct = dials > 0 ? Math.round((optOutCount / dials) * 100) : 0
  const costPerAppointmentCents = appointments > 0 ? Math.round(costCents / appointments) : null

  return {
    dials,
    connects,
    connectRatePct,
    talkSeconds,
    avgDurationSec,
    appointments,
    conversionRatePct,
    talkUtilizationPct,
    costCents,
    costPerAppointmentCents,
    optOutCount,
    optOutRatePct,
  }
}

// ── Public helpers ───────────────────────────────────────────────────────

export type WindowOpts = {
  /** Days to look back from now. Defaults to 30. */
  days?: number
  /** Optional dialer mode filter. */
  mode?: DialerMode
}

export async function getDialerCorePerf(
  repId: string,
  scope: MemberDataScope,
  opts: WindowOpts = {},
): Promise<DialerCorePerf> {
  const days = opts.days ?? 30
  const toIso = new Date().toISOString()
  const fromIso = new Date(Date.now() - days * 86400_000).toISOString()
  const rows = await fetchCalls(repId, scope, fromIso, toIso, opts.mode)
  return summarize(rows)
}

export type DailyTrendPoint = {
  day: string // YYYY-MM-DD
  dials: number
  connects: number
  appointments: number
  costCents: number
}

export async function getDialerDailyTrend(
  repId: string,
  scope: MemberDataScope,
  opts: WindowOpts = {},
): Promise<DailyTrendPoint[]> {
  const days = opts.days ?? 30
  const toIso = new Date().toISOString()
  const fromIso = new Date(Date.now() - days * 86400_000).toISOString()
  const rows = await fetchCalls(repId, scope, fromIso, toIso, opts.mode)

  // Bucket by day (UTC).
  const byDay = new Map<string, DailyTrendPoint>()
  // Pre-fill window so empty days show as zero (cleaner chart).
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400_000)
    const key = d.toISOString().slice(0, 10)
    byDay.set(key, { day: key, dials: 0, connects: 0, appointments: 0, costCents: 0 })
  }
  for (const r of rows) {
    const key = r.created_at.slice(0, 10)
    const point = byDay.get(key) ?? { day: key, dials: 0, connects: 0, appointments: 0, costCents: 0 }
    point.dials++
    const outcome = (r.outcome ?? '').toLowerCase()
    if (CONNECT_OUTCOMES.has(outcome)) point.connects++
    if (APPT_OUTCOMES.has(outcome)) point.appointments++
    point.costCents += r.cost_cents ?? 0
    byDay.set(key, point)
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
}

export type PerModeRow = DialerCorePerf & { mode: DialerMode; label: string }

export async function getDialerPerMode(
  repId: string,
  scope: MemberDataScope,
  opts: { days?: number } = {},
): Promise<PerModeRow[]> {
  const days = opts.days ?? 30
  const toIso = new Date().toISOString()
  const fromIso = new Date(Date.now() - days * 86400_000).toISOString()
  const allRows = await fetchCalls(repId, scope, fromIso, toIso)
  const byMode = new Map<DialerMode, CallRow[]>()
  for (const m of DIALER_MODES) byMode.set(m, [])
  for (const r of allRows) {
    if (r.dialer_mode && DIALER_MODES.includes(r.dialer_mode as DialerMode)) {
      byMode.get(r.dialer_mode as DialerMode)!.push(r)
    }
  }
  return DIALER_MODES.map((mode) => ({
    mode,
    label: MODE_LABELS[mode],
    ...summarize(byMode.get(mode) ?? []),
  }))
}

export type PerMemberRow = DialerCorePerf & {
  memberId: string
  displayName: string
}

/**
 * Per-rep breakdown. Useful for managers (their team) and owners (the
 * whole org). The displayName comes from the members table.
 */
export async function getDialerPerMember(
  repId: string,
  scope: MemberDataScope,
  opts: { days?: number } = {},
): Promise<PerMemberRow[]> {
  if (scope.scope === 'self') return [] // self-view doesn't get a per-member breakdown

  const days = opts.days ?? 30
  const toIso = new Date().toISOString()
  const fromIso = new Date(Date.now() - days * 86400_000).toISOString()
  const allRows = await fetchCalls(repId, scope, fromIso, toIso)

  const byMember = new Map<string, CallRow[]>()
  for (const r of allRows) {
    if (!r.owner_member_id) continue
    const arr = byMember.get(r.owner_member_id) ?? []
    arr.push(r)
    byMember.set(r.owner_member_id, arr)
  }

  // Resolve display names in one round trip.
  const memberIds = Array.from(byMember.keys())
  if (memberIds.length === 0) return []
  const { data: members } = await supabase
    .from('members')
    .select('id, display_name')
    .in('id', memberIds)
  const nameById = new Map<string, string>()
  for (const m of (members ?? []) as Array<{ id: string; display_name: string | null }>) {
    nameById.set(m.id, m.display_name ?? 'unknown')
  }

  const rows: PerMemberRow[] = []
  for (const [memberId, calls] of byMember.entries()) {
    rows.push({
      memberId,
      displayName: nameById.get(memberId) ?? 'unknown',
      ...summarize(calls),
    })
  }
  // Default sort: most appointments first, then connects.
  rows.sort((a, b) => {
    if (b.appointments !== a.appointments) return b.appointments - a.appointments
    return b.connects - a.connects
  })
  return rows
}

// ── Helpers for display ──────────────────────────────────────────────────

export function fmtSeconds(s: number): string {
  if (s <= 0) return '0s'
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return r === 0 ? `${m}m` : `${m}m ${r}s`
}

export function fmtHours(s: number): string {
  if (s <= 0) return '0h'
  const h = s / 3600
  return h >= 10 ? `${h.toFixed(0)}h` : `${h.toFixed(1)}h`
}

export function fmtCents(c: number | null | undefined): string {
  if (c === null || c === undefined) return '—'
  if (Math.abs(c) >= 100_00) return `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return `$${(c / 100).toFixed(2)}`
}
