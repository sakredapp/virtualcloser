import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { syncPinnacleAirtable, getBases } from '@/lib/pinnacle/airtable'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Pulling whole Airtable bases can take a while across multiple bases +
// paginated tables; give it the full 5-minute Vercel cron budget.
export const maxDuration = 300

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
  const result = await syncPinnacleAirtable()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

export { handle as GET, handle as POST }
