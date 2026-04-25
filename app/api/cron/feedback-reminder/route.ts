import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { nudgeStalePendingPitches } from '@/lib/voice-memos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Daily nudge: any pitch memo still `pending` for >24h gets a Telegram
 * reminder back into the manager chat that received it.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const nudged = await nudgeStalePendingPitches(24)
  return NextResponse.json({ ok: true, nudged })
}
