// POST /api/admin/billing/:repId/convert-to-enterprise
//
// Flips a customer to enterprise tier and switches their subscription's
// collection method to send_invoice (NET-30 emailed invoices, no card
// charge). Use when a customer signs an annual contract.

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
  const daysUntilDue = Number(body.daysUntilDue ?? 30)

  const stripe = getStripe()

  // Update tier locally.
  await supabase.from('reps').update({ tier: 'enterprise' }).eq('id', repId)

  // Switch every subscription on this rep to send_invoice.
  const ids = new Set<string>()
  const { data: rep } = await supabase.from('reps').select('stripe_subscription_id').eq('id', repId).maybeSingle()
  if (rep?.stripe_subscription_id) ids.add(rep.stripe_subscription_id as string)
  const { data: agents } = await supabase
    .from('agent_billing')
    .select('stripe_subscription_id')
    .eq('rep_id', repId)
    .not('stripe_subscription_id', 'is', null)
  for (const a of agents ?? []) {
    const v = (a as { stripe_subscription_id?: string }).stripe_subscription_id
    if (v) ids.add(v)
  }
  for (const id of ids) {
    await stripe.subscriptions.update(id, {
      collection_method: 'send_invoice',
      days_until_due: daysUntilDue,
    })
  }

  await audit({
    actorKind: 'admin',
    action: 'tier.convert.enterprise',
    repId,
    notes: `subs: ${Array.from(ids).join(', ')} · days_until_due=${daysUntilDue}`,
  })

  return NextResponse.json({ ok: true, switched: ids.size })
}
