// POST /api/onboard/[token]/sign
//
// Records signature_name + signed_at on the onboarding token.
// If build_fee_cents === 0, also provisions the owner member (or uses the
// existing one), records the signature and emails the set-password link.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { provisionOnboardingOwner } from '@/lib/onboardingOwner'
import { enforceRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // Brute-force defense: cap attempts per IP. Without this an attacker could
  // pump millions of guesses at /api/onboard/<random>/sign to harvest valid
  // tokens (tokens grant account creation). 10/min/IP is generous for a
  // legitimate signer who mis-clicks; punishing for a brute-forcer.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  const limit = await enforceRateLimit(`onboard:sign:${ip}`, 10, 60)
  if (!limit.allowed) return rateLimitResponse(limit)

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const signatureName = String(body.name ?? '').trim()
  if (signatureName.length < 2) {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('onboarding_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  if (new Date(row.expires_at as string) < new Date()) {
    return NextResponse.json({ ok: false, error: 'expired' }, { status: 410 })
  }

  // Idempotent — if already signed, return current state
  if (row.signed_at) {
    const requiresPayment = Number(row.build_fee_cents) > 0 && !row.paid_at
    return NextResponse.json({
      ok: true,
      alreadySigned: true,
      requiresPayment,
      checkoutUrl: requiresPayment ? (row.checkout_url as string | null) : null,
    })
  }

  // `ip` was already resolved above for rate-limiting. Reuse it.
  const ipForAudit = ip === 'unknown' ? null : ip
  const ua = req.headers.get('user-agent') ?? null

  // Claim the signature atomically: a double-click (two POSTs at once) must
  // not provision or email twice.
  const { data: claimed } = await supabase
    .from('onboarding_tokens')
    .update({
      signature_name: signatureName,
      signed_at: new Date().toISOString(),
      signed_ip: ipForAudit,
      signed_user_agent: ua,
    })
    .eq('token', token)
    .is('signed_at', null)
    .select('token')
  if (!claimed || claimed.length === 0) {
    const requiresPayment = Number(row.build_fee_cents) > 0 && !row.paid_at
    return NextResponse.json({
      ok: true,
      alreadySigned: true,
      requiresPayment,
      checkoutUrl: requiresPayment ? (row.checkout_url as string | null) : null,
    })
  }

  if (Number(row.build_fee_cents) === 0) {
    // No fee: the build is "paid" at signing. Then: owner member (existing or
    // new), signature recorded against them, "Your login is ready" email.
    await supabase
      .from('onboarding_tokens')
      .update({ paid_at: new Date().toISOString() })
      .eq('token', token)
    await provisionOnboardingOwner({
      token,
      repId: row.rep_id as string,
      signatureName,
      ip: ipForAudit,
      ua,
      source: 'onboarding link',
    }).catch((err) => console.error('[onboard/sign] provisioning failed', err))
    return NextResponse.json({ ok: true, requiresPayment: false })
  }

  return NextResponse.json({
    ok: true,
    requiresPayment: true,
    checkoutUrl: row.checkout_url as string | null,
  })
}
