import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { requireSessionSecret } from '@/lib/client-auth'
import { buildSlackAuthUrl, canManageSlack, signSlackState, slackConfig } from '@/lib/slack/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "Add to Slack": an owner or admin of a Suite CXO company goes to Slack's
 * consent screen with a signed state (their company and member, 15 minutes).
 * Not set up (no SLACK_* env): 503.
 */
export async function GET(req: NextRequest) {
  const cfg = slackConfig()
  if (!cfg) return new NextResponse(null, { status: 503 })
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (ctx.tenant.brand !== 'cxo' || !canManageSlack(ctx.member)) {
    return NextResponse.redirect(new URL('/dashboard/integrations?slack=not_allowed', req.url))
  }
  const state = signSlackState(requireSessionSecret(), { repId: ctx.tenant.id, memberId: ctx.member.id })
  return NextResponse.redirect(buildSlackAuthUrl(cfg, state))
}
