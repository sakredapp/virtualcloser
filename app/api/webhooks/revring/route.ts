import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { verifyRevringSecret } from '@/lib/voice/revring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RevRingWebhook = {
  type?: string
  event?: string
  callId?: string
  id?: string
  status?: string
  outcome?: string
  call?: {
    id?: string
    status?: string
    outcome?: string
    direction?: string
    transcript?: string
    recordingUrl?: string
    summary?: string
    startedAt?: string
    endedAt?: string
    endedReason?: string
    durationSeconds?: number
    metadata?: Record<string, unknown>
    variables?: Record<string, unknown>
  }
  endedReason?: string
  metadata?: Record<string, unknown>
  transcript?: string
  recordingUrl?: string
  summary?: string
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
  variables?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  let body: RevRingWebhook
  try {
    body = JSON.parse(raw) as RevRingWebhook
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const providerCallId = body.call?.id || body.callId || body.id
  if (!providerCallId) return NextResponse.json({ ok: true, ignored: true })

  // Auth-first: if the payload carries rep_id in metadata, verify the secret
  // before touching the DB. This prevents unauthenticated DB reads on spoofed
  // calls. If rep_id is absent we fall through to the DB lookup path below.
  const hintedRepId =
    (body.call?.metadata?.rep_id as string | undefined) ||
    (body.metadata?.rep_id as string | undefined)

  if (hintedRepId) {
    const ok = await verifyRevringSecret(hintedRepId, req)
    if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: callRow } = await supabase
    .from('voice_calls')
    .select('*')
    .eq('provider', 'revring')
    .eq('provider_call_id', providerCallId)
    .maybeSingle()

  if (!callRow) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  // If rep_id was not in the payload, verify secret against the DB row's rep.
  if (!hintedRepId) {
    const ok = await verifyRevringSecret(callRow.rep_id, req)
    if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const status = mapStatus(body.call?.status || body.status)
  if (status && status !== 'completed' && status !== 'failed') {
    await supabase
      .from('voice_calls')
      .update({ status })
      .eq('id', callRow.id)
    return NextResponse.json({ ok: true })
  }

  const terminalStatus = status ?? 'completed'
  const outcome = deriveOutcome(body.call?.outcome || body.outcome, terminalStatus)

  // Collect richer post-call fields from whichever payload shape was sent.
  const summary        = body.call?.summary ?? body.summary ?? null
  const hangupCause    = body.call?.endedReason ?? body.endedReason ?? null
  const callVariables  = body.call?.variables ?? body.variables ?? null
  const durationSec    = body.call?.durationSeconds ?? body.durationSeconds ?? null
  const startedAt      = body.call?.startedAt ?? body.startedAt ?? null
  const endedAt        = body.call?.endedAt ?? body.endedAt ?? null
  const transcript     = body.call?.transcript ?? body.transcript ?? null
  const recordingUrl   = body.call?.recordingUrl ?? body.recordingUrl ?? null

  // Error message is set if the status maps to failed/cancelled.
  const errorMessage: string | null =
    (terminalStatus === 'failed' ? hangupCause ?? 'provider_failed' : null)

  // metrics: anything numeric worth storing long-term
  const callMetrics: Record<string, unknown> = {}
  if (typeof durationSec === 'number') callMetrics.duration_sec = durationSec

  await supabase
    .from('voice_calls')
    .update({
      status: terminalStatus,
      outcome,
      transcript,
      recording_url: recordingUrl,
      duration_sec: durationSec,
      started_at: startedAt,
      ended_at: endedAt,
      summary,
      hangup_cause: hangupCause,
      error_message: errorMessage,
      call_variables: callVariables ?? {},
      call_metrics: callMetrics,
      raw: body as unknown as Record<string, unknown>,
    })
    .eq('id', callRow.id)

  await finalizeQueueFromCall(callRow, outcome)

  return NextResponse.json({ ok: true })
}

function mapStatus(s: string | undefined): string | null {
  if (!s) return null
  const x = s.toLowerCase()
  if (x === 'queued') return 'queued'
  if (x === 'initiated' || x === 'dialing' || x === 'ringing') return 'ringing'
  if (x === 'ongoing' || x === 'in_progress' || x === 'in-progress') return 'in_progress'
  if (x === 'completed' || x === 'ended' || x === 'done') return 'completed'
  if (x === 'failed' || x === 'canceled' || x === 'cancelled') return 'failed'
  return null
}

function deriveOutcome(raw: string | undefined, terminalStatus: string): string | null {
  if (raw) return raw.toLowerCase()
  if (terminalStatus === 'failed') return 'failed'
  return null
}

async function finalizeQueueFromCall(
  callRow: { rep_id: string; raw: Record<string, unknown> | null },
  outcome: string | null,
): Promise<void> {
  const queueId =
    typeof callRow.raw?.queue_id === 'string' ? (callRow.raw.queue_id as string) : null
  if (!queueId) return

  const status = !outcome || outcome === 'failed' ? 'failed' : 'completed'

  await supabase
    .from('dialer_queue')
    .update({
      status,
      last_outcome: outcome,
      next_retry_at: null,
    })
    .eq('id', queueId)
    .eq('rep_id', callRow.rep_id)
}
