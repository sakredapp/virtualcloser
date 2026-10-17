import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runFixDigest } from '@/lib/feedback/fixDigestRun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Daily "what to fix" digest. The schedule lives on the Hetzner worker
// (hetzner-worker/index.ts); this route is a manual run (`?force=1` ignores the
// send hour and the once-a-day record). Logic: lib/feedback/fixDigestRun.ts.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const out = await runFixDigest({ force: req.nextUrl.searchParams.get('force') === '1' })
  return NextResponse.json({ ok: !out.error, ...out }, { status: out.error ? 500 : 200 })
}
