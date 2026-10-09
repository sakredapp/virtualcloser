import { NextResponse } from 'next/server'
import { partnersReady } from '@/lib/partners'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { loadPartnersToday } from '@/lib/partnersToday'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const tz = ctx.member.timezone || ctx.tenant.timezone || 'America/New_York'
  const empty = { meetings: [], inbound: null, notes: [], calendar_connected: false, timezone: tz }
  if (!(await partnersReady())) return NextResponse.json({ ...empty, notReady: true })
  try {
    return NextResponse.json(await loadPartnersToday(ctx.tenant.id, ctx.member.id, tz))
  } catch (err) {
    console.error('[partners] today', err)
    return NextResponse.json(empty)
  }
}
