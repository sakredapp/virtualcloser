// POST /api/me/liability/sign
// Body: { signature_name: string }
// Auth: requireMember()
//
// Records the member's signature against the current agreement version,
// uploads the rendered HTML snapshot to the liability-agreements bucket,
// and emails a copy to both the signer and the admin team.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import {
  recordSignature,
  renderAgreementHtml,
  CURRENT_VERSION,
} from '@/lib/liabilityAgreement'
import { sendLiabilityAgreementEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { signature_name?: string }
  try {
    body = (await req.json()) as { signature_name?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const signatureName = (body.signature_name ?? '').trim()
  if (signatureName.length < 3 || signatureName.length > 200) {
    return NextResponse.json(
      { ok: false, error: 'signature_name must be 3-200 characters' },
      { status: 400 },
    )
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  const userAgent = req.headers.get('user-agent')

  const result = await recordSignature({
    repId: ctx.tenant.id,
    memberId: ctx.member.id,
    signatureName,
    signedIp: ip,
    signedUserAgent: userAgent,
    workspaceLabel: ctx.tenant.display_name || ctx.tenant.slug,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  // Best-effort email — failure here does not invalidate the signature.
  if (ctx.member.email) {
    try {
      const html = renderAgreementHtml({
        signatureName,
        signedAt: result.row.signed_at,
        workspaceLabel: ctx.tenant.display_name || ctx.tenant.slug,
      })
      await sendLiabilityAgreementEmail({
        toEmail: ctx.member.email,
        signerName: signatureName,
        signedAtIso: result.row.signed_at,
        workspaceLabel: ctx.tenant.display_name || ctx.tenant.slug,
        agreementVersion: CURRENT_VERSION,
        agreementHtml: html,
        copyToAdmin: true,
      })
    } catch (err) {
      console.error('[liability] email failed', err)
    }
  }

  return NextResponse.json({
    ok: true,
    agreement_version: result.row.agreement_version,
    signed_at: result.row.signed_at,
  })
}
