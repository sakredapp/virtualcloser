/**
 * POST /api/ops/onboarding/actions
 *
 *   { "action": "create_client", "input": { slug, display_name, email, company?, tier?,
 *       monthly_fee?, build_fee?, timezone?, max_seats?, send_welcome?, issue_sign_and_pay_link? } }
 *   { "action": "resend_login_link", "rep_id": "rep_x" }
 *   { "action": "issue_sign_and_pay_link", "rep_id": "rep_x", "build_fee"?: 2000 }
 *
 * The App Store review tenants are refused (403 review_demo). Logic:
 * lib/opsOnboarding/actions.ts. Auth: Bearer <OPS_ONBOARDING_SECRET>.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isOpsAuthorized } from '@/lib/opsOnboarding/auth'
import { runOpsAction } from '@/lib/opsOnboarding/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  if (!isOpsAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400, headers: NO_STORE })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400, headers: NO_STORE })
  }
  try {
    const r = await runOpsAction(body as Record<string, unknown>)
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE })
  } catch (err) {
    console.error('[ops/onboarding/actions]', err)
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
