// Pushes call disposition back to SakredCRM after every terminal RevRing call.
// Reads context.your_crm_lead_id from the dialer_queue row to map back to
// the CRM's lead. No-ops silently if env vars are missing or lead ID absent.

import { supabase } from '@/lib/supabase'

const SYNC_URL    = process.env.SAKREDCRM_SYNC_URL
const SYNC_SECRET = process.env.SAKREDCRM_WEBHOOK_SECRET

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
