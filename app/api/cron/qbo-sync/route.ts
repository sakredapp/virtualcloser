/**
 * Daily 10:00 UTC: read-only QuickBooks sync for every connected org.
 * CRON_SECRET only. Not set up (no QBO_* env) → skipped, nothing called.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { qboConfig } from '@/lib/qbo/shared'
import { listQboRepIds, syncQbo } from '@/lib/qbo/data'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!qboConfig()) return NextResponse.json({ ok: true, skipped: 'QuickBooks not set up' })
  const repIds = await listQboRepIds()
  const results: Record<string, unknown> = {}
  for (const id of repIds) {
    const r = await syncQbo(id)
    results[id] = r.ok ? { ok: true, months: r.months } : { ok: false, error: r.error ?? r.skipped }
  }
  return NextResponse.json({ ok: true, orgs: repIds.length, results })
}
