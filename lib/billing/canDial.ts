// can-dial gate: should the dialer place a NEW outbound call right now
// for this member?
//
// Rules (any failure = block):
//   1. agent_billing.status must be 'active'
//   2. There must be an open period and consumed_seconds < planned_seconds
//      (the user explicitly chose "no rollover, monthly reset" — once the
//      monthly bucket is gone, the dialer pauses until next month or until
//      the rep upgrades their plan)
//   3. now() (in the member's timezone) must fall inside an active row of
//      dialer_shifts for this member — see lib/dialerHours.isInActiveShift
//
// Mid-call shift-end is allowed: this gate only runs at NEW-CALL time.
// Once a call is in progress, the SDK lets it finish; the duration just
// pushes consumed_seconds higher (and counts as overage if it crosses the
// planned line).

import { getAgentBilling, getOpenPeriod } from './agentBilling'
import { isInActiveShift } from '@/lib/dialerHours'
import { getMemberById } from '@/lib/members'
import type { DialerMode } from '@/lib/voice/dialerSettings'

export type CanDialResult =
  | { ok: true }
  | { ok: false; reason: 'no_billing' | 'pending_setup' | 'past_due' | 'cancelled' | 'no_period' | 'out_of_minutes' | 'outside_shift'; message: string }

export async function canDial(args: {
  memberId: string
  mode: DialerMode
  now?: Date
}): Promise<CanDialResult> {
  const billing = await getAgentBilling(args.memberId)
  if (!billing) {
    return { ok: false, reason: 'no_billing', message: 'No billing setup for this agent.' }
  }
  if (billing.status === 'pending_setup') {
    return { ok: false, reason: 'pending_setup', message: 'Agent billing is pending setup (no card on file or no plan selected).' }
  }
  if (billing.status === 'past_due') {
    return { ok: false, reason: 'past_due', message: 'Last invoice failed. Dialer paused until payment is updated.' }
  }
  if (billing.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', message: 'Subscription cancelled.' }
  }

  const period = await getOpenPeriod(args.memberId)
  if (!period) {
    return { ok: false, reason: 'no_period', message: 'No open billing period (monthly reset cron may not have run yet).' }
  }
  if (period.planned_seconds > 0 && period.consumed_seconds >= period.planned_seconds) {
    return { ok: false, reason: 'out_of_minutes', message: 'Monthly hour budget exhausted. No rollover — resets next month, or upgrade plan to dial more this month.' }
  }

  const member = await getMemberById(args.memberId)
  const tz = (member as { timezone?: string | null } | null)?.timezone ?? 'UTC'
  const inShift = await isInActiveShift({
    repId: billing.rep_id,
    memberId: args.memberId,
    mode: args.mode,
    now: args.now,
    timezone: tz,
  })
  if (!inShift) {
    return { ok: false, reason: 'outside_shift', message: 'Outside the agent’s scheduled dialing hours.' }
  }

  return { ok: true }
}
