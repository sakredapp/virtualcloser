// Manual confirm-call trigger (dashboard "Call to confirm now" button).
//
// POST /api/voice/confirm
//   body: { meeting_id: string }

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { dispatchConfirmCall } from '@/lib/voice/dialer'
import { getMeeting } from '@/lib/meetings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { meeting_id?: string }
  if (!body.meeting_id) return NextResponse.json({ error: 'meeting_id required' }, { status: 400 })

  const meeting = await getMeeting(body.meeting_id)
  if (!meeting) return NextResponse.json({ error: 'meeting not found' }, { status: 404 })
  if (meeting.rep_id !== tenant.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const result = await dispatchConfirmCall(body.meeting_id)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })
  return NextResponse.json({ ok: true, call_id: result.callId, vapi_call_id: result.vapiCallId })
}
