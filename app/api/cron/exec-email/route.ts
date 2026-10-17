import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runExecEmail } from '@/lib/exec/execEmailRun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Formal executive email digest — Suite CXO only. The schedule lives on the
 * Hetzner worker (hetzner-worker/index.ts); this route is for a manual run
 * (`?force=1` sends now, ignoring the 7am gate and the once-a-day record).
 * The logic is lib/exec/execEmailRun.ts.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const out = await runExecEmail({ force })
  return NextResponse.json({ ok: true, ...out })
}
