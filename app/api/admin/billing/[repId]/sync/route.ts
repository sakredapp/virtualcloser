// POST /api/admin/billing/:repId/sync
//
// Force-reload a customer's subscriptions + recent invoices from Stripe and
// upsert into local cache. Use when webhook drift is suspected.

import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { upsertInvoiceFromStripe } from '@/lib/billing/invoiceCache'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  const { repId } = await ctx.params

  const customers = new Set<string>()
  const { data: rep } = await supabase.from('reps').select('stripe_customer_id').eq('id', repId).maybeSingle()
  if (rep?.stripe_customer_id) customers.add(rep.stripe_customer_id as string)
  const { data: agents } = await supabase
    .from('agent_billing')
    .select('stripe_customer_id')
    .eq('rep_id', repId)
    .not('stripe_customer_id', 'is', null)
  for (const a of agents ?? []) {
    const v = (a as { stripe_customer_id?: string }).stripe_customer_id
    if (v) customers.add(v)
  }

  if (customers.size === 0) {
    return NextResponse.json({ ok: false, reason: 'no_customers' }, { status: 400 })
  }

  const stripe = getStripe()
  let invoicesPulled = 0
  let subsPulled = 0
  for (const cid of customers) {
    const invs = await stripe.invoices.list({ customer: cid, limit: 50 })
    for (const inv of invs.data) {
      await upsertInvoiceFromStripe(inv)
      invoicesPulled++
    }
    const subs = await stripe.subscriptions.list({ customer: cid, status: 'all', limit: 10 })
    subsPulled += subs.data.length
  }

  await audit({ actorKind: 'admin', action: 'sync.from_stripe', repId, notes: `${invoicesPulled} invoices, ${subsPulled} subs` })
  return NextResponse.json({ ok: true, invoicesPulled, subsPulled })
}
