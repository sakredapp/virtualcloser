import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { canDisconnectQbo, safeQboReturn } from '@/lib/qbo/access'
import { disconnectQbo } from '@/lib/qbo/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Disconnect QuickBooks: the workspace owner only (same rule as a calendar
 * connection). Revokes at Intuit and deletes the tokens and every synced
 * figure. Anyone else gets 403 and nothing is removed.
 */
export async function POST(req: Request) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!canDisconnectQbo(ctx.member)) {
    return NextResponse.json({ ok: false, error: 'Only the workspace owner can disconnect QuickBooks.' }, { status: 403 })
  }
  let ret = '/dashboard/integrations'
  try {
    const fd = await req.formData()
    ret = safeQboReturn(String(fd.get('return') ?? ''))
  } catch {}
  await disconnectQbo(ctx.tenant.id)
  return NextResponse.redirect(new URL(`${ret}?qbo=disconnected`, req.url), 303)
}
