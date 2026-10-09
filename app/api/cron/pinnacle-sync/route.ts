import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { revalidateTag } from 'next/cache'
import { syncPinnacleAirtable, getBases } from '@/lib/pinnacle/airtable'
import { supabase } from '@/lib/supabase'
import { PINNACLE_CACHE_TAG, computePinnacleOverview, pinnacleViewerTenantIds } from '@/lib/pinnacle/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel cron hits this every 15 min. Each tick pulls whatever tables are due
// (once a day each) until ~11 min in, saving an Airtable cursor per page; a
// table cut off mid-pull resumes on the next tick. `?base=<id>` limits to
// those bases, `?force=1` re-pulls tables older than 30 min.
export const maxDuration = 800
const SYNC_BUDGET_MS = 660_000

/**
 * After pinnacle_post_sync() (pg_cron) sweeps a completed pull and rebuilds
 * the rollups, warm each viewer's overview and drop the Next data cache once.
 */
async function warmIfSwept(): Promise<Array<{ tenant_id: string; ok: boolean; error?: string }> | null> {
  const [{ data: swept }, { data: state }] = await Promise.all([
    supabase.from('pinnacle_sync_table_runs').select('swept_at').not('swept_at', 'is', null).order('swept_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pinnacle_sync_state').select('warmed_at').eq('id', 1).maybeSingle(),
  ])
  const sweptAt = (swept as { swept_at?: string } | null)?.swept_at
  const warmedAt = (state as { warmed_at?: string | null } | null)?.warmed_at
  if (!sweptAt || (warmedAt && new Date(warmedAt) >= new Date(sweptAt))) return null
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
  await supabase.from('pinnacle_sync_state').upsert({ id: 1, warmed_at: new Date().toISOString() })
  return rollup
}

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
  const started = Date.now()
  const baseIds = req.nextUrl.searchParams.getAll('base')
  const force = req.nextUrl.searchParams.get('force') === '1'
  const result = await syncPinnacleAirtable({ baseIds, force, deadlineAt: started + SYNC_BUDGET_MS })
  const rollup = Date.now() - started < 720_000 ? await warmIfSwept() : null
  return NextResponse.json({ ...result, rollup }, { status: result.ok ? 200 : 500 })
}

export { handle as GET, handle as POST }
