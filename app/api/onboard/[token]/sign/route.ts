// POST /api/onboard/[token]/sign
//
// Records signature_name + signed_at on the onboarding token.
// If build_fee_cents === 0, also provisions the owner member and sends welcome.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createMember } from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { generatePassword, sendEmail, welcomeEmail } from '@/lib/email'
import { recordSignature } from '@/lib/liabilityAgreement'
import { telegramBotUsername } from '@/lib/telegram'
import { TIER_INFO } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
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

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  const ua = req.headers.get('user-agent') ?? null

  await supabase
    .from('onboarding_tokens')
    .update({ signature_name: signatureName, signed_at: new Date().toISOString() })
    .eq('token', token)

  if (Number(row.build_fee_cents) === 0) {
    await provisionOwnerMember({
      repId: row.rep_id as string,
      token,
      signatureName,
      ip,
      ua,
    })
    return NextResponse.json({ ok: true, requiresPayment: false })
  }

  return NextResponse.json({
    ok: true,
    requiresPayment: true,
    checkoutUrl: row.checkout_url as string | null,
  })
}

async function provisionOwnerMember(args: {
  repId: string
  token: string
  signatureName: string
  ip: string | null
  ua: string | null
}) {
  const { repId, token, signatureName, ip, ua } = args

  const { data: rep } = await supabase
    .from('reps')
    .select('id, email, display_name, slug, tier')
    .eq('id', repId)
    .maybeSingle()

  if (!rep?.email) {
    console.error('[onboard/sign] rep has no email — cannot provision member', repId)
    return
  }

  // Idempotent: skip if owner already exists
  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', repId)
    .eq('role', 'owner')
    .maybeSingle()

  if (existing) {
    await markTokenDone(token)
    return
  }

  const password = generatePassword()
  const passwordHash = await hashPassword(password)

  const member = await createMember({
    repId,
    email: rep.email as string,
    displayName: rep.display_name as string,
    role: 'owner',
    passwordHash,
  })

  await recordSignature({
    repId,
    memberId: member.id,
    signatureName,
    signedIp: ip,
    signedUserAgent: ua,
    workspaceLabel: rep.display_name as string,
  })

  const tierLabel = (
    TIER_INFO[(rep.tier as 'individual' | 'enterprise') ?? 'individual'] ?? TIER_INFO.individual
  ).label

  const tpl = welcomeEmail({
    toEmail: rep.email as string,
    displayName: rep.display_name as string,
    slug: rep.slug as string,
    password,
    telegramLinkCode: member.telegram_link_code,
    telegramBotUsername: telegramBotUsername(),
    tierLabel,
  })

  await sendEmail({
    to: rep.email as string,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  }).catch((err) => console.error('[onboard/sign] welcome email failed', err))

  await markTokenDone(token)
}

async function markTokenDone(token: string) {
  await supabase
    .from('onboarding_tokens')
    .update({
      paid_at: new Date().toISOString(),
      welcome_sent_at: new Date().toISOString(),
    })
    .eq('token', token)
}
