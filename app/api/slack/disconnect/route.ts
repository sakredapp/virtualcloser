import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { canManageSlack, slackConfig } from '@/lib/slack/shared'
import { deleteInstall } from '@/lib/slack/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Disconnect Slack: owners and admins only. Revokes the bot token at Slack
 * and deletes the install and its thread history. Not set up: 503.
 */
export async function POST(req: Request) {
  if (!slackConfig()) return new NextResponse(null, { status: 503 })
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!canManageSlack(ctx.member)) {
    return NextResponse.json({ ok: false, error: 'Only an owner or admin can disconnect Slack.' }, { status: 403 })
  }
  await deleteInstall(ctx.tenant.id)
  return NextResponse.redirect(new URL('/dashboard/integrations?slack=disconnected', req.url), 303)
}
