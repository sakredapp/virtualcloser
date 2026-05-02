// POST /api/checkout/cart
//
// Builds a server-side cart from the offer page. Returns { cartId } that
// the frontend then passes to /api/checkout/session.

import { NextRequest, NextResponse } from 'next/server'
import { createCart, type CartInput } from '@/lib/billing/cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: Partial<CartInput>
  try {
    body = (await req.json()) as Partial<CartInput>
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  const tier = body.tier ?? 'individual'
  if (!['individual', 'team', 'enterprise'].includes(tier)) {
    return NextResponse.json({ ok: false, reason: 'bad_tier' }, { status: 400 })
  }
  const repCount = Number(body.repCount ?? 1)
  if (!Number.isFinite(repCount) || repCount < 1 || repCount > 10000) {
    return NextResponse.json({ ok: false, reason: 'bad_rep_count' }, { status: 400 })
  }
  const weeklyHours = Math.round(Number(body.weeklyHours ?? 0))
  if (weeklyHours < 0 || weeklyHours > 168) {
    return NextResponse.json({ ok: false, reason: 'bad_hours' }, { status: 400 })
  }
  const trainerWeeklyHours = Math.round(Number(body.trainerWeeklyHours ?? 0))
  if (trainerWeeklyHours < 0 || trainerWeeklyHours > 168) {
    return NextResponse.json({ ok: false, reason: 'bad_trainer_hours' }, { status: 400 })
  }

  const cart = await createCart({
    tier: tier as CartInput['tier'],
    repCount,
    weeklyHours,
    trainerWeeklyHours,
    overflowEnabled: !!body.overflowEnabled,
    addons: body.addons ?? [],
    email: body.email,
    displayName: body.displayName,
    company: body.company,
    phone: body.phone,
    metadata: body.metadata,
  })

  return NextResponse.json({ ok: true, cartId: cart.id })
}
