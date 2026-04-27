import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { ROLEPLAY_ENABLED } from '@/lib/roleplay'

export const dynamic = 'force-dynamic'

/**
 * Daily roleplay digest (coming-soon stub).
 *
 * When ROLEPLAY_ENABLED=true this cron will:
 *   - For each rep with the roleplay add-on active, build yesterday's
 *     activity rollup (from roleplay_daily_activity).
 *   - Send a single summary message to every manager/owner over Telegram:
 *       "Yesterday: 6/10 reps practiced.
 *        🥇 Sarah — 4 sessions, avg 87.
 *        ⚠️ Ben & Marcus — 0 sessions, behind on assignment 'Price objection'."
 *   - Mark expired assignments past their due date.
 *
 * Until then, this endpoint returns a 200 no-op so we can wire the
 * vercel.json cron schedule now and flip the switch later.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!isAuthorizedCron(authHeader)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!ROLEPLAY_ENABLED) {
    return NextResponse.json({ status: 'skipped', reason: 'ROLEPLAY_ENABLED=false' })
  }
  // TODO: implement digest once voice provider is wired up.
  return NextResponse.json({ status: 'noop' })
}
