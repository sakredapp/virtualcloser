// Upcoming meetings for the receptionist panel.
// Returns meetings in [now, now+hours] for the authenticated tenant.
// Query param: hours (default 8, max 72)

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { listUpcomingMeetingsForRep } from '@/lib/meetings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const hours = Math.min(72, Math.max(1, Number(req.nextUrl.searchParams.get('hours') ?? '8')))
  const fromIso = new Date().toISOString()
  const toIso = new Date(Date.now() + hours * 3600_000).toISOString()

  try {
    const meetings = await listUpcomingMeetingsForRep(ctx.tenant.id, { fromIso, toIso, limit: 50 })
    return NextResponse.json({ ok: true, meetings })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
