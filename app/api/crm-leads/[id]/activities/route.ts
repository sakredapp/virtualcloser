import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getLeadActivities, logActivity } from '@/lib/crmLeads'
import type { ActivityType } from '@/types'

export const dynamic = 'force-dynamic'

const LOGGABLE: ActivityType[] = ['call', 'email', 'visit', 'meeting', 'note', 'task']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const { id } = await params
  const activities = await getLeadActivities(member.rep_id, id)
  return NextResponse.json(activities)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const { id } = await params
  const body = await req.json()

  const type = body.type as ActivityType
  if (!LOGGABLE.includes(type)) {
    return NextResponse.json({ error: 'invalid activity type' }, { status: 400 })
  }
  if (type === 'note' && !body.body?.trim()) {
    return NextResponse.json({ error: 'note body required' }, { status: 400 })
  }

  await logActivity(member.rep_id, id, {
    type,
    body: body.body ?? null,
    occurredAt: body.occurredAt ?? undefined,
    authorMemberId: member.id,
    contactName: body.contactName ?? null,
    payload: body.payload ?? {},
  })

  return NextResponse.json({ ok: true })
}
