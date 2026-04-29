// Admin smoke-test for the WAVV ingest pipeline.
//
// POST /api/admin/wavv-smoke-test
// Body: { repId: string }
//
// Posts a synthetic disposition payload at the rep's own webhook using the
// stored secret, exercising the real auth + parse + voice_calls upsert +
// dialer_kpis recompute path. Returns the inner response so the admin can
// see exactly what failed (401 → secret mismatch, 402 → addon not active,
// 400 → field mapping miss, 200 → working).
//
// We mark the synthetic call with a recognizable provider_call_id prefix
// (`smoke-<timestamp>`) so accidental KPI inflation is easy to clean up.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getIntegrationConfig } from '@/lib/client-integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { repId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const repId = body.repId
  if (!repId) return NextResponse.json({ error: 'repId required' }, { status: 400 })

  const cfg = await getIntegrationConfig(repId, 'wavv')
  const secret =
    (cfg?.webhook_secret as string | undefined) ||
    process.env.WAVV_WEBHOOK_SECRET ||
    ''

  // Build the absolute URL for self-call. Vercel sets VERCEL_URL; locally
  // fall back to the request origin.
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    new URL(req.url).origin

  const callId = `smoke-${Date.now()}`
  const payload = {
    call_id: callId,
    to: '+15555550123',
    from: '+15555550100',
    duration: 47,
    disposition: 'connected',
    started_at: new Date(Date.now() - 60_000).toISOString(),
    ended_at: new Date().toISOString(),
    cost_cents: 12,
  }

  const url = `${origin}/api/webhooks/wavv/${encodeURIComponent(repId)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wavv-secret': secret,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON — return raw text
  }

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    url,
    secret_present: !!secret,
    request: payload,
    response: parsed,
    hint:
      res.status === 401
        ? 'Webhook secret mismatch. Save a wavv integration with a webhook_secret in admin → Integrations.'
        : res.status === 402
          ? 'addon_wavv_kpi is not active for this rep. Add it under Add-ons.'
          : res.status === 400
            ? 'Field mapping failed. The synthetic payload should always parse — if you see this, the parser regressed.'
            : res.ok
              ? 'Pipeline OK. Check voice_calls + dialer_kpis for the synthetic row.'
              : 'Unexpected response — check Vercel logs.',
  })
}
