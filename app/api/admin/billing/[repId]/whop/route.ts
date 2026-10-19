// POST /api/admin/billing/[repId]/whop
//
// Admin billing actions for one Suite CXO customer, on Whop (owner 2026-10-19:
// no Stripe anywhere). Body { action, ... }:
//
//   seat_checkout                         email the owner the seat checkout
//   charge_link { amount_cents, title }   one-time Whop charge link
//   comp { reason, amount_cents? }        comped, nothing charged
//   refund { payment_id, partial_cents?, reason }
//   cancel_now | cancel_at_period_end | uncancel | pause | resume | sync
//
// Logic: lib/billing/cxoBillingActions.ts (shared with Accounts' ops actions).

import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { isStoreReviewTenant } from '@/lib/storeDemo'
import {
  compClient,
  membershipAction,
  refundClientPayment,
  sendChargeLink,
  sendSeatCheckout,
  type Actor,
  type BillingResult,
  type MembershipOp,
} from '@/lib/billing/cxoBillingActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MEMBERSHIP_OPS: readonly MembershipOp[] = ['cancel_now', 'cancel_at_period_end', 'uncancel', 'pause', 'resume', 'sync']
const ACTOR: Actor = { kind: 'admin', source: 'admin billing' }

function answer(r: BillingResult) {
  return r.ok
    ? NextResponse.json({ ok: true, ...r.data }, { status: r.status })
    : NextResponse.json({ ok: false, error: r.error, message: r.message }, { status: r.status })
}

export async function POST(req: Request, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { repId } = await ctx.params
  if (isStoreReviewTenant(repId)) {
    return NextResponse.json({ ok: false, error: 'review_demo', message: 'App Store review account: nothing is done to it.' }, { status: 403 })
  }
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'seat_checkout') return answer(await sendSeatCheckout(repId, ACTOR))
  if (action === 'charge_link') return answer(await sendChargeLink(repId, body.amount_cents, body.title, ACTOR))
  if (action === 'comp') return answer(await compClient(repId, body.amount_cents, body.reason, ACTOR))
  if (action === 'refund') return answer(await refundClientPayment(repId, body.payment_id, body.partial_cents, body.reason, ACTOR))
  if ((MEMBERSHIP_OPS as readonly string[]).includes(action)) return answer(await membershipAction(repId, action as MembershipOp, ACTOR))
  return NextResponse.json({ ok: false, error: 'bad_action', message: `action must be one of seat_checkout, charge_link, comp, refund, ${MEMBERSHIP_OPS.join(', ')}.` }, { status: 400 })
}
