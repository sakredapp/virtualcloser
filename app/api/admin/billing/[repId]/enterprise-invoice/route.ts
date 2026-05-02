// POST /api/admin/billing/:repId/enterprise-invoice
// Body: { lineItems: [{ description, amountCents, quantity? }], dueDays?: number, daysUntilDue?: number, memo?: string }
//
// Creates a NET-30 manual invoice for an enterprise customer (collection
// method = send_invoice). No card needed — Stripe emails the invoice and
// gives them a hosted payment page.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LineItem = { description: string; amountCents: number; quantity?: number }

export async function POST(req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  const { repId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const lineItems = (body.lineItems as LineItem[] | undefined) ?? []
  const daysUntilDue = Number(body.daysUntilDue ?? body.dueDays ?? 30)
  const memo = (body.memo as string | undefined) ?? null
  if (lineItems.length === 0) return NextResponse.json({ ok: false, reason: 'no_line_items' }, { status: 400 })

  const { data: rep } = await supabase
    .from('reps')
    .select('stripe_customer_id, email, display_name, tier')
    .eq('id', repId)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false, reason: 'rep_not_found' }, { status: 404 })

  const stripe = getStripe()
  let customerId = rep.stripe_customer_id as string | null
  if (!customerId) {
    if (!rep.email) return NextResponse.json({ ok: false, reason: 'no_email' }, { status: 400 })
    const created = await stripe.customers.create({
      email: rep.email as string,
      name: (rep.display_name as string) ?? undefined,
      metadata: { rep_id: repId, tier: 'enterprise' },
    })
    customerId = created.id
    await supabase.from('reps').update({ stripe_customer_id: customerId }).eq('id', repId)
  }

  // Create invoice items first, then the invoice.
  for (const li of lineItems) {
    if (!li.description || !Number.isFinite(li.amountCents) || li.amountCents <= 0) {
      return NextResponse.json({ ok: false, reason: 'bad_line_item' }, { status: 400 })
    }
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: li.amountCents * (li.quantity ?? 1),
      currency: 'usd',
      description: li.description,
      metadata: { rep_id: repId, kind: 'enterprise_line_item' },
    })
  }
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: daysUntilDue,
    description: memo ?? undefined,
    metadata: { rep_id: repId, kind: 'enterprise_invoice' },
    auto_advance: true,
  })
  // Finalize + send.
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id)
  if (finalized.collection_method === 'send_invoice') {
    await stripe.invoices.sendInvoice(invoice.id)
  }

  await audit({
    actorKind: 'admin',
    action: 'enterprise.invoice.send',
    repId,
    stripeObjectId: invoice.id,
    amountCents: finalized.amount_due ?? null,
    notes: memo ?? `${lineItems.length} items`,
  })

  return NextResponse.json({
    ok: true,
    invoiceId: invoice.id,
    hostedUrl: finalized.hosted_invoice_url,
    amountDue: finalized.amount_due,
    dueDate: finalized.due_date,
  })
}
