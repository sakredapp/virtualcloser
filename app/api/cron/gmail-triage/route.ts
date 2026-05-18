// Gmail triage — manual-trigger HTTP wrapper around runGmailTriageTick().
//
// The Hetzner worker calls runGmailTriageTick() directly after each sync
// tick. This route exists for manual smoke tests and CI checks.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runGmailTriageTick } from '@/lib/email/triageTick'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runGmailTriageTick()
  return NextResponse.json({ ok: true, ...result })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
