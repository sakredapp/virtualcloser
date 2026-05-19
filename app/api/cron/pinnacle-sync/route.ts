import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { syncPinnacleAirtable } from '@/lib/pinnacle/airtable'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Pulling a whole Airtable base can take a while if pagination kicks in;
// give it the full 5-minute Vercel cron budget.
export const maxDuration = 300

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.PINNACLE_AIRTABLE_TOKEN || !process.env.PINNACLE_AIRTABLE_BASE_ID) {
    return NextResponse.json(
      { ok: false, error: 'PINNACLE_AIRTABLE_TOKEN / PINNACLE_AIRTABLE_BASE_ID not set' },
      { status: 503 },
    )
  }
  const result = await syncPinnacleAirtable()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

export { handle as GET, handle as POST }
