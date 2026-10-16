import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runWeeklyLearningsTick } from '@/lib/agent/weeklyLearnings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Weekly Ciao learnings pass — manual trigger only.
 *
 * The pass itself runs on the Hetzner worker (hetzner-worker/index.ts, checked
 * every ~2h, once per owner/admin per ISO week from Monday 7am tenant-local).
 * This route is a thin wrapper around the same function for a manual run:
 * without ?force=1 it obeys the same window + weekly markers; ?force=1 ignores
 * both and runs every CXO tenant now (still capped per call). DB writes only;
 * nothing is sent to anyone.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const result = await runWeeklyLearningsTick({ force })
  return NextResponse.json({ ok: true, ...result, totalAnalyzed: result.analyzed })
}
