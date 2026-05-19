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
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const adminOk = await isAdminAuthed()
  const cronOk  = isAuthorizedCron(req.headers.get('authorization'))
  if (!adminOk && !cronOk) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    voice_call_id?: string
    rep_id?: string
    limit?: number
  }
  if (!body.voice_call_id && !body.rep_id) {
    return NextResponse.json({ ok: false, error: 'voice_call_id or rep_id required' }, { status: 400 })
  }

  const SYNC_URL = process.env.SAKREDCRM_SYNC_URL
  const SYNC_SECRET = process.env.SAKREDCRM_WEBHOOK_SECRET

  // 1. Find the voice_call(s)
  //    Single mode: voice_call_id → that exact row
  //    Batch mode:  rep_id → latest `limit` rows for that rep (default 3)
  let call: Record<string, unknown> | null = null
  let calls: Array<Record<string, unknown>> = []

  if (body.voice_call_id) {
    const { data } = await supabase
      .from('voice_calls')
      .select('id, rep_id, lead_id, ai_salesperson_id, status, outcome, duration_sec, error_message, transcript, recording_url, raw, call_variables, to_number, created_at')
      .eq('id', body.voice_call_id)
      .maybeSingle()
    if (!data) {
      return NextResponse.json({ ok: false, error: 'voice_call_not_found' }, { status: 404 })
    }
    call = data
    calls = [data]
  } else if (body.rep_id) {
    const limit = Math.min(Math.max(body.limit ?? 3, 1), 20)
    const { data, error } = await supabase
      .from('voice_calls')
      .select('id, rep_id, lead_id, ai_salesperson_id, status, outcome, duration_sec, error_message, transcript, recording_url, raw, call_variables, to_number, created_at')
      .eq('rep_id', body.rep_id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    calls = (data ?? []) as Array<Record<string, unknown>>
    if (calls.length === 0) {
      return NextResponse.json({ ok: false, error: 'no_voice_calls_for_rep' }, { status: 404 })
    }
    call = calls[0]
  }
  // Non-null assertion safe: one of the branches above runs.
  if (!call) {
    return NextResponse.json({ ok: false, error: 'no_call_resolved' }, { status: 500 })
  }

  // Env state — same regardless of call count
  let parsedHost: string | null = null
  let parsedPath: string | null = null
  let parseError: string | null = null
  if (SYNC_URL) {
    try {
      const u = new URL(SYNC_URL)
      parsedHost = u.host
      parsedPath = u.pathname
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }
  }
  const envState = {
    sync_url_set: Boolean(SYNC_URL && SYNC_URL.length > 0),
    sync_url_raw_len: SYNC_URL?.length ?? 0,
    sync_url_host: parsedHost,
    sync_url_path: parsedPath,
    sync_url_parse_error: parseError,
    sync_url_first_8: SYNC_URL?.slice(0, 8) ?? null,
    secret_set: Boolean(SYNC_SECRET && SYNC_SECRET.length > 0),
    secret_len: SYNC_SECRET?.length ?? 0,
  }

  if (!SYNC_URL || !SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'sync_url_or_secret_not_configured', ...envState })
  }

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

  // Per-call helper: fetch queue context, build payload, fire POST, return result.
  async function pushOne(c: Record<string, unknown>) {
    let queueId = (c.raw as Record<string, unknown> | null)?.queue_id as string | undefined
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

    // Fallback: older voice_calls rows have raw overwritten with the RevRing
    // payload and lost queue_id. Resolve via provider_call_id instead.
    if (!yourCrmLeadId) {
      const providerCallId = (c.raw as Record<string, unknown> | null)?.id as string | undefined
        ?? (c.provider_call_id as string | undefined)
      if (providerCallId) {
        const { data: vc } = await supabase
          .from('voice_calls')
          .select('provider_call_id')
          .eq('id', c.id as string)
          .maybeSingle()
        const pcid = (vc?.provider_call_id as string | undefined) ?? providerCallId
        const { data: qrow } = await supabase
          .from('dialer_queue')
          .select('id, context, attempt_count')
          .eq('provider_call_id', pcid)
          .maybeSingle()
        if (qrow) {
          queueId = qrow.id as string
          const ctx = qrow.context as Record<string, unknown> | null
          yourCrmLeadId = (ctx?.your_crm_lead_id as string | undefined) ?? null
          attemptCount = typeof qrow.attempt_count === 'number' ? qrow.attempt_count : null
        }
      }
    }

    if (!yourCrmLeadId) {
      return {
        voice_call_id: c.id,
        to_number: c.to_number,
        outcome: c.outcome,
        skipped: true,
        skip_reason: 'no_your_crm_lead_id_on_queue',
        queue_id: queueId ?? null,
      }
    }

    const cv = (c.call_variables ?? {}) as Record<string, unknown>
    const bookedFor =
      (cv.booking_time as string | undefined) ??
      (cv.appointment_time as string | undefined) ??
      (cv.booked_for as string | undefined) ??
      null

    const payload = {
      your_lead_id:  yourCrmLeadId,
      vc_queue_id:   queueId ?? null,
      vc_call_id:    c.id,
      disposition:   outcomeToDisposition(c.outcome as string | null),
      outcome:       c.outcome,
      booked_for:    bookedFor,
      summary:       c.error_message ? `Call did not complete: ${c.error_message}` : null,
      transcript:    c.transcript,
      recording_url: c.recording_url,
      duration_sec:  c.duration_sec,
      attempt_count: attemptCount,
    }

    try {
      const res = await fetch(SYNC_URL!, {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-webhook-secret': SYNC_SECRET!,
        },
        body: JSON.stringify(payload),
      })
      const text = await res.text().catch(() => '')
      return {
        voice_call_id: c.id,
        to_number: c.to_number,
        outcome: c.outcome,
        queue_id: queueId,
        your_crm_lead_id: yourCrmLeadId,
        disposition: payload.disposition,
        sakredcrm_status: res.status,
        sakredcrm_response_text: text.slice(0, 300),
      }
    } catch (err) {
      return {
        voice_call_id: c.id,
        to_number: c.to_number,
        outcome: c.outcome,
        queue_id: queueId,
        error: 'fetch_threw',
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const results = []
  for (const c of calls) results.push(await pushOne(c))

  return NextResponse.json({
    ok: true,
    ...envState,
    mode: body.voice_call_id ? 'single' : 'batch',
    count: results.length,
    results,
  })
}
