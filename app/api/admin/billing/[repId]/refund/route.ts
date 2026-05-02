// POST /api/admin/billing/:repId/refund
// Body: { invoiceId: string, amountCents?: number | null, reason?: string }

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  const { repId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const invoiceId = body.invoiceId as string | undefined
  const amountCents = body.amountCents as number | null | undefined
  const reason = (body.reason as string | undefined) ?? null
  if (!invoiceId) return NextResponse.json({ ok: false, reason: 'no_invoice_id' }, { status: 400 })

  const stripe = getStripe()
  const inv = (await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent', 'charge'] })) as Stripe.Invoice & {
    payment_intent?: string | Stripe.PaymentIntent | null
    charge?: string | Stripe.Charge | null
  }
  const pi = inv.payment_intent
  const piId = typeof pi === 'string' ? pi : pi?.id ?? null
  const ch = inv.charge
  const chId = typeof ch === 'string' ? ch : ch?.id ?? null
  if (!piId && !chId) return NextResponse.json({ ok: false, reason: 'no_payment_intent' }, { status: 400 })

  const refund = await stripe.refunds.create({
    ...(piId ? { payment_intent: piId } : { charge: chId! }),
    amount: amountCents ?? undefined,
    reason: 'requested_by_customer',
    metadata: { rep_id: repId, admin_reason: reason ?? '' },
  })

  await audit({
    actorKind: 'admin',
    action: 'invoice.refund',
    repId,
    stripeObjectId: refund.id,
    amountCents: amountCents ?? (inv.amount_paid ?? null),
    notes: reason,
    after: { refundId: refund.id, status: refund.status },
  })

  return NextResponse.json({ ok: true, refundId: refund.id, status: refund.status })
}
