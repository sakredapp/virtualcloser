// WAVV dialer KPI ingest webhook.
//
// URL: POST /api/webhooks/wavv/[repId]
// Auth: shared `x-wavv-secret` header (or `?secret=` query for Zapier).
//   Per-tenant secret in client_integrations.config.webhook_secret OR
//   process.env.WAVV_WEBHOOK_SECRET (platform fallback).
//
// IMPORTANT — about the payload shape:
//   WAVV's public docs are currently "under construction" and don't expose
//   a self-serve webhook spec for individual/team accounts. The realistic
//   delivery paths today are:
//     1. Zapier bridge: client makes a Zap "WAVV call disposition →
//        Webhooks by Zapier (POST)" and points it at this URL.
//     2. CRM bridge: WAVV → CRM (GHL etc.) → CRM webhook → us. Often the
//        better path because the CRM has the contact context.
//     3. Direct WAVV → us (only works for B2B-partner accounts that have
//        a partner API key).
//
//   Because the field names differ across all three, we accept a wide set
//   of aliases and map them to a normalized shape before writing
//   voice_calls. If a payload arrives we cannot map (no call id), we 400
//   with a hint instead of silently dropping it.
//
// Entitlement: requires the client to have addon_wavv_kpi active. We
// short-circuit with 402 if not — keeps clients from getting "free" KPI
// ingest without the add-on, and prevents free-tier traffic from filling
// up voice_calls.
//
// Usage tracking: each accepted disposition records one wavv_dial event
// against addon_wavv_kpi so the billing dashboard can see volume.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { recomputeDailyKpis } from '@/lib/wavv'
import { isAddonActive } from '@/lib/entitlements'
import { recordUsage } from '@/lib/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Loosely-typed — we never trust callers to use any particular field name.
type RawPayload = Record<string, unknown>

type Normalized = {
  call_id: string
  to: string | null
  from: string | null
  duration_sec: number | null
  disposition_raw: string | null
  outcome: string | null
  recording_url: string | null
  started_at: string | null
  ended_at: string | null
  cost_cents: number | null
  contact_phone: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params

  // Auth: header preferred; query param as fallback for tools (Zapier) that
  // don't easily set custom headers.
  const provided =
    req.headers.get('x-wavv-secret') ||
    req.nextUrl.searchParams.get('secret') ||
    ''
  const cfg = await getIntegrationConfig(repId, 'wavv')
  const expected =
    (cfg?.webhook_secret as string | undefined) ||
    process.env.WAVV_WEBHOOK_SECRET ||
    ''
  if (expected && expected !== provided) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Entitlement gate: don't ingest unless the add-on is paid.
  if (!(await isAddonActive(repId, 'addon_wavv_kpi'))) {
    return NextResponse.json(
      { error: 'addon_wavv_kpi not active for this rep' },
      { status: 402 },
    )
  }

  const body = ((await req.json().catch(() => ({}))) || {}) as RawPayload

  const norm = normalize(body)
  if (!norm.call_id) {
    return NextResponse.json(
      {
        error:
          'could_not_locate_call_id — looked for: call_id, id, callId, uuid, sid, recording_id. Send any one as a string.',
      },
      { status: 400 },
    )
  }

  // Try to link to a lead by phone (last 10 digits — strips +/spaces).
  let leadId: string | null = null
  const phone = norm.contact_phone ?? norm.to
  if (phone) {
    const last10 = phone.replace(/\D/g, '').slice(-10)
    if (last10.length === 10) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('rep_id', repId)
        .like('phone', `%${last10}`)
        .maybeSingle()
      if (lead) leadId = lead.id
    }
  }

  await supabase.from('voice_calls').upsert(
    {
      rep_id: repId,
      lead_id: leadId,
      provider: 'wavv',
      provider_call_id: norm.call_id,
      direction: 'outbound_dial',
      to_number: norm.to,
      from_number: norm.from,
      status: 'completed',
      outcome: norm.outcome,
      recording_url: norm.recording_url,
      duration_sec: norm.duration_sec,
      cost_cents: norm.cost_cents,
      started_at: norm.started_at,
      ended_at: norm.ended_at,
      raw: body as Record<string, unknown>,
    },
    { onConflict: 'provider,provider_call_id' },
  )

  // Recompute today's KPI roll-up.
  const day = (norm.started_at || norm.ended_at || new Date().toISOString()).slice(0, 10)
  await recomputeDailyKpis(repId, day).catch((err) =>
    console.error('[wavv] kpi recompute failed', err),
  )

  // Bill the dial. Don't await on failure — usage tracking shouldn't
  // block the webhook ack.
  await recordUsage({
    repId,
    addonKey: 'addon_wavv_kpi',
    eventType: 'wavv_dial',
    sourceTable: 'voice_calls',
    sourceId: norm.call_id,
    metadata: { disposition_raw: norm.disposition_raw, outcome: norm.outcome },
  }).catch((err) => console.error('[wavv] recordUsage failed', err))

  return NextResponse.json({ ok: true, outcome: norm.outcome, lead_linked: !!leadId })
}

// ── Field aliasing — we accept WAVV-direct, Zapier, and CRM-bridged shapes ─

function pick(b: RawPayload, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = b[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function asString(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function asNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function asIso(v: unknown): string | null {
  const s = asString(v)
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function normalize(b: RawPayload): Normalized {
  const call_id = asString(
    pick(b, 'call_id', 'callId', 'id', 'uuid', 'sid', 'recording_id', 'recordingId'),
  )
  const to = asString(
    pick(b, 'to', 'to_number', 'toNumber', 'phone', 'phone_number', 'dialed_number', 'dialed', 'contact_phone'),
  )
  const from = asString(
    pick(b, 'from', 'from_number', 'fromNumber', 'caller_id', 'callerId', 'agent_phone'),
  )
  const duration_sec = asNumber(
    pick(b, 'duration', 'duration_sec', 'duration_seconds', 'durationSeconds', 'call_duration', 'talk_time'),
  )
  const disposition_raw = asString(
    pick(b, 'disposition', 'result', 'outcome', 'status', 'call_status', 'event', 'event_type', 'tag'),
  )
  const recording_url = asString(
    pick(b, 'recording_url', 'recordingUrl', 'recording', 'audio_url'),
  )
  const started_at = asIso(pick(b, 'started_at', 'startedAt', 'start_time', 'startTime', 'created_at'))
  const ended_at = asIso(pick(b, 'ended_at', 'endedAt', 'end_time', 'endTime', 'completed_at'))
  const cost_cents =
    asNumber(pick(b, 'cost_cents', 'costCents')) ??
    (() => {
      const dollars = asNumber(pick(b, 'cost', 'cost_usd', 'price', 'amount'))
      return dollars === null ? null : Math.round(dollars * 100)
    })()
  const contact_phone = asString(pick(b, 'contact_phone', 'contactPhone', 'lead_phone', 'leadPhone'))

  return {
    call_id: call_id ?? '',
    to,
    from,
    duration_sec,
    disposition_raw,
    outcome: mapDisposition(disposition_raw, duration_sec),
    recording_url,
    started_at,
    ended_at,
    cost_cents,
    contact_phone,
  }
}

function mapDisposition(d: string | null, durationSec: number | null): string | null {
  if (!d) {
    // Fall back to duration heuristic when caller doesn't send a disposition.
    if (durationSec !== null && durationSec >= 30) return 'connected'
    if (durationSec !== null && durationSec > 0) return 'no_answer'
    return null
  }
  const norm = d.toLowerCase().replace(/[\s-]+/g, '_')
  if (
    norm.includes('connect') ||
    norm.includes('answer') ||
    norm === 'live' ||
    norm === 'talked' ||
    norm === 'contact_made'
  ) {
    return 'connected'
  }
  if (norm.includes('voicemail') || norm === 'vm' || norm === 'left_message') return 'voicemail'
  if (norm.includes('no_answer') || norm === 'noanswer' || norm === 'missed' || norm === 'ring_no_answer') {
    return 'no_answer'
  }
  if (norm.includes('busy') || norm.includes('fail') || norm === 'declined' || norm === 'rejected') {
    return 'failed'
  }
  if (
    norm.includes('appointment_set') ||
    norm === 'set' ||
    norm === 'appt_set' ||
    norm.includes('booked') ||
    norm.includes('confirmed')
  ) {
    return 'confirmed'
  }
  if (norm.includes('reschedule')) return 'rescheduled'
  return null
}
