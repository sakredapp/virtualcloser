import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { makeAgentCRMForRep } from '@/lib/agentcrm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const crm = await makeAgentCRMForRep(ctx.tenant.id)
    if (!crm) {
      // GHL not configured — return empty list, not an error
      return NextResponse.json({ ok: true, calendars: [] })
    }
    const calendars = await crm.listCalendars()
    return NextResponse.json({ ok: true, calendars })
  } catch (err) {
    console.error('[ghl-calendars] error:', err)
    return NextResponse.json({ ok: true, calendars: [] })
  }
}
