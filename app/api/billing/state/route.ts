// GET /api/billing/state
//
// Returns the current billing snapshot for the signed-in agent so the
// dashboard can render without round-tripping to Stripe each time.

import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getAgentBilling, getOpenPeriod, listPeriods, reconcilePeriodUsage } from '@/lib/billing/agentBilling'
import { secondsToHours } from '@/lib/billing/units'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const { member } = session

  const billing = await getAgentBilling(member.id)
  if (!billing) {
    return NextResponse.json({ ok: true, billing: null })
  }
  // Recompute consumption on every dashboard hit so the bar is fresh.
  await reconcilePeriodUsage(member.id).catch(() => null)
  const period = await getOpenPeriod(member.id)
  const history = await listPeriods(member.id, 12)

  return NextResponse.json({
    ok: true,
    billing,
    period: period
      ? {
          ...period,
          planned_hours: secondsToHours(period.planned_seconds),
          consumed_hours: secondsToHours(period.consumed_seconds),
          overage_hours: secondsToHours(period.overage_seconds),
        }
      : null,
    history: history.map((p) => ({
      ...p,
      planned_hours: secondsToHours(p.planned_seconds),
      consumed_hours: secondsToHours(p.consumed_seconds),
      overage_hours: secondsToHours(p.overage_seconds),
    })),
  })
}
