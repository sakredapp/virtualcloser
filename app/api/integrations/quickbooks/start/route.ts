import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { requireSessionSecret } from '@/lib/client-auth'
import { buildQboAuthUrl, qboConfig, signQboState } from '@/lib/qbo/shared'
import { canSeeFinancials, safeQboReturn } from '@/lib/qbo/access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "Connect QuickBooks": sends an exec to Intuit's consent screen asking only
 * for com.intuit.quickbooks.accounting (we only ever read reports). Exec
 * only. Not set up (no QBO_* env) → back to the page with ?qbo=not_set_up;
 * nothing else happens.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const ret = safeQboReturn(url.searchParams.get('return'))
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (!canSeeFinancials(ctx.member)) return NextResponse.redirect(new URL(`${ret}?qbo=not_allowed`, req.url))
  const cfg = qboConfig()
  if (!cfg) return NextResponse.redirect(new URL(`${ret}?qbo=not_set_up`, req.url))
  const state = signQboState(requireSessionSecret(), { repId: ctx.tenant.id, memberId: ctx.member.id, ret })
  return NextResponse.redirect(buildQboAuthUrl(cfg, state))
}
