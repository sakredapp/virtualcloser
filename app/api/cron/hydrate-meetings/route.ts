// Hydrate meetings from each tenant's Google Calendar.
// Runs every 30 min to keep the next ~36h of events mirrored into the
// `meetings` table. The confirm-appointments cron then scans this table
// for outbound calls.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants } from '@/lib/tenant'
import { hydrateMeetingsFromGoogle } from '@/lib/meetings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const tenants = await getAllActiveTenants()
  const results: Array<Record<string, unknown>> = []
  for (const tenant of tenants) {
    try {
      const r = await hydrateMeetingsFromGoogle(tenant.id, {
        lookaheadHours: 36,
        timezone: tenant.timezone || undefined,
      })
      results.push({ rep_id: tenant.id, ...r })
    } catch (err) {
      results.push({
        rep_id: tenant.id,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }
  return NextResponse.json({ ok: true, results })
}
