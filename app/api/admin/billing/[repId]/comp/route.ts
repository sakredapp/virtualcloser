// POST /api/admin/billing/:repId/comp
// Body: { amountCents: number, reason: string }
//
// Adds a NEGATIVE customer balance transaction (account credit) on the
// org-level Stripe customer. Stripe applies it to the next invoice
// automatically.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  const { repId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const amountCents = Number(body.amountCents ?? 0)
  const reason = (body.reason as string | undefined) ?? 'admin comp'
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ ok: false, reason: 'bad_amount' }, { status: 400 })
  }

  const customerId = await resolveCustomerId(repId)
  if (!customerId) return NextResponse.json({ ok: false, reason: 'no_customer' }, { status: 400 })

  const stripe = getStripe()
  const txn = await stripe.customers.createBalanceTransaction(customerId, {
    amount: -amountCents,            // negative = credit toward future invoices
    currency: 'usd',
    description: `Comp: ${reason}`,
    metadata: { rep_id: repId, admin_reason: reason },
  })

  await audit({
    actorKind: 'admin',
    action: 'customer.balance.credit',
    repId,
    stripeObjectId: txn.id,
    amountCents,
    notes: reason,
  })

  return NextResponse.json({ ok: true, txnId: txn.id })
}

async function resolveCustomerId(repId: string): Promise<string | null> {
  const { data: rep } = await supabase.from('reps').select('stripe_customer_id, tier').eq('id', repId).maybeSingle()
  if (rep?.stripe_customer_id) return rep.stripe_customer_id as string
  // Fall back to first member's customer.
  const { data: ab } = await supabase
    .from('agent_billing')
    .select('stripe_customer_id')
    .eq('rep_id', repId)
    .not('stripe_customer_id', 'is', null)
    .limit(1)
    .maybeSingle()
  return (ab?.stripe_customer_id as string | undefined) ?? null
}
