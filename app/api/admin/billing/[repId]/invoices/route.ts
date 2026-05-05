// GET /api/admin/billing/:repId/invoices
// Lists the last 12 Stripe invoices for this client so the admin UI
// can display them and offer a resend button on each.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, invoices: [] })

  const { repId } = await ctx.params

  const { data: rep } = await supabase
    .from('reps')
    .select('stripe_customer_id')
    .eq('id', repId)
    .maybeSingle()

  if (!rep?.stripe_customer_id) {
    return NextResponse.json({ ok: true, invoices: [] })
  }

  const stripe = getStripe()
  let list: Awaited<ReturnType<typeof stripe.invoices.list>>
  try {
    list = await stripe.invoices.list({
      customer: rep.stripe_customer_id as string,
      limit: 12,
      expand: ['data.lines'],
    })
  } catch (err) {
    console.error('[admin/invoices] Stripe list failed', { repId, err })
    return NextResponse.json({ ok: false, reason: 'stripe_error' }, { status: 502 })
  }

  const invoices = list.data.map((inv) => ({
    id: inv.id,
    stripeNumber: inv.number ?? null,
    amountCents: inv.amount_paid ?? inv.amount_due ?? 0,
    status: inv.status ?? 'unknown',
    billingReason: (inv as { billing_reason?: string }).billing_reason ?? null,
    description: inv.lines?.data?.[0]?.description ?? null,
    createdAt: inv.created * 1000,
    hostedUrl: (inv as { hosted_invoice_url?: string }).hosted_invoice_url ?? null,
  }))

  return NextResponse.json({ ok: true, invoices })
}
