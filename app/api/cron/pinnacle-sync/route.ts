import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { revalidateTag } from 'next/cache'
import { syncPinnacleAirtable, getBases } from '@/lib/pinnacle/airtable'
import { PINNACLE_CACHE_TAG, computePinnacleOverview, pinnacleViewerTenantIds } from '@/lib/pinnacle/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A full pull of all three bases is ~9 min; Fluid compute on Pro allows 800s.
// `?base=<id>` (repeatable) syncs only those bases, so a manual run of the
// Pinnacle master base finishes well inside the limit.
export const maxDuration = 800

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.PINNACLE_AIRTABLE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'PINNACLE_AIRTABLE_TOKEN not set' },
      { status: 503 },
    )
  }
  // Accepts the multi-base PINNACLE_AIRTABLE_BASES or the legacy
  // PINNACLE_AIRTABLE_BASE_ID — getBases() does the fallback.
  const bases = getBases()
  if (bases.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'no bases configured — set PINNACLE_AIRTABLE_BASES (preferred) or PINNACLE_AIRTABLE_BASE_ID',
      },
      { status: 503 },
    )
  }
  const baseIds = req.nextUrl.searchParams.getAll('base')
  const result = await syncPinnacleAirtable({ baseIds })
  // Warm the executive rollup for every viewer so the first page view of
  // the day reads one cached row instead of running the RPCs.
  const rollup: Array<{ tenant_id: string; ok: boolean; error?: string }> = []
  for (const id of await pinnacleViewerTenantIds()) {
    try {
      await computePinnacleOverview(id)
      rollup.push({ tenant_id: id, ok: true })
    } catch (err) {
      rollup.push({ tenant_id: id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  revalidateTag(PINNACLE_CACHE_TAG)
  return NextResponse.json({ ...result, rollup }, { status: result.ok ? 200 : 500 })
}

export { handle as GET, handle as POST }
