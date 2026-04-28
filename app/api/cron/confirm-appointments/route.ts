// Confirm-appointments cron. Every 15 min, scans the `meetings` table for
// rows in the 30–60 min "call window" and dispatches Vapi confirmation
// calls. The Vapi webhook handles the result + status flip.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { listMeetingsToConfirm } from '@/lib/meetings'
import { dispatchConfirmCall } from '@/lib/voice/dialer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WINDOW_START_MIN = 30
const WINDOW_END_MIN = 60

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const meetings = await listMeetingsToConfirm({
    windowStartMin: WINDOW_START_MIN,
    windowEndMin: WINDOW_END_MIN,
    limit: 200,
  })

  const results: Array<{ meeting_id: string; ok: boolean; reason?: string }> = []
  for (const m of meetings) {
    const r = await dispatchConfirmCall(m.id)
    if (r.ok) results.push({ meeting_id: m.id, ok: true })
    else results.push({ meeting_id: m.id, ok: false, reason: r.reason })
  }

  return NextResponse.json({
    ok: true,
    scanned: meetings.length,
    dispatched: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok).length,
    results,
  })
}
