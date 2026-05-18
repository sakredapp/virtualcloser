// Gmail inbox sync — manual-trigger HTTP wrapper around runGmailSyncTick().
//
// The Hetzner worker calls runGmailSyncTick() directly every ~2 min as part
// of its tick loop. This route is kept for manual smoke tests and CI checks
// (still gated by CRON_SECRET).

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runGmailSyncTick } from '@/lib/email/syncTick'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runGmailSyncTick()
  return NextResponse.json({ ok: true, ...result })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
