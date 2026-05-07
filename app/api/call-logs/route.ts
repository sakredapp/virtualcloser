import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { logCall } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const body = await req.json()

  if (!body.contactName && !body.contact_name) {
    return NextResponse.json({ error: 'contactName required' }, { status: 400 })
  }

  const log = await logCall({
    repId: member.rep_id,
    leadId: body.leadId ?? body.lead_id ?? null,
    contactName: body.contactName ?? body.contact_name,
    summary: body.summary ?? '',
    outcome: body.outcome ?? null,
    nextStep: body.nextStep ?? body.next_step ?? null,
    durationMinutes: body.durationMinutes ?? body.duration_minutes ?? null,
    ownerMemberId: member.id,
  })

  return NextResponse.json(log)
}
