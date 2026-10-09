import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { PINNACLE_CACHE_TAG, computePinnacleOverview, pinnacleViewerTenantIds } from '@/lib/pinnacle/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Recompute the executive rollup for every viewer tenant on demand (cron secret). */
async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const tenants = await pinnacleViewerTenantIds()
  const results: Array<{ tenant_id: string; ok: boolean; rows?: number; error?: string }> = []
  for (const id of tenants) {
    try {
      const r = await computePinnacleOverview(id)
      results.push({ tenant_id: id, ok: true, rows: r.pinnacleRows.length })
    } catch (err) {
      results.push({ tenant_id: id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  revalidateTag(PINNACLE_CACHE_TAG)
  return NextResponse.json({ ok: results.every((r) => r.ok), results })
}

export { handle as GET, handle as POST }
