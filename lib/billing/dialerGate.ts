// Dialer access gate.
//
// One function: canDialerStart(memberId). Used by the dialer queue cron and
// by the live transfer entry-point. Returns true only when ALL of the
// following are true:
//
//   - The member or their org has an active subscription (status='active').
//   - This week's hours-consumed is below quota (with the 1-hour safety
//     buffer reserved for in-progress shifts).
//   - If the customer hard-cap is enforced (overflow_enabled = false) and
//     consumed >= quota, dialer hard-stops.
//
// If overflow_enabled = true, the dialer keeps going past quota. Overage is
// billed at end of week via the metered Stripe Price.
//
// NEVER blocks a call mid-stream. The "can_finish" semantic is a separate
// concern at the voice runtime; this gate only answers can_start.

import { supabase } from '@/lib/supabase'
import { weekBoundsForDate, HOUR_BUFFER, SECONDS_PER_HOUR } from './weekly'

export type DialerGateResult =
  | { allowed: true; reason: 'within_quota' | 'overflow_enabled'; remainingSeconds: number }
  | { allowed: false; reason: 'no_billing' | 'past_due' | 'paused' | 'canceled' | 'quota_exhausted' | 'no_quota' }

export async function canDialerStart(memberId: string): Promise<DialerGateResult> {
  const { data: ab } = await supabase
    .from('agent_billing')
    .select('rep_id, status, weekly_hours_quota, overflow_enabled, payer_model')
    .eq('member_id', memberId)
    .maybeSingle()
  if (!ab) return { allowed: false, reason: 'no_billing' }

  // If org pays, look at the rep row's billing_status instead.
  let status = ab.status as string
  let quota = Number(ab.weekly_hours_quota ?? 0)
  let overflow = Boolean(ab.overflow_enabled)
  if (ab.payer_model === 'org') {
    const { data: rep } = await supabase
      .from('reps')
      .select('billing_status, weekly_hours_quota, overflow_enabled')
      .eq('id', ab.rep_id)
      .maybeSingle()
    if (!rep) return { allowed: false, reason: 'no_billing' }
    status = mapOrgStatus(rep.billing_status as string)
    // Org-level quota covers the whole team — but each member still needs a
    // per-member entitlement. We use agent_billing.weekly_hours_quota for
    // that, falling back to org quota if member is unset.
    quota = Number(ab.weekly_hours_quota ?? rep.weekly_hours_quota ?? 0)
    overflow = Boolean(ab.overflow_enabled || rep.overflow_enabled)
  }

  if (status === 'past_due') return { allowed: false, reason: 'past_due' }
  if (status === 'paused')   return { allowed: false, reason: 'paused' }
  if (status === 'cancelled' || status === 'canceled') return { allowed: false, reason: 'canceled' }
  if (status !== 'active')   return { allowed: false, reason: 'no_billing' }
  if (quota <= 0)            return { allowed: false, reason: 'no_quota' }

  // Hours consumed this week from voice_calls.
  const { weekStart, weekEnd } = weekBoundsForDate()
  const { data: calls } = await supabase
    .from('voice_calls')
    .select('duration_sec')
    .eq('owner_member_id', memberId)
    .eq('provider', 'revring')
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())

  const consumed = (calls ?? []).reduce(
    (acc, r) => acc + Math.max(0, Number((r as { duration_sec?: number | null }).duration_sec ?? 0)),
    0,
  )
  const quotaSec = quota * SECONDS_PER_HOUR
  const bufferSec = HOUR_BUFFER * SECONDS_PER_HOUR
  // Hard cap: assignable seconds = quotaSec - bufferSec. The buffer is for
  // finishing in-progress calls only; UI should never let you assign past it.
  const assignableSec = Math.max(0, quotaSec - bufferSec)

  if (consumed >= quotaSec) {
    if (overflow) return { allowed: true, reason: 'overflow_enabled', remainingSeconds: Number.POSITIVE_INFINITY }
    return { allowed: false, reason: 'quota_exhausted' }
  }
  if (consumed >= assignableSec && !overflow) {
    // In the buffer hour — only existing calls allowed to finish, no new ones.
    return { allowed: false, reason: 'quota_exhausted' }
  }

  return { allowed: true, reason: 'within_quota', remainingSeconds: quotaSec - consumed }
}

function mapOrgStatus(s: string): string {
  switch (s) {
    case 'active': case 'trialing': return 'active'
    case 'past_due': case 'unpaid': return 'past_due'
    case 'canceled': return 'canceled'
    case 'paused': return 'paused'
    default: return 'no_billing'
  }
}
