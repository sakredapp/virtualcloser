// POST /api/admin/billing/:repId/uncancel

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

  const stripe = getStripe()
  const subIds: string[] = []
  const { data: rep } = await supabase.from('reps').select('stripe_subscription_id').eq('id', repId).maybeSingle()
  if (rep?.stripe_subscription_id) subIds.push(rep.stripe_subscription_id as string)
  const { data: agents } = await supabase
    .from('agent_billing')
    .select('stripe_subscription_id')
    .eq('rep_id', repId)
    .not('stripe_subscription_id', 'is', null)
  for (const a of agents ?? []) {
    const v = (a as { stripe_subscription_id?: string }).stripe_subscription_id
    if (v) subIds.push(v)
  }

  for (const id of subIds) {
    await stripe.subscriptions.update(id, { cancel_at_period_end: false })
  }
  await supabase.from('reps').update({ cancel_at_week_end: false }).eq('id', repId)
  await supabase.from('agent_billing').update({ cancel_at_week_end: false }).eq('rep_id', repId)
  await audit({ actorKind: 'admin', action: 'subscription.uncancel', repId, notes: `subs: ${subIds.join(', ')}` })

  return NextResponse.json({ ok: true, count: subIds.length })
}
