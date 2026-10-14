/**
 * Revenue at a glance for the phone app.
 *
 *  - Pinnacle's book (tenants on the Pinnacle allow-list only):
 *      { kind: 'book', mtd }  — month to date, submitted and issued premium,
 *      with last month over the same days. Top agencies / producers /
 *      carriers come from /api/pinnacle/breakdown as on the web.
 *  - Any other Suite CXO account whose member may see the money (owners,
 *    admins, can_view_comp): { kind: 'books', ...QuickBooks months }.
 *  - Otherwise { kind: 'none', reason } so the app shows a plain empty state.
 */
import { NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { pinnacleMonthToDate } from '@/lib/pinnacle/cache'
import { canSeeFinancials } from '@/lib/qbo/access'
import { loadQboPanelData } from '@/lib/qbo/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (e) {
    if (e instanceof NotExec) return NextResponse.json({ error: 'This app is for the executive team.' }, { status: 403 })
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  }
  const { tenant, member } = ctx
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  const noStore = { headers: { 'Cache-Control': 'no-store' } }

  if (pinnacleAllowed(tenant.id)) {
    const mtd = await pinnacleMonthToDate(tenant.id, tz).catch(() => null)
    return NextResponse.json({ kind: 'book', mtd }, noStore)
  }
  if (!canSeeFinancials(member)) return NextResponse.json({ kind: 'none', reason: 'not_allowed' }, noStore)
  try {
    const q = await loadQboPanelData(tenant.id)
    if (!q.connected) return NextResponse.json({ kind: 'none', reason: 'not_connected' }, noStore)
    return NextResponse.json(
      {
        kind: 'books',
        companyName: q.companyName,
        lastSyncAt: q.lastSyncAt,
        needsReconnect: q.needsReconnect,
        months: q.months.slice(-13),
        topCustomers: q.topCustomers.slice(0, 5),
      },
      noStore,
    )
  } catch {
    return NextResponse.json({ kind: 'none', reason: 'unavailable' }, noStore)
  }
}
