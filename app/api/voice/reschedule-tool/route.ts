// Tool endpoint Vapi's reschedule assistant calls during a live call.
//
// Vapi assistants can call HTTP tools mid-conversation. We expose two
// operations on this single endpoint via `action`:
//
//   POST /api/voice/reschedule-tool { action: 'find_slots', meeting_id, count? }
//     → returns 3 free slots from the rep's Google Calendar
//
//   POST /api/voice/reschedule-tool { action: 'book_slot', meeting_id, start_iso }
//     → patches the calendar event to the new slot, flips meeting status
//
// Auth: shared secret via `x-vapi-tool-secret` header (process.env.VAPI_TOOL_SECRET
// or per-tenant client_integrations.config.tool_secret). The Vapi assistant
// is configured to send this header.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getMeeting, updateMeetingStatus } from '@/lib/meetings'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { findFreeSlots, findConflict, patchCalendarEvent } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ToolBody = {
  action?: 'find_slots' | 'book_slot' | 'check_slot'
  meeting_id?: string
  count?: number
  start_iso?: string
  duration_min?: number
  // For check_slot: a natural day reference like 'tuesday' or '2026-04-30'.
  // The assistant should pass either day_iso (date only) — we'll preserve
  // the original meeting time-of-day — OR a full start_iso to check.
  day_iso?: string
}

async function verifySecret(req: Request, repId: string): Promise<boolean> {
  const header = req.headers.get('x-vapi-tool-secret')
  if (!header) return false
  const envSecret = process.env.VAPI_TOOL_SECRET
  if (envSecret && envSecret === header) return true
  const cfg = await getIntegrationConfig(repId, 'vapi')
  const tenantSecret = cfg?.tool_secret as string | undefined
  return Boolean(tenantSecret && tenantSecret === header)
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ToolBody
  if (!body.meeting_id || !body.action) {
    return NextResponse.json({ error: 'action + meeting_id required' }, { status: 400 })
  }

  const meeting = await getMeeting(body.meeting_id)
  if (!meeting) return NextResponse.json({ error: 'meeting_not_found' }, { status: 404 })
  if (!(await verifySecret(req, meeting.rep_id))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // check_slot — assistant asks 'is the same time on Tuesday free?'.
  // Caller passes either day_iso (date-only, we reuse the original
  // meeting's time-of-day) OR a full start_iso. Returns ok+free flag,
  // a friendly string, and the resolved start_iso the assistant should
  // pass to book_slot if the lead agrees.
  if (body.action === 'check_slot') {
    const tz = meeting.timezone || 'UTC'
    const dur = meeting.duration_min ?? 30
    let startIso: string | null = null
    if (body.start_iso) {
      startIso = body.start_iso
    } else if (body.day_iso) {
      // Splice original meeting time-of-day onto the new date.
      try {
        const orig = new Date(meeting.scheduled_at)
        const target = new Date(body.day_iso)
        target.setUTCHours(orig.getUTCHours(), orig.getUTCMinutes(), 0, 0)
        startIso = target.toISOString()
      } catch {
        return NextResponse.json({ error: 'bad_day_iso' }, { status: 400 })
      }
    }
    if (!startIso) {
      return NextResponse.json({ error: 'start_iso_or_day_iso_required' }, { status: 400 })
    }
    const endIso = new Date(new Date(startIso).getTime() + dur * 60_000).toISOString()
    const conflict = await findConflict(meeting.rep_id, startIso, endIso)
    return NextResponse.json({
      ok: true,
      free: !conflict,
      start_iso: startIso,
      end_iso: endIso,
      natural: friendly(startIso, tz),
      conflict_natural: conflict ? friendly(conflict.startIso, tz) : null,
    })
  }

  if (body.action === 'find_slots') {
    const tz = meeting.timezone || 'UTC'
    const fromIso = new Date(Date.now() + 60 * 60_000).toISOString()
    const toIso = new Date(Date.now() + 7 * 86400_000).toISOString()
    const slots = await findFreeSlots(meeting.rep_id, {
      fromIso,
      toIso,
      durationMinutes: meeting.duration_min ?? 30,
      count: Math.min(Math.max(body.count ?? 3, 1), 5),
      tz,
    })
    if (slots === null) {
      return NextResponse.json({ error: 'calendar_not_connected' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      slots: slots.map((s) => ({
        start_iso: s.startIso,
        end_iso: s.endIso,
        natural: friendly(s.startIso, tz),
      })),
    })
  }

  if (body.action === 'book_slot') {
    if (!body.start_iso) return NextResponse.json({ error: 'start_iso required' }, { status: 400 })
    if (meeting.source !== 'google' || !meeting.source_event_id) {
      return NextResponse.json({ error: 'meeting_not_google_backed' }, { status: 400 })
    }
    const dur = meeting.duration_min ?? 30
    const endIso = new Date(new Date(body.start_iso).getTime() + dur * 60_000).toISOString()
    const patched = await patchCalendarEvent(meeting.rep_id, meeting.source_event_id, {
      startIso: body.start_iso,
      endIso,
      timezone: meeting.timezone ?? 'UTC',
    })
    if (!patched) return NextResponse.json({ error: 'patch_failed' }, { status: 500 })

    await updateMeetingStatus(meeting.id, {
      status: 'rescheduled',
      scheduled_at: body.start_iso,
    })
    // Reset confirmation_attempts via direct update so the new time gets a
    // fresh confirm pass.
    await supabase
      .from('meetings')
      .update({ confirmation_attempts: 0 })
      .eq('id', meeting.id)

    return NextResponse.json({
      ok: true,
      new_start_iso: body.start_iso,
      natural: friendly(body.start_iso, meeting.timezone ?? 'UTC'),
    })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

function friendly(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
