// WAVV dialer webhook. WAVV posts a payload on each call disposition.
// We translate it into a voice_calls row and roll today's KPIs.
//
// URL: /api/webhooks/wavv/[repId]
// Auth: shared `x-wavv-secret` header. Per-tenant secret in
//   client_integrations.config.webhook_secret OR process.env.WAVV_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { recomputeDailyKpis } from '@/lib/wavv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type WavvPayload = {
  call_id?: string
  to?: string
  from?: string
  duration?: number              // seconds
  disposition?: string           // 'connected' | 'voicemail' | 'no_answer' | 'busy' | 'failed' | ...
  recording_url?: string
  started_at?: string
  ended_at?: string
  agent_id?: string
  contact_email?: string
  contact_phone?: string
  cost_cents?: number
  [key: string]: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params
  const provided = req.headers.get('x-wavv-secret') || ''
  const cfg = await getIntegrationConfig(repId, 'wavv')
  const expected =
    (cfg?.webhook_secret as string | undefined) || process.env.WAVV_WEBHOOK_SECRET || ''
  if (expected && expected !== provided) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as WavvPayload
  if (!body.call_id) return NextResponse.json({ error: 'call_id required' }, { status: 400 })

  // Try to link to a lead by phone.
  let leadId: string | null = null
  if (body.contact_phone || body.to) {
    const phone = body.contact_phone || body.to
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('rep_id', repId)
      .eq('phone', phone)
      .maybeSingle()
    if (lead) leadId = lead.id
  }

  const outcome = mapDisposition(body.disposition)

  await supabase
    .from('voice_calls')
    .upsert(
      {
        rep_id: repId,
        lead_id: leadId,
        provider: 'wavv',
        provider_call_id: body.call_id,
        direction: 'outbound_dial',
        to_number: body.to ?? null,
        from_number: body.from ?? null,
        status: 'completed',
        outcome,
        recording_url: body.recording_url ?? null,
        duration_sec: body.duration ?? null,
        cost_cents: body.cost_cents ?? null,
        started_at: body.started_at ?? null,
        ended_at: body.ended_at ?? null,
        raw: body as unknown as Record<string, unknown>,
      },
      { onConflict: 'provider,provider_call_id' },
    )

  // Recompute today's KPI roll-up.
  const day = (body.started_at || body.ended_at || new Date().toISOString()).slice(0, 10)
  await recomputeDailyKpis(repId, day).catch((err) =>
    console.error('[wavv] kpi recompute failed', err),
  )

  return NextResponse.json({ ok: true })
}

function mapDisposition(d: string | undefined): string | null {
  if (!d) return null
  const norm = d.toLowerCase().replace(/\s+/g, '_')
  if (norm === 'connected' || norm === 'answered') return 'connected'
  if (norm === 'voicemail' || norm === 'vm') return 'voicemail'
  if (norm === 'no_answer' || norm === 'noanswer') return 'no_answer'
  if (norm === 'failed' || norm === 'busy') return 'failed'
  if (norm === 'set' || norm === 'appointment_set') return 'confirmed'
  return null
}
