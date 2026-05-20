// POST /api/me/liability/sign
// Body: { signature_name: string }
// Auth: requireMember()
//
// Records the member's signature against the current agreement version (for
// the tenant's brand), generates + stores the signed PDF, and emails branded
// copies to the signer and the admin team. All of that lives in
// recordSignature() so the onboarding sign path and this path stay in sync.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { recordSignature } from '@/lib/liabilityAgreement'

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
    brand: ctx.tenant.brand,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    agreement_version: result.row.agreement_version,
    signed_at: result.row.signed_at,
  })
}
