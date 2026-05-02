// POST /api/admin/billing/:repId/setup-fee
// Body: { amountCents: number, description: string }
//
// Creates a one-off invoice item on the org customer. Stripe rolls it onto
// the next invoice automatically. Use this for the custom setup fees that
// vary per customer.

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
  const description = (body.description as string | undefined) ?? 'Custom setup fee'
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ ok: false, reason: 'bad_amount' }, { status: 400 })
  }

  const customerId = await resolveCustomerId(repId)
  if (!customerId) return NextResponse.json({ ok: false, reason: 'no_customer' }, { status: 400 })

  const stripe = getStripe()
  const item = await stripe.invoiceItems.create({
    customer: customerId,
    amount: amountCents,
    currency: 'usd',
    description,
    metadata: { rep_id: repId, kind: 'setup_fee' },
  })

  await audit({
    actorKind: 'admin',
    action: 'invoice_item.setup_fee',
    repId,
    stripeObjectId: item.id,
    amountCents,
    notes: description,
  })

  return NextResponse.json({ ok: true, itemId: item.id })
}

async function resolveCustomerId(repId: string): Promise<string | null> {
  const { data: rep } = await supabase.from('reps').select('stripe_customer_id').eq('id', repId).maybeSingle()
  if (rep?.stripe_customer_id) return rep.stripe_customer_id as string
  const { data: ab } = await supabase
    .from('agent_billing')
    .select('stripe_customer_id')
    .eq('rep_id', repId)
    .not('stripe_customer_id', 'is', null)
    .limit(1)
    .maybeSingle()
  return (ab?.stripe_customer_id as string | undefined) ?? null
}
