// A public buyer of the Suite CXO seat plan: someone who paid on the checkout
// page without ever talking to us, so Whop's payment carries no rep_id and no
// reps row holds the membership. Before this file the webhook recorded
// `no_rep` and stopped: the buyer paid and got nothing, and nobody was told.
//
// Now the buyer gets an account through the same create path the Accounts
// board uses (lib/opsOnboarding/actions.ts create_client), which also sends
// the "Your login is ready" welcome email from suitecxo.com. The owner gets an
// alert at jace@virtualcloser.com for every public buyer, and for every case
// the webhook cannot finish on its own (no email on the payment, a second
// membership for an existing client, a failed create).

import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { alertOperator } from '@/lib/alerts'
import { runOpsAction } from '@/lib/opsOnboarding/actions'
import { obj, str, type Obj } from '@/lib/billing/whopEvents'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The buyer's email, wherever Whop put it on a payment or a membership. Pure. */
export function buyerEmail(data: Obj): string | null {
  const candidates = [
    obj(data.user).email,
    data.email,
    obj(obj(data.membership).user).email,
    obj(data.member).email,
    obj(obj(data.member).user).email,
  ]
  for (const c of candidates) {
    const e = typeof c === 'string' ? c.trim().toLowerCase() : ''
    if (EMAIL_RE.test(e)) return e
  }
  return null
}

/** The buyer's name for the account, falling back to the email's local part. Pure. */
export function buyerName(data: Obj, email: string): string {
  const u = obj(data.user)
  const name = str(u.name) ?? str(obj(obj(data.membership).user).name) ?? str(u.username)
  if (name && name.trim()) return name.trim().slice(0, 80)
  return email.split('@')[0].slice(0, 80)
}

/** The membership this object belongs to (a payment's membership, or the membership itself). Pure. */
export function membershipIdOf(data: Obj): string | null {
  const fromPayment = str(obj(data.membership).id)
  if (fromPayment) return fromPayment
  const own = str(data.id)
  return own && own.startsWith('mem_') ? own : null
}

/**
 * A slug that is the same on every retry for the same purchase, so two
 * webhooks racing (payment.succeeded and membership.activated) create one
 * account, not two: the second create answers 409 and links to the first.
 * Fits SLUG_RE (^[a-z0-9][a-z0-9-]*$) and 40 characters. Pure.
 */
export function publicBuyerSlug(email: string, seed: string): string {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 6)
  const base = local && /^[a-z0-9]/.test(local) ? local : 'cxo'
  return `${base}-${hash}`.replace(/-+/g, '-')
}

export type PublicBuyerResult =
  | { ok: true; repId: string; created: boolean; welcome: string | null }
  | { ok: false; reason: 'no_email' | 'other_membership'; detail?: Record<string, unknown> }

async function repBySlug(slug: string): Promise<string | null> {
  const { data } = await supabase.from('reps').select('id').eq('slug', slug).maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

/**
 * Find or create the account for a public buyer and link the Whop membership
 * to it. Throws when the create fails, so the webhook answers 500 and Whop
 * retries; returns ok:false (after alerting the owner) when only a person can
 * settle it.
 */
export async function ensurePublicBuyerRep(data: Obj, eventType: string): Promise<PublicBuyerResult> {
  const membershipId = membershipIdOf(data)
  const paymentId = str(data.id)?.startsWith('pay_') ? str(data.id) : null
  const email = buyerEmail(data)
  const ctx = { event: eventType, membership_id: membershipId, payment_id: paymentId }

  if (!email) {
    await alertOperator({
      key: `cxo-public-buyer-no-email:${membershipId ?? paymentId ?? 'unknown'}`,
      severity: 'error',
      title: 'Suite CXO buyer paid but Whop sent no email',
      body:
        'Someone bought the Suite CXO seat on Whop, but the webhook carried no buyer email, so no account was made. ' +
        'Look the membership up in Whop (Payments or Members), then create the client on the Accounts board with that email.',
      context: ctx,
    })
    return { ok: false, reason: 'no_email', detail: ctx }
  }

  // An existing Suite CXO client with this email: link the purchase to it.
  const { data: existing } = await supabase
    .from('reps')
    .select('id, whop_membership_id')
    .eq('brand', 'cxo')
    .ilike('email', email)
    .limit(1)
  const found = ((existing ?? []) as Array<{ id: string; whop_membership_id: string | null }>)[0]
  if (found) {
    if (found.whop_membership_id && membershipId && found.whop_membership_id !== membershipId) {
      await alertOperator({
        key: `cxo-public-buyer-second-membership:${membershipId}`,
        severity: 'error',
        title: 'Existing Suite CXO client bought a second seat plan',
        body:
          `${email} already has a Suite CXO account (${found.id}) on another Whop membership. ` +
          'The new purchase was not linked, so check whether they meant to buy twice and refund or merge in Whop.',
        context: { ...ctx, rep_id: found.id, existing_membership_id: found.whop_membership_id },
      })
      return { ok: false, reason: 'other_membership', detail: { ...ctx, rep_id: found.id } }
    }
    if (membershipId) await supabase.from('reps').update({ whop_membership_id: membershipId }).eq('id', found.id)
    await alertOperator({
      key: `cxo-public-buyer:${membershipId ?? paymentId ?? email}`,
      severity: 'warn',
      title: 'Suite CXO purchase linked to an existing client',
      body: `${email} paid for the Suite CXO seat on the public checkout. They already had an account (${found.id}); the purchase is now linked to it.`,
      context: { ...ctx, rep_id: found.id },
    })
    return { ok: true, repId: found.id, created: false, welcome: null }
  }

  const slug = publicBuyerSlug(email, membershipId ?? paymentId ?? email)
  const r = await runOpsAction({
    action: 'create_client',
    input: { slug, display_name: buyerName(data, email), email, tier: 'individual', send_welcome: true },
  })
  let repId: string | null = null
  let created = false
  if (r.status === 201 && typeof r.body.rep_id === 'string') {
    repId = r.body.rep_id
    created = true
  } else if (r.status === 409) {
    // The other webhook for this purchase got here first.
    repId = await repBySlug(slug)
  }
  if (!repId) {
    await alertOperator({
      key: `cxo-public-buyer-create-failed:${membershipId ?? paymentId ?? email}`,
      severity: 'fatal',
      title: 'Suite CXO buyer paid but the account could not be created',
      body: `${email} paid for the Suite CXO seat. Creating their account failed (${String(r.body.error ?? r.status)}: ${String(r.body.message ?? '')}). Whop will retry the webhook; if it keeps failing, create the client on the Accounts board.`,
      context: { ...ctx, slug, status: r.status },
    })
    throw new Error(`public buyer create failed: ${r.status} ${String(r.body.error ?? '')}`)
  }
  if (membershipId) {
    const { error } = await supabase.from('reps').update({ whop_membership_id: membershipId }).eq('id', repId)
    if (error) throw new Error(`public buyer link failed: ${error.message}`)
  }
  const welcome = created ? String(r.body.login_link ?? 'unknown') : null
  await alertOperator({
    key: `cxo-public-buyer:${membershipId ?? paymentId ?? email}`,
    severity: 'warn',
    title: 'New Suite CXO self-serve buyer',
    body:
      `${email} bought the Suite CXO seat on the public checkout. ` +
      (created
        ? `Their account was created (${repId}, ${String(r.body.host ?? slug)}) and the welcome email status is: ${welcome}.`
        : `Their account (${repId}) already existed from an earlier webhook for this purchase and is now linked.`),
    context: { ...ctx, rep_id: repId, slug },
  })
  return { ok: true, repId, created, welcome }
}

/** Something happened on a Suite CXO purchase that no account holds: tell the owner, never drop it. */
export async function alertUnmatched(eventType: string, data: Obj): Promise<void> {
  const membershipId = membershipIdOf(data)
  await alertOperator({
    key: `cxo-whop-unmatched:${eventType}:${membershipId ?? str(data.id) ?? 'unknown'}`,
    severity: 'warn',
    title: `Suite CXO Whop ${eventType} with no matching account`,
    body: `Whop sent ${eventType} for a Suite CXO purchase that no account holds. Nothing was changed. Check the membership in Whop.`,
    context: { event: eventType, id: str(data.id), membership_id: membershipId, email: buyerEmail(data) },
  })
}
