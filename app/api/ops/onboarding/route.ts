/**
 * GET /api/ops/onboarding[?repId=rep_x]
 *
 * Every Suite CXO client and where it is on onboarding, for Accounts
 * (accounts.virtualcloser.com). Steps and statuses only: never a token, a
 * password, or a Pinnacle book row. Shape: lib/opsOnboarding/shared.ts
 * (CxoOnboardingBoard), the same step vocabulary as crmbuilds
 * shared/onboarding-board.ts. The whole-board answer also carries `requests`,
 * the open "Book a call" prospects (lib/opsOnboarding/requests.ts).
 *
 * Auth: Authorization: Bearer <OPS_ONBOARDING_SECRET> (lib/opsOnboarding/auth).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isOpsAuthorized } from '@/lib/opsOnboarding/auth'
import { loadCxoBoard } from '@/lib/opsOnboarding/load'
import { loadCxoCallRequests } from '@/lib/opsOnboarding/requests'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  if (!isOpsAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }
  const repId = req.nextUrl.searchParams.get('repId')?.trim() || undefined
  if (repId && !/^[A-Za-z0-9_-]{1,80}$/.test(repId)) {
    return NextResponse.json({ ok: false, error: 'bad_rep_id' }, { status: 400, headers: NO_STORE })
  }
  const board = await loadCxoBoard({ repId })
  if (!board) return NextResponse.json({ ok: false, error: 'unreadable', message: 'We could not read the client list.' }, { status: 503, headers: NO_STORE })
  if (repId && !board.tenants.length) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  }
  if (repId) return NextResponse.json(board, { headers: NO_STORE })
  // "Book a call" requests, for the Accounts Lead stage. Null (unreadable) is sent as null, never as "none".
  const requests = await loadCxoCallRequests()
  return NextResponse.json({ ...board, requests }, { headers: NO_STORE })
}
