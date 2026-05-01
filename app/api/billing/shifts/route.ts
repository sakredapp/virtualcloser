// /api/billing/shifts
//
// GET   → list active shifts for the signed-in agent
// POST  → upsert a shift (body: { weekday, startMinute, endMinute, mode?, shiftId? })
// DELETE → remove a shift (body: { shiftId })
//
// Wraps lib/dialerHours functions and enforces that the agent can only
// touch their own shift rows.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { listShifts, upsertShift, deleteShift } from '@/lib/dialerHours'
import type { DialerMode } from '@/lib/voice/dialerSettings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  const { member, tenant } = session
  const shifts = await listShifts(tenant.id, member.id)
  return NextResponse.json({ ok: true, shifts })
}

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  let body: { weekday?: number; startMinute?: number; endMinute?: number; mode?: DialerMode | null; shiftId?: string | null }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }
  const wd = Number(body.weekday)
  const start = Number(body.startMinute)
  const end = Number(body.endMinute)
  if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
    return NextResponse.json({ ok: false, reason: 'bad_weekday' }, { status: 400 })
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1440 || end <= start) {
    return NextResponse.json({ ok: false, reason: 'bad_time_range' }, { status: 400 })
  }
  const id = await upsertShift({
    repId: session.tenant.id,
    memberId: session.member.id,
    weekday: wd,
    startMinute: Math.round(start),
    endMinute: Math.round(end),
    mode: body.mode ?? null,
    shiftId: body.shiftId ?? null,
  })
  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: NextRequest) {
  let session
  try {
    session = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  let body: { shiftId?: string }
  try {
    body = (await req.json()) as { shiftId?: string }
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }
  if (!body.shiftId) return NextResponse.json({ ok: false, reason: 'no_id' }, { status: 400 })
  await deleteShift(session.tenant.id, body.shiftId)
  return NextResponse.json({ ok: true })
}
