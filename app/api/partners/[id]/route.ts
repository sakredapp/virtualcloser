import { NextRequest, NextResponse } from 'next/server'
import { partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { deletePartner, getPartner, listPartnerActions, loadPartnerCalendar, meetingsForPartner, senderStatus, updatePartner, type PartnerInput } from '@/lib/partners'
import { calendarWriteReady } from '@/lib/cxoCalendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  if (!(await partnersReady())) return NextResponse.json({ error: PARTNERS_NOT_READY, notReady: true }, { status: 503 })
  const { id } = await params
  const partner = await getPartner(ctx.tenant.id, id)
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const tz = ctx.member.timezone || ctx.tenant.timezone || 'America/New_York'
  const [events, actions, sender, cal] = await Promise.all([
    loadPartnerCalendar(ctx.tenant.id, ctx.member.id, { timeZone: tz }),
    listPartnerActions(ctx.tenant.id, id, 25),
    senderStatus(ctx.tenant.id, ctx.member.id, ctx.member.display_name),
    calendarWriteReady(ctx.tenant.id),
  ])
  return NextResponse.json({
    partner,
    meetings: meetingsForPartner(partner, events, 3),
    actions,
    sender,
    calendar: { connected: cal.connected, canWrite: cal.canWrite },
    timezone: tz,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  if (!(await partnersReady())) return NextResponse.json({ error: PARTNERS_NOT_READY, notReady: true }, { status: 503 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PartnerInput
  try {
    const partner = await updatePartner(ctx.tenant.id, id, body)
    return NextResponse.json({ partner })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save.' }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  if (!(await partnersReady())) return NextResponse.json({ error: PARTNERS_NOT_READY, notReady: true }, { status: 503 })
  const { id } = await params
  await deletePartner(ctx.tenant.id, id)
  return NextResponse.json({ ok: true })
}
