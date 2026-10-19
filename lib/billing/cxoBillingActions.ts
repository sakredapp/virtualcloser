/**
 * Suite CXO billing actions on Whop (owner 2026-10-19: everything bills on
 * Whop; no Stripe anywhere). Shared by Accounts' ops actions
 * (lib/opsOnboarding/actions.ts) and the admin billing page
 * (POST /api/admin/billing/[repId]/whop).
 *
 * Nothing here marks a client paid. A checkout link is only a link; the
 * webhook (app/api/webhooks/whop/route.ts) writes billing_status when Whop
 * says the money moved. The one exception is comp, which is a decision, not a
 * payment: billing_status 'comped', nothing charged.
 */
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'
import { sendEmail } from '@/lib/email'
import { getBrand } from '@/lib/brand'
import { tenantDomain } from '@/lib/newClientBrand'
import {
  cancelMembership,
  createOneTimeCheckout,
  createSeatCheckout,
  CXO_WHOP_KINDS,
  getMembership,
  getPayment,
  isWhopConfigured,
  listMembershipPayments,
  pauseMembership,
  refundPayment,
  resumeMembership,
  seatCount,
  seatMonthlyCents,
  uncancelMembership,
  WhopApiError,
} from '@/lib/billing/whop'

export type BillingResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; message: string }

export type Actor = { kind: 'admin' | 'system'; source: string }

/** The most one comp may cover, in cents ($10,000). */
export const MAX_COMP_CENTS = 1_000_000
/** The most one admin charge link may ask for, in cents ($100,000). */
export const MAX_CHARGE_CENTS = 10_000_000

const bad = (status: number, error: string, message: string): BillingResult => ({ ok: false, status, error, message })

type BillingRep = {
  id: string
  slug: string
  display_name: string
  email: string | null
  brand: string | null
  max_seats: number | null
  billing_status: string | null
  whop_membership_id: string | null
}

async function loadRep(repId: string): Promise<BillingRep | null> {
  const { data } = await supabase
    .from('reps')
    .select('id, slug, display_name, email, brand, max_seats, billing_status, whop_membership_id')
    .eq('id', repId)
    .maybeSingle()
  return (data as BillingRep | null) ?? null
}

function whopFailure(e: unknown, what: string): BillingResult {
  const msg = e instanceof Error ? e.message : String(e)
  const status = e instanceof WhopApiError && e.status >= 400 && e.status < 500 ? 400 : 502
  return bad(status, 'whop_failed', `${what} failed on Whop: ${msg}`)
}

function notConfigured(): BillingResult | null {
  return isWhopConfigured() ? null : bad(501, 'whop_not_configured', 'WHOP_API_KEY is not set on this deploy.')
}

function dashboardUrl(rep: BillingRep): string {
  return `https://${tenantDomain(rep.slug, 'cxo')}/dashboard?billing=1`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/** Cents from a body field: a whole number of cents, or null. */
export function parseCents(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

/**
 * Start billing: a Whop seat checkout for max(1, max_seats) seats at $60
 * each per month, saved on the rep and emailed to the owner. Already active
 * or comped answers ok with nothing sent.
 */
export async function sendSeatCheckout(repId: string, actor: Actor, opts: { email?: boolean } = {}): Promise<BillingResult> {
  const nc = notConfigured()
  if (nc) return nc
  const rep = await loadRep(repId)
  if (!rep) return bad(404, 'not_found', 'No client with that id.')
  if (rep.billing_status === 'active' || rep.billing_status === 'comped') {
    return { ok: true, status: 200, data: { already: rep.billing_status, membership_id: rep.whop_membership_id } }
  }
  const seats = seatCount(Math.max(1, Number(rep.max_seats) || 1))
  let checkout
  try {
    checkout = await createSeatCheckout({ repId: rep.id, seats, companyName: rep.display_name, redirectUrl: dashboardUrl(rep) })
  } catch (e) {
    return whopFailure(e, 'Seat checkout')
  }
  const monthlyCents = seatMonthlyCents(seats)
  await supabase.from('reps').update({ whop_checkout_url: checkout.purchase_url }).eq('id', rep.id)
  await audit({
    actorKind: actor.kind,
    actorId: actor.source,
    action: 'subscription.checkout_sent',
    repId: rep.id,
    whopObjectId: checkout.id,
    amountCents: monthlyCents,
    notes: `${seats} seat${seats === 1 ? '' : 's'}`,
  })

  let emailed = false
  if (opts.email !== false && rep.email) {
    const brand = getBrand('cxo')
    const monthly = (monthlyCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const seatWords = `${seats} seat${seats === 1 ? '' : 's'}`
    const r = await sendEmail({
      brand: 'cxo',
      to: rep.email,
      subject: `Start your ${brand.name} subscription`,
      html: `<p>Hi ${escapeHtml(rep.display_name)},</p>
<p>Your ${escapeHtml(brand.name)} workspace is ready to switch on: ${seatWords}, ${monthly} a month.</p>
<p><a href="${escapeHtml(checkout.purchase_url)}">Start the subscription</a></p>
<p>Checkout is on Whop. You can cancel any time.</p>`,
      text: `Hi ${rep.display_name},\n\nYour ${brand.name} workspace is ready to switch on: ${seatWords}, ${monthly} a month.\n\nStart the subscription: ${checkout.purchase_url}\n\nCheckout is on Whop. You can cancel any time.`,
    })
    emailed = r.ok
  }
  return {
    ok: true,
    status: 200,
    data: { checkout_url: checkout.purchase_url, checkout_id: checkout.id, seats, monthly_cents: monthlyCents, emailed },
  }
}

/**
 * Comp: the client uses Suite CXO without paying, on purpose. Nothing is
 * charged and nothing on Whop changes; billing_status becomes 'comped' and
 * the amount waived is recorded with the reason.
 */
export async function compClient(repId: string, amountCentsRaw: unknown, reasonRaw: unknown, actor: Actor): Promise<BillingResult> {
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 200) : ''
  if (!reason) return bad(400, 'reason_required', 'reason is required: it goes on the audit log.')
  const amountCents = amountCentsRaw === undefined || amountCentsRaw === null || amountCentsRaw === '' ? 0 : parseCents(amountCentsRaw)
  if (amountCents === null || amountCents < 0 || amountCents > MAX_COMP_CENTS) {
    return bad(400, 'bad_amount', 'amount_cents must be whole cents from 0 to 1,000,000 ($10,000).')
  }
  const rep = await loadRep(repId)
  if (!rep) return bad(404, 'not_found', 'No client with that id.')
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('reps')
    .update({ billing_status: 'comped', is_active: true, comped_at: now, comped_reason: reason, comped_cents: amountCents })
    .eq('id', rep.id)
  if (error) return bad(500, 'db_failed', error.message)
  await audit({
    actorKind: actor.kind,
    actorId: actor.source,
    action: 'billing.comped',
    repId: rep.id,
    amountCents,
    notes: reason,
    before: { billing_status: rep.billing_status },
    after: { billing_status: 'comped' },
  })
  return { ok: true, status: 200, data: { billing_status: 'comped', amount_cents: amountCents, reason } }
}

/** A one-time Whop charge link (setup fee, custom invoice). Paid = webhook audit. */
export async function sendChargeLink(repId: string, amountCentsRaw: unknown, titleRaw: unknown, actor: Actor): Promise<BillingResult> {
  const nc = notConfigured()
  if (nc) return nc
  const amountCents = parseCents(amountCentsRaw)
  if (amountCents === null || amountCents < 100 || amountCents > MAX_CHARGE_CENTS) {
    return bad(400, 'bad_amount', 'amount_cents must be whole cents from 100 ($1) to 10,000,000 ($100,000).')
  }
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim().slice(0, 80) : 'Suite CXO charge'
  const rep = await loadRep(repId)
  if (!rep) return bad(404, 'not_found', 'No client with that id.')
  let checkout
  try {
    checkout = await createOneTimeCheckout({
      repId: rep.id,
      kind: CXO_WHOP_KINDS.charge,
      amountCents,
      title,
      redirectUrl: dashboardUrl(rep),
      metadata: { title },
    })
  } catch (e) {
    return whopFailure(e, 'Charge link')
  }
  await audit({ actorKind: actor.kind, actorId: actor.source, action: 'charge.link_created', repId: rep.id, whopObjectId: checkout.id, amountCents, notes: title })
  return { ok: true, status: 200, data: { checkout_url: checkout.purchase_url, checkout_id: checkout.id, amount_cents: amountCents } }
}

export type MembershipOp = 'cancel_now' | 'cancel_at_period_end' | 'uncancel' | 'pause' | 'resume' | 'sync'

/** Cancel / uncancel / pause / resume / read the client's Whop membership. */
export async function membershipAction(repId: string, op: MembershipOp, actor: Actor): Promise<BillingResult> {
  const nc = notConfigured()
  if (nc) return nc
  const rep = await loadRep(repId)
  if (!rep) return bad(404, 'not_found', 'No client with that id.')
  if (!rep.whop_membership_id) return bad(400, 'no_membership', 'This client has no Whop membership yet (no seat payment has landed).')
  const id = rep.whop_membership_id
  let m
  try {
    if (op === 'cancel_now') m = await cancelMembership(id, false)
    else if (op === 'cancel_at_period_end') m = await cancelMembership(id, true)
    else if (op === 'uncancel') m = await uncancelMembership(id)
    else if (op === 'pause') m = await pauseMembership(id)
    else if (op === 'resume') m = await resumeMembership(id)
    else m = await getMembership(id)
  } catch (e) {
    return whopFailure(e, `Membership ${op}`)
  }
  const patch: Record<string, unknown> = {}
  if (op === 'cancel_now') patch.billing_status = 'canceled'
  if (op === 'pause') patch.billing_status = 'paused'
  if (op === 'resume' && rep.billing_status === 'paused') patch.billing_status = 'active'
  if (Object.keys(patch).length) await supabase.from('reps').update(patch).eq('id', rep.id)
  if (op !== 'sync') {
    await audit({ actorKind: actor.kind, actorId: actor.source, action: `membership.${op}`, repId: rep.id, whopObjectId: id, before: { billing_status: rep.billing_status }, after: patch })
  }
  return {
    ok: true,
    status: 200,
    data: { membership_id: id, membership_status: m?.status ?? null, cancel_at_period_end: m?.cancel_at_period_end ?? null, renewal_period_end: m?.renewal_period_end ?? null },
  }
}

/** Refund a Whop payment in full or in part. The payment must be this client's. */
export async function refundClientPayment(repId: string, paymentIdRaw: unknown, partialCentsRaw: unknown, reasonRaw: unknown, actor: Actor): Promise<BillingResult> {
  const nc = notConfigured()
  if (nc) return nc
  const paymentId = typeof paymentIdRaw === 'string' ? paymentIdRaw.trim() : ''
  if (!/^pay_[A-Za-z0-9]{4,64}$/.test(paymentId)) return bad(400, 'bad_payment_id', 'payment_id must be a Whop payment id (pay_...).')
  const partial = partialCentsRaw === undefined || partialCentsRaw === null || partialCentsRaw === '' ? null : parseCents(partialCentsRaw)
  if (partial !== null && partial < 1) return bad(400, 'bad_amount', 'partial_cents must be whole cents above 0, or left out for a full refund.')
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 200) : ''
  if (!reason) return bad(400, 'reason_required', 'reason is required: it goes on the audit log.')
  const rep = await loadRep(repId)
  if (!rep) return bad(404, 'not_found', 'No client with that id.')
  try {
    const p = await getPayment(paymentId)
    const owner = (p.metadata as Record<string, unknown> | null | undefined)?.rep_id
    const sameMembership = !!rep.whop_membership_id && p.membership?.id === rep.whop_membership_id
    if (owner !== rep.id && !sameMembership) return bad(403, 'not_this_client', 'That payment does not belong to this client.')
    const r = await refundPayment(paymentId, partial)
    await audit({ actorKind: actor.kind, actorId: actor.source, action: 'payment.refund', repId: rep.id, whopObjectId: paymentId, amountCents: partial, notes: reason })
    return { ok: true, status: 200, data: { payment_id: paymentId, status: r.status ?? null, partial_cents: partial } }
  } catch (e) {
    return whopFailure(e, 'Refund')
  }
}

/** The client's Whop payments (newest first), for the admin page. */
export async function clientPayments(membershipId: string | null): Promise<{ rows: Awaited<ReturnType<typeof listMembershipPayments>>; error: string | null }> {
  if (!membershipId || !isWhopConfigured()) return { rows: [], error: membershipId ? 'WHOP_API_KEY is not set.' : null }
  try {
    return { rows: await listMembershipPayments(membershipId), error: null }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) }
  }
}
