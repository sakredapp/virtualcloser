// Hydrate meetings from each tenant's Google Calendar and GHL calendar.
// Runs every 30 min to keep the next ~36h of events mirrored into the
// `meetings` table. The confirm-appointments cron then scans this table
// for outbound calls.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants } from '@/lib/tenant'
import { hydrateMeetingsFromGoogle, hydrateMeetingsFromGHL } from '@/lib/meetings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const tenants = await getAllActiveTenants()
  console.log(`[hydrate-meetings] running for ${tenants.length} tenants`)

  const results: Array<Record<string, unknown>> = []

  for (const tenant of tenants) {
    // Google Calendar
    try {
      const r = await hydrateMeetingsFromGoogle(tenant.id, {
        lookaheadHours: 36,
        timezone: tenant.timezone || undefined,
      })
      if (!r.ok && r.reason !== 'not_connected') {
        console.warn(`[hydrate-meetings] google failed rep=${tenant.id} reason=${r.reason}`)
      }
      results.push({ rep_id: tenant.id, source: 'google', ...r })
    } catch (err) {
      console.error(`[hydrate-meetings] google error rep=${tenant.id}`, err)
      results.push({ rep_id: tenant.id, source: 'google', ok: false, error: err instanceof Error ? err.message : 'unknown' })
    }

    // GHL Calendar
    try {
      const r = await hydrateMeetingsFromGHL(tenant.id, { lookaheadHours: 36 })
      if (!r.ok && r.reason !== 'not_connected') {
        console.warn(`[hydrate-meetings] ghl failed rep=${tenant.id} reason=${r.reason}`)
      }
      if (r.inserted > 0 || r.updated > 0) {
        console.log(`[hydrate-meetings] ghl rep=${tenant.id} inserted=${r.inserted} updated=${r.updated}`)
      }
      results.push({ rep_id: tenant.id, source: 'ghl', ...r })
    } catch (err) {
      console.error(`[hydrate-meetings] ghl error rep=${tenant.id}`, err)
      results.push({ rep_id: tenant.id, source: 'ghl', ok: false, error: err instanceof Error ? err.message : 'unknown' })
    }
  }

  const totalInserted = results.reduce((s, r) => s + ((r.inserted as number) || 0), 0)
  console.log(`[hydrate-meetings] done in ${Date.now() - started}ms — ${totalInserted} new meetings across ${tenants.length} tenants`)

  return NextResponse.json({ ok: true, results })
}
