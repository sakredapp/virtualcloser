// POST /api/billing/setup-intent
//
// Returns a Stripe SetupIntent client_secret so the dashboard's <CardForm/>
// can collect a card via @stripe/react-stripe-js without the card details
// ever touching our servers. Idempotent — calling twice for the same
// member just returns a fresh intent.

import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { ensureAgentBilling, createSetupIntent } from '@/lib/billing/agentBilling'
import { isStripeConfigured } from '@/lib/billing/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'stripe_not_configured', message: 'Set STRIPE_SECRET_KEY in env.' },
      { status: 501 },
    )
  }
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const { member, tenant } = session

  await ensureAgentBilling({
    memberId: member.id,
    repId: tenant.id,
    email: member.email ?? '',
    displayName: member.display_name ?? member.email ?? 'Agent',
  })
  const { clientSecret } = await createSetupIntent(member.id)
  return NextResponse.json({ ok: true, clientSecret })
}
