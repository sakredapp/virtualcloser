// POST /api/admin/billing/:repId/pause
//
// Pauses every subscription on the customer (collection paused, no invoices
// generated). Resume via /resume. Doesn't cancel — just stops billing.

import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  const { repId } = await ctx.params

  const subIds = await collectSubs(repId)
  const stripe = getStripe()
  for (const id of subIds) {
    await stripe.subscriptions.update(id, { pause_collection: { behavior: 'void' } })
  }
  await supabase.from('reps').update({ billing_status: 'paused' }).eq('id', repId)
  await supabase.from('agent_billing').update({ status: 'paused' }).eq('rep_id', repId)
  await audit({ actorKind: 'admin', action: 'subscription.pause', repId, notes: `subs: ${subIds.join(', ')}` })
  return NextResponse.json({ ok: true, count: subIds.length })
}

async function collectSubs(repId: string): Promise<string[]> {
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
  return Array.from(ids)
}
