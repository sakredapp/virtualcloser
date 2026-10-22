// POST /api/webhooks/whop
//
// Suite CXO's Whop webhook (owner 2026-10-19: everything bills on Whop, no
// Stripe anywhere). Verifies the Standard Webhooks signature, dedupes on the
// webhook-id (cxo_whop_webhook_events), then writes billing state:
//
//   payment.succeeded   cxo_build_fee     -> provision the onboarding owner
//                       cxo_subscription  -> reps.billing_status active
//                       cxo_charge        -> audit only
//   payment.failed      cxo_subscription  -> past_due
//   membership.activated / went_valid     -> active
//   membership.deactivated / went_invalid -> canceled
//   refund.created / dispute.created      -> audit
//
// The first purchase (build fee, or the first paid seat) also sends our own
// Meta Conversions API Purchase (lib/billing/metaPurchase.ts). It is off until
// CXO_META_PIXEL_ID + CXO_META_CAPI_TOKEN are set, and never fails the webhook.
//
// The same Whop business also bills Virtual Closer, so anything that is not a
// Suite CXO payment (metadata app/kind, or the Suite CXO product) is recorded
// as ignored and left alone.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'
import { provisionFromOnboardingPayment } from '@/lib/billing/provisionOnboarding'
import { CXO_WHOP_KINDS, verifyWhopWebhook, whopMoneyToCents } from '@/lib/billing/whop'
import { cxoMetadata, isCxoObject, obj, str, type Obj } from '@/lib/billing/whopEvents'
import { sendCxoPurchase } from '@/lib/billing/metaPurchase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Outcome = { outcome: string; rep_id?: string | null; resource_id?: string | null; detail?: Record<string, unknown> }
async function repIdFor(data: Obj): Promise<string | null> {
  const md = cxoMetadata(data)
  const fromMd = str(md.rep_id)
  if (fromMd) return fromMd
  const membershipId = str(obj(data.membership).id) ?? (str(data.id)?.startsWith('mem_') ? str(data.id) : null)
  if (!membershipId) return null
  const { data: rep } = await supabase.from('reps').select('id').eq('whop_membership_id', membershipId).maybeSingle()
  return (rep as { id?: string } | null)?.id ?? null
}

async function setRep(repId: string, patch: Obj): Promise<void> {
  const { error } = await supabase.from('reps').update(patch).eq('id', repId)
  if (error) throw new Error(`reps update failed: ${error.message}`)
}

async function onPaymentSucceeded(data: Obj): Promise<Outcome> {
  const md = cxoMetadata(data)
  const kind = str(md.kind)
  const repId = await repIdFor(data)
  const paymentId = str(data.id)
  const cents = whopMoneyToCents(data.total ?? data.usd_total ?? data.subtotal)
  if (!repId) return { outcome: 'no_rep', resource_id: paymentId, detail: { kind } }
  const now = new Date().toISOString()

  if (kind === CXO_WHOP_KINDS.buildFee) {
    await provisionFromOnboardingPayment({ onboardingToken: str(md.onboarding_token), repId, paymentId: paymentId ?? '' })
    if (cents != null) await setRep(repId, { build_fee_paid_cents: cents })
    await audit({ actorKind: 'webhook', action: 'build_fee.paid', repId, whopObjectId: paymentId, amountCents: cents })
    const capi = await sendCxoPurchase(data, cents)
    return { outcome: 'build_fee_paid', rep_id: repId, resource_id: paymentId, detail: { capi } }
  }

  if (kind === CXO_WHOP_KINDS.charge) {
    await audit({ actorKind: 'webhook', action: 'charge.paid', repId, whopObjectId: paymentId, amountCents: cents, notes: str(md.title) })
    return { outcome: 'charge_paid', rep_id: repId, resource_id: paymentId }
  }

  // The seat subscription (its metadata kind, or a renewal on the CXO plan).
  const { data: rep } = await supabase
    .from('reps')
    .select('billing_status, subscription_activated_at')
    .eq('id', repId)
    .maybeSingle()
  const r = (rep ?? {}) as { billing_status?: string | null; subscription_activated_at?: string | null }
  const patch: Obj = {
    billing_status: 'active',
    is_active: true,
    whop_last_payment_id: paymentId,
  }
  const membershipId = str(obj(data.membership).id)
  if (membershipId) patch.whop_membership_id = membershipId
  if (!r.subscription_activated_at) patch.subscription_activated_at = now
  await setRep(repId, patch)
  await audit({
    actorKind: 'webhook',
    action: 'subscription.paid',
    repId,
    whopObjectId: paymentId,
    amountCents: cents,
    before: { billing_status: r.billing_status ?? null },
    after: { billing_status: 'active' },
  })
  // Our own ads' Purchase: the first paid seat only, never a renewal.
  const capi = r.subscription_activated_at ? null : await sendCxoPurchase(data, cents)
  return { outcome: 'subscription_paid', rep_id: repId, resource_id: paymentId, ...(capi ? { detail: { capi } } : {}) }
}

async function onPaymentFailed(data: Obj): Promise<Outcome> {
  const md = cxoMetadata(data)
  const repId = await repIdFor(data)
  const paymentId = str(data.id)
  if (!repId) return { outcome: 'no_rep', resource_id: paymentId }
  const isSeat = str(md.kind) === CXO_WHOP_KINDS.subscription || !!str(obj(data.membership).id)
  if (isSeat) {
    const { data: rep } = await supabase.from('reps').select('billing_status').eq('id', repId).maybeSingle()
    const status = (rep as { billing_status?: string | null } | null)?.billing_status
    // A comped or canceled client is not dunned back into past_due.
    if (status !== 'comped' && status !== 'canceled') await setRep(repId, { billing_status: 'past_due' })
  }
  await audit({ actorKind: 'webhook', action: 'payment.failed', repId, whopObjectId: paymentId })
  return { outcome: isSeat ? 'past_due' : 'charge_failed', rep_id: repId, resource_id: paymentId }
}

async function onMembership(type: string, data: Obj): Promise<Outcome> {
  const repId = await repIdFor(data)
  const membershipId = str(data.id)
  if (!repId) return { outcome: 'no_rep', resource_id: membershipId }
  const valid = type === 'membership.activated' || type === 'membership.went_valid'
  const { data: rep } = await supabase.from('reps').select('billing_status').eq('id', repId).maybeSingle()
  const before = (rep as { billing_status?: string | null } | null)?.billing_status ?? null
  // Comped is an owner decision; Whop membership churn never overrides it.
  if (before === 'comped') return { outcome: 'comped_unchanged', rep_id: repId, resource_id: membershipId }
  const patch: Obj = valid
    ? { billing_status: 'active', is_active: true, whop_membership_id: membershipId }
    : { billing_status: 'canceled' }
  await setRep(repId, patch)
  await audit({
    actorKind: 'webhook',
    action: valid ? 'membership.valid' : 'membership.invalid',
    repId,
    whopObjectId: membershipId,
    before: { billing_status: before },
    after: { billing_status: patch.billing_status },
  })
  return { outcome: valid ? 'active' : 'canceled', rep_id: repId, resource_id: membershipId }
}

async function onMoneyBack(type: string, data: Obj): Promise<Outcome> {
  const payment = obj(data.payment)
  const subject = Object.keys(payment).length ? { ...payment, metadata: payment.metadata ?? data.metadata } : data
  const repId = await repIdFor(subject)
  const cents = whopMoneyToCents(data.amount ?? data.total)
  await audit({ actorKind: 'webhook', action: type, repId, whopObjectId: str(data.id), amountCents: cents })
  return { outcome: 'recorded', rep_id: repId, resource_id: str(data.id) }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const verdict = verifyWhopWebhook(raw, (n) => req.headers.get(n), process.env.WHOP_WEBHOOK_SECRET)
  if (!verdict.ok) {
    // no_secret is a deploy gap, not a forged request: 503 keeps Whop retrying.
    console.error(`[cxo-whop-webhook] rejected: ${verdict.reason}`)
    return NextResponse.json({ error: verdict.reason }, { status: verdict.reason === 'no_secret' ? 503 : 401 })
  }

  let event: Obj
  try {
    event = obj(JSON.parse(raw))
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const type = String(event.type ?? '')
  const data = obj(event.data)

  const { data: seen } = await supabase.from('cxo_whop_webhook_events').select('id').eq('id', verdict.id).maybeSingle()
  if (seen) return NextResponse.json({ received: true, dedup: true })

  try {
    let o: Outcome
    if (type === 'refund.created' || type === 'dispute.created') {
      const subject = obj(data.payment)
      o = isCxoObject(Object.keys(subject).length ? subject : data)
        ? await onMoneyBack(type, data)
        : { outcome: 'ignored', resource_id: str(data.id), detail: { reason: 'not_suitecxo' } }
    } else if (!isCxoObject(data)) {
      o = { outcome: 'ignored', resource_id: str(data.id), detail: { reason: 'not_suitecxo' } }
    } else {
      switch (type) {
        case 'payment.succeeded':
          o = await onPaymentSucceeded(data)
          break
        case 'payment.failed':
          o = await onPaymentFailed(data)
          break
        case 'membership.activated':
        case 'membership.went_valid':
        case 'membership.deactivated':
        case 'membership.went_invalid':
          o = await onMembership(type, data)
          break
        default:
          o = { outcome: 'ignored', resource_id: str(data.id), detail: { reason: 'unhandled_type' } }
      }
    }
    await supabase.from('cxo_whop_webhook_events').insert({
      id: verdict.id,
      type,
      outcome: o.outcome,
      rep_id: o.rep_id ?? null,
      resource_id: o.resource_id ?? null,
      detail: o.detail ?? null,
    })
    return NextResponse.json({ received: true, outcome: o.outcome })
  } catch (e) {
    // Not recorded, so Whop's retry runs it again.
    console.error(`[cxo-whop-webhook] ${type} failed:`, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
