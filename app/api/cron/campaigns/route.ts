import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runCampaignTick } from '@/lib/campaign/campaignEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await runCampaignTick()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/campaigns] tick failed', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
