// POST /api/billing/agent-payer
// Body: { memberId: string, payerModel: 'self' | 'org' }
//
// Admin-only endpoint that flips a member's payer model. Used at
// onboarding to mark "this rep's hours are paid by the org card" instead
// of "this rep pays their own card."
//
// Side effects: if switching to 'org' we cancel any existing per-agent
// Stripe subscription (the org foots the bill instead — billed via
// org-level invoicing). If switching back to 'self', the agent has to
// re-enter their card + plan via /dashboard/billing.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { supabase } from '@/lib/supabase'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { ensureAgentBilling } from '@/lib/billing/agentBilling'
import { getMemberById } from '@/lib/members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  if (!isAtLeast(session.member.role, 'admin')) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 })
  }

  let body: { memberId?: string; payerModel?: 'self' | 'org' }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }
  if (!body.memberId || (body.payerModel !== 'self' && body.payerModel !== 'org')) {
    return NextResponse.json({ ok: false, reason: 'bad_input' }, { status: 400 })
  }

  // Verify the target member belongs to this tenant.
  const target = await getMemberById(body.memberId)
  if (!target || target.rep_id !== session.tenant.id) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }

  // Make sure the agent_billing row exists.
  await ensureAgentBilling({
    memberId: target.id,
    repId: session.tenant.id,
    email: target.email ?? '',
    displayName: (target as { display_name?: string }).display_name ?? target.email ?? 'Agent',
    payerModel: body.payerModel,
  })

  // If we're switching TO 'org', cancel any active per-agent subscription
  // since the org will be footing the bill instead.
  const { data: billingRow } = await supabase
    .from('agent_billing')
    .select('stripe_subscription_id, payer_model')
    .eq('member_id', target.id)
    .maybeSingle()
  const prevModel = (billingRow as { payer_model?: 'self' | 'org' } | null)?.payer_model
  const subId = (billingRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id

  if (body.payerModel === 'org' && subId) {
    try {
      await getStripe().subscriptions.cancel(subId)
    } catch (err) {
      console.warn('[agent-payer] cancel sub failed (continuing)', err)
    }
  }

  await supabase
    .from('agent_billing')
    .update({
      payer_model: body.payerModel,
      // When org takes over, status flips to active immediately (org pays
      // out-of-band via tenant billing). When switching back to self, we
      // require the agent to re-onboard their card so status becomes
      // pending_setup until they save a card.
      status: body.payerModel === 'org' ? 'active' : 'pending_setup',
      stripe_subscription_id: body.payerModel === 'org' ? null : subId,
    })
    .eq('member_id', target.id)

  return NextResponse.json({ ok: true, payerModel: body.payerModel, prevModel })
}
