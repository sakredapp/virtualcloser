// POST /api/admin/test-disposition-push
//
// Admin-only debug endpoint that runs the SakredCRM disposition pushback
// for a specific voice_call_id and returns the exact HTTP response from
// SakredCRM's webhook endpoint. Used to diagnose pushback issues without
// having to wait for cron / re-fire calls.
//
// Body: { voice_call_id: string }
// Returns:
//   { ok, sync_url_set, sync_url_path, secret_set,
//     queue_id, your_crm_lead_id_found,
//     sakredcrm_status, sakredcrm_response_text }

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { voice_call_id?: string }
  if (!body.voice_call_id) {
    return NextResponse.json({ ok: false, error: 'voice_call_id required' }, { status: 400 })
  }

  const SYNC_URL = process.env.SAKREDCRM_SYNC_URL
  const SYNC_SECRET = process.env.SAKREDCRM_WEBHOOK_SECRET

  // 1. Find the voice_call + its associated queue + lead_campaign
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, rep_id, lead_id, ai_salesperson_id, status, outcome, duration_sec, error_message, transcript, recording_url, raw, call_variables')
    .eq('id', body.voice_call_id)
    .maybeSingle()

  if (!call) {
    return NextResponse.json({ ok: false, error: 'voice_call_not_found' }, { status: 404 })
  }

  const queueId = (call.raw as Record<string, unknown> | null)?.queue_id as string | undefined
  let yourCrmLeadId: string | null = null
  let attemptCount: number | null = null

  if (queueId) {
    const { data: qrow } = await supabase
      .from('dialer_queue')
      .select('context, attempt_count')
      .eq('id', queueId)
      .maybeSingle()
    const ctx = qrow?.context as Record<string, unknown> | null
    yourCrmLeadId = (ctx?.your_crm_lead_id as string | undefined) ?? null
    attemptCount = typeof qrow?.attempt_count === 'number' ? qrow.attempt_count : null
  }

  // Always return the env state, even if push can't proceed
  const envState = {
    sync_url_set: Boolean(SYNC_URL && SYNC_URL.length > 0),
    sync_url_path: SYNC_URL ? new URL(SYNC_URL).pathname : null,
    sync_url_host: SYNC_URL ? new URL(SYNC_URL).host : null,
    secret_set: Boolean(SYNC_SECRET && SYNC_SECRET.length > 0),
    secret_len: SYNC_SECRET?.length ?? 0,
    queue_id: queueId ?? null,
    your_crm_lead_id_found: yourCrmLeadId,
    attempt_count: attemptCount,
  }

  if (!SYNC_URL || !SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'sync_url_or_secret_not_configured', ...envState })
  }
  if (!yourCrmLeadId) {
    return NextResponse.json({ ok: false, error: 'no_your_crm_lead_id_on_queue', ...envState })
  }

  // 2. Build the exact payload that pushDispositionToSakredCRM would send
  const cv = (call.call_variables ?? {}) as Record<string, unknown>
  const bookedFor =
    (cv.booking_time as string | undefined) ??
    (cv.appointment_time as string | undefined) ??
    (cv.booked_for as string | undefined) ??
    null

  function outcomeToDisposition(outcome: string | null): string {
    switch (outcome) {
      case 'confirmed':             return 'appointment_set'
      case 'reschedule_requested':
      case 'rescheduled':           return 'callback'
      case 'cancelled':             return 'not_interested'
      case 'voicemail':             return 'voicemail'
      case 'no_answer':             return 'no_answer'
      case 'connected':             return 'contacted'
      case 'noshow_acknowledged':   return 'no_show'
      case 'failed':                return 'failed'
      default:                      return outcome ?? 'unknown'
    }
  }

  const payload = {
    your_lead_id:  yourCrmLeadId,
    vc_queue_id:   queueId ?? null,
    vc_call_id:    call.id,
    disposition:   outcomeToDisposition(call.outcome),
    outcome:       call.outcome,
    booked_for:    bookedFor,
    summary:       call.error_message ? `Call did not complete: ${call.error_message}` : null,
    transcript:    call.transcript,
    recording_url: call.recording_url,
    duration_sec:  call.duration_sec,
    attempt_count: attemptCount,
  }

  // 3. Actually fire the POST
  let sakredcrmStatus: number | null = null
  let sakredcrmText: string | null = null
  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-webhook-secret': SYNC_SECRET,
      },
      body: JSON.stringify(payload),
    })
    sakredcrmStatus = res.status
    sakredcrmText = await res.text().catch(() => '')
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: 'fetch_threw',
      message: err instanceof Error ? err.message : String(err),
      ...envState,
      payload,
    })
  }

  return NextResponse.json({
    ok: true,
    ...envState,
    payload,
    sakredcrm_status: sakredcrmStatus,
    sakredcrm_response_text: sakredcrmText?.slice(0, 500) ?? null,
  })
}
