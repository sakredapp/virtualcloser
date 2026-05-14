// Manual-trigger backup for the dispatch loop.
//
// As of Hetzner consolidation: the *real* dispatch loop runs on Hetzner
// every 30 seconds (see hetzner-worker/index.ts → runDispatchTick). This
// route is kept ONLY as an admin/CI fallback so an operator can force a
// dispatch tick from anywhere on the internet with the CRON_SECRET.
//
// Vercel cron entry has been removed from vercel.json — this endpoint no
// longer fires automatically. Hitting it duplicates a Hetzner tick and is
// safe (idempotent: every gate is the same).

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runDispatchTick } from '@/lib/voice/dispatchTick'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await runDispatchTick()
  return NextResponse.json(result)
}
