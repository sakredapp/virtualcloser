// POST /api/billing/portal
//
// Returns a one-time Stripe Customer Portal URL for the current logged-in
// member or org. Lets owners self-serve update card / cancel /
// view past invoices without us having to build a UI for any of it.

import { NextRequest, NextResponse } from 'next/server'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  }
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  // Resolve the right Stripe customer. Owners on team/enterprise → org
  // customer (reps.stripe_customer_id). Otherwise → member customer.
  let customerId: string | null = null
  const { data: rep } = await supabase
    .from('reps')
    .select('id, tier, stripe_customer_id')
    .eq('id', session.member.rep_id)
    .maybeSingle()
  const role = (session.member as { role?: string }).role ?? 'rep'
  if (role === 'owner' && rep?.stripe_customer_id && rep.tier !== 'individual') {
    customerId = rep.stripe_customer_id as string
  } else {
    const { data: ab } = await supabase
      .from('agent_billing')
      .select('stripe_customer_id')
      .eq('member_id', session.member.id)
      .maybeSingle()
    customerId = (ab?.stripe_customer_id as string | undefined) ?? null
  }

  if (!customerId) {
    return NextResponse.json({ ok: false, reason: 'no_customer' }, { status: 400 })
  }

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `https://${ROOT}/dashboard/billing`,
  })

  return NextResponse.json({ ok: true, url: portal.url })
}
