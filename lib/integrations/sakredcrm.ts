// Pushes call disposition back to SakredCRM after every terminal RevRing call.
// Reads context.your_crm_lead_id from the dialer_queue row to map back to
// the CRM's lead. No-ops silently if env vars are missing or lead ID absent.

import { supabase } from '@/lib/supabase'
import { generateText } from '@/lib/claude'

const SYNC_URL      = process.env.SAKREDCRM_SYNC_URL
const SYNC_SECRET   = process.env.SAKREDCRM_WEBHOOK_SECRET
const BOOKING_URL   = 'https://www.sakredcrm.com/api/booking/health-insurance/book'

type DispositionPayload = {
  your_lead_id:   string
  vc_queue_id:    string | null
  vc_call_id:     string
  disposition:    string
  outcome:        string | null
  booked_for:     string | null
  summary:        string | null
  transcript:     string | null
  recording_url:  string | null
  duration_sec:   number | null
  attempt_count:  number | null
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

export async function pushDispositionToSakredCRM(args: {
  callId:       string
  repId:        string
  queueId:      string | null
  outcome:      string | null
  summary:      string | null
  transcript:   string | null
  recordingUrl: string | null
  durationSec:  number | null
  callVariables: Record<string, unknown>
}): Promise<void> {
  if (!SYNC_URL || !SYNC_SECRET) return

  // Get the CRM lead ID from the queue context
  let crmLeadId: string | null = null
  let attemptCount: number | null = null

  if (args.queueId) {
    const { data: qrow } = await supabase
      .from('dialer_queue')
      .select('context, attempt_count')
      .eq('id', args.queueId)
      .maybeSingle()

    const ctx = qrow?.context as Record<string, unknown> | null
    crmLeadId = (ctx?.your_crm_lead_id as string | undefined) ?? null
    attemptCount = typeof qrow?.attempt_count === 'number' ? qrow.attempt_count : null
  }

  if (!crmLeadId) return  // Not a SakredCRM-originated call

  const bookedFor =
    (args.callVariables.booking_time as string | undefined) ??
    (args.callVariables.appointment_time as string | undefined) ??
    (args.callVariables.booked_for as string | undefined) ??
    null

  const payload: DispositionPayload = {
    your_lead_id:  crmLeadId,
    vc_queue_id:   args.queueId,
    vc_call_id:    args.callId,
    disposition:   outcomeToDisposition(args.outcome),
    outcome:       args.outcome,
    booked_for:    bookedFor,
    summary:       args.summary,
    transcript:    args.transcript,
    recording_url: args.recordingUrl,
    duration_sec:  args.durationSec,
    attempt_count: attemptCount,
  }

  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-webhook-secret': SYNC_SECRET,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error('[sakredcrm] disposition push failed', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[sakredcrm] disposition push error', err)
  }
}

// ── Booking extraction + push ─────────────────────────────────────────────
// After a SakredCRM health insurance call, Claude reads the transcript and
// extracts any booked appointment, then POSTs it to the booking endpoint.

export async function postSakredCRMBooking(args: {
  queueId:      string | null
  callId:       string
  transcript:   string
  phone:        string | null
  summary?:     string | null
  recordingUrl?: string | null
  durationSec?:  number | null
}): Promise<void> {
  if (!args.transcript || !args.queueId) return

  // Load queue context for customer name, email, and call time vars
  const { data: qrow } = await supabase
    .from('dialer_queue')
    .select('context')
    .eq('id', args.queueId)
    .maybeSingle()

  const ctx = (qrow?.context ?? {}) as Record<string, unknown>

  // Only fire for SakredCRM-originated calls (accepts either key name)
  if (!ctx.sakred_lead_id && !ctx.your_crm_lead_id) return

  const callDate   = (ctx.call_date   as string | undefined) ?? ''
  const callTime   = (ctx.call_time   as string | undefined) ?? ''
  const tz         = (ctx.lead_timezone as string | undefined) ?? 'America/New_York'
  const tzName     = (ctx.lead_tz_name  as string | undefined) ?? 'Eastern Time (ET)'
  const leadName   = (ctx.customer_name as string | undefined) ?? ''
  const leadEmail  = (ctx.email         as string | undefined) ?? null
  const leadPhone  = args.phone ?? (ctx.phone as string | undefined) ?? null

  const prompt = [
    'Extract any booked appointment from this health insurance call transcript.',
    `The call took place on: ${callDate} at ${callTime} (${tzName}, IANA: ${tz}).`,
    'Use this to resolve relative date references like "tomorrow" or "next Tuesday".',
    '',
    'Return ONLY raw JSON in this exact shape:',
    '{ "booked": true, "start": "<ISO 8601 with UTC offset, e.g. 2026-05-12T14:00:00-07:00>", "notes": "<brief>" }',
    'If no specific appointment was agreed on, return: { "booked": false }',
    '',
    'TRANSCRIPT:',
    args.transcript.slice(0, 8000),
  ].join('\n')

  let extracted: { booked: boolean; start?: string; notes?: string } = { booked: false }
  try {
    const raw = await generateText({ prompt, maxTokens: 120 })
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    extracted = JSON.parse(stripped) as typeof extracted
  } catch {
    return  // parse failure = no booking found, silent
  }

  if (!extracted.booked || !extracted.start) return

  const body: Record<string, string | number> = { start: extracted.start }
  if (leadName)             body.name         = leadName
  if (leadPhone)            body.phone        = leadPhone
  if (leadEmail)            body.email        = leadEmail
  if (ctx.state)            body.state        = String(ctx.state)
  if (extracted.notes)      body.summary      = extracted.notes
  if (args.summary)         body.summary      = args.summary  // post-call AI summary wins if present
  if (args.transcript)      body.transcript   = args.transcript
  if (args.recordingUrl)    body.recording_url = args.recordingUrl
  if (typeof args.durationSec === 'number') body.duration_sec = args.durationSec

  try {
    const res = await fetch(BOOKING_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (res.ok) {
      const json = await res.json().catch(() => ({})) as Record<string, unknown>
      console.log(`[sakredcrm] booking posted — start: ${extracted.start}, prospect_id: ${json.prospect_id ?? 'n/a'}`)
    } else {
      console.error('[sakredcrm] booking post failed', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[sakredcrm] booking post error', err)
  }
}
