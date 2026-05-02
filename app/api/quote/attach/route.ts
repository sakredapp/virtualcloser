// POST /api/quote/attach
// Body: { cartShape, email, name?, company?, phone? }
//
// Public endpoint. Called when a buyer clicks "Book a call with this quote"
// on the offer page. Creates / reuses a prospect by email, stores the
// configured cart, links it back. Returns the cal.com booking URL with
// the cart_id baked into the metadata so when Cal fires its webhook we
// already have the cart attached.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createCart, type CartInput } from '@/lib/billing/cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/team/virtual-closer/kick-off-call'

export async function POST(req: NextRequest) {
  let body: {
    cart?: Partial<CartInput>
    email?: string
    name?: string
    company?: string
    phone?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  const email = (body.email ?? '').toLowerCase().trim()
  if (!email) return NextResponse.json({ ok: false, reason: 'no_email' }, { status: 400 })

  // 1. Persist the cart server-side so we control pricing.
  const cartInput: CartInput = {
    tier: (body.cart?.tier as CartInput['tier']) ?? 'individual',
    repCount: Math.max(1, Math.round(Number(body.cart?.repCount ?? 1))),
    weeklyHours: Math.max(0, Math.round(Number(body.cart?.weeklyHours ?? 0))),
    trainerWeeklyHours: Math.max(0, Math.round(Number(body.cart?.trainerWeeklyHours ?? 0))),
    overflowEnabled: !!body.cart?.overflowEnabled,
    addons: body.cart?.addons ?? [],
    email,
    displayName: body.name ?? '',
    company: body.company ?? '',
    phone: body.phone ?? '',
    metadata: {
      ...(body.cart?.metadata ?? {}),
      source: 'book_call_with_quote',
    },
  }
  const cart = await createCart(cartInput)

  // 2. Find or create the prospect by email.
  const { data: existing } = await supabase
    .from('prospects')
    .select('id, pipeline_stage, cart_id')
    .ilike('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let prospectId: string
  if (existing?.id) {
    prospectId = existing.id as string
    // Don't downgrade stage — only push forward to quote_sent if currently
    // earlier in the funnel.
    const earlier = ['lead', 'call_booked', 'plan_generated']
    const update: Record<string, unknown> = { cart_id: cart.id, updated_at: new Date().toISOString() }
    if (earlier.includes(((existing.pipeline_stage as string) ?? 'lead'))) {
      update.pipeline_stage = 'quote_sent'
    }
    if (body.name) update.name = body.name
    if (body.company) update.company = body.company
    if (body.phone) update.phone = body.phone
    await supabase.from('prospects').update(update).eq('id', prospectId)
  } else {
    const { data: created, error } = await supabase
      .from('prospects')
      .insert({
        source: 'offer_book_call',
        name: body.name ?? null,
        email,
        company: body.company ?? null,
        phone: body.phone ?? null,
        status: 'new',
        pipeline_stage: 'quote_sent',
        cart_id: cart.id,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[quote/attach] prospect insert failed', error)
      return NextResponse.json({ ok: false, reason: 'prospect_insert_failed' }, { status: 500 })
    }
    prospectId = (created as { id: string }).id
  }

  // 3. Build the Cal.com URL with metadata so the booking webhook can
  //    backfill meeting_at + advance the stage.
  let calUrl: string
  try {
    const u = new URL(CAL_BOOKING_URL)
    u.searchParams.set('email', email)
    if (body.name) u.searchParams.set('name', body.name)
    u.searchParams.set('metadata[prospect_id]', prospectId)
    u.searchParams.set('metadata[cart_id]', cart.id)
    u.searchParams.set('metadata[tier]', cartInput.tier)
    u.searchParams.set('metadata[rep_count]', String(cartInput.repCount))
    if (cart.computedTotalCents > 0) {
      u.searchParams.set('metadata[weekly_subtotal_usd]', String(Math.round(cart.computedTotalCents / 100)))
    }
    calUrl = u.toString()
  } catch {
    calUrl = CAL_BOOKING_URL
  }

  return NextResponse.json({
    ok: true,
    prospectId,
    cartId: cart.id,
    calUrl,
  })
}
