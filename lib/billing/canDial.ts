// can-dial gate: should the dialer place a NEW outbound call right now
// for this member?
//
// Two concerns, composed:
//   1. Billing + weekly budget — delegated to canDialerStart() (the weekly
//      model: active subscription + this-week hours under quota, with
//      overflow handling). This replaced the old monthly-period budget check.
//   2. Schedule — now() (in the member's timezone) must fall inside an active
//      dialer_shifts row for this member (lib/dialerHours.isInActiveShift).
//
// Mid-call shift-end is allowed: this gate only runs at NEW-CALL time. Once a
// call is in progress the SDK lets it finish; the duration just pushes the
// week's consumed hours higher (overage if it crosses quota).

import { canDialerStart } from './dialerGate'
import { getAgentBilling } from './agentBilling'
import { isInActiveShift } from '@/lib/dialerHours'
import { getMemberById } from '@/lib/members'
import type { DialerMode } from '@/lib/voice/dialerSettings'

export type CanDialResult =
  | { ok: true }
  | { ok: false; reason: string; message: string }

const GATE_MESSAGE: Record<string, string> = {
  no_billing: 'No active billing for this agent.',
  past_due: 'Last invoice failed. Dialer paused until payment is updated.',
  paused: 'Subscription paused.',
  canceled: 'Subscription cancelled.',
  no_quota: 'No weekly hours on the plan.',
  quota_exhausted: "This week's hour budget is used up — resets Monday, or enable overflow to keep dialing.",
}

export async function canDial(args: {
  memberId: string
  mode: DialerMode
  now?: Date
}): Promise<CanDialResult> {
  // 1. Billing + weekly budget (canDialerStart owns the active-subscription
  //    and consumed-vs-quota logic).
  const gate = await canDialerStart(args.memberId)
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, message: GATE_MESSAGE[gate.reason] ?? 'Dialer unavailable.' }
  }

  // 2. Schedule window. Need rep_id + timezone to evaluate the member's shift.
  const billing = await getAgentBilling(args.memberId)
  if (!billing) {
    return { ok: false, reason: 'no_billing', message: GATE_MESSAGE.no_billing }
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
