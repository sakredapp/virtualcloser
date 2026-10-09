/** Calendar › Apple / iCloud or any calendar link: add or remove a member's .ics link. */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { addFeed, removeFeed, maskIcsUrl, IcsUrlError } from '@/lib/icsFeeds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; url?: unknown; label?: unknown; id?: unknown }
  try {
    if (b.op === 'add') {
      const feed = await addFeed(ctx.tenant.id, ctx.member.id, typeof b.url === 'string' ? b.url : '', typeof b.label === 'string' ? b.label : null)
      return NextResponse.json({ ok: true, feed: { id: feed.id, label: feed.label, host: maskIcsUrl(feed.url), events: feed.events.length } })
    }
    if (b.op === 'remove' && typeof b.id === 'string') {
      await removeFeed(ctx.tenant.id, ctx.member.id, b.id)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    if (err instanceof IcsUrlError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[calendar/ics]', err)
    return NextResponse.json({ error: 'Could not save that calendar.' }, { status: 500 })
  }
}
