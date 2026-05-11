// POST /api/admin/agents/patch-demo
//
// Patches a demo RevRing agent with its canonical prompt + settings.
// Admin-only. Currently supports: health_insurance
//
// Body: { agent: 'health_insurance' }
// Returns: { ok: true, agentId, status } or error

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import {
  HEALTH_INSURANCE_AGENT_ID,
  buildHealthInsuranceAgentUpdate,
} from '@/lib/voice/healthInsuranceAgent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE = 'https://api.revring.ai/v1'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { agent?: string }
  if (body.agent !== 'health_insurance') {
    return NextResponse.json({ ok: false, error: 'unknown agent — supported: health_insurance' }, { status: 400 })
  }

  const apiKey = process.env.REVRING_API_KEY || process.env.REVRING_MASTER_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'REVRING_API_KEY not configured on server' }, { status: 500 })
  }

  const payload = buildHealthInsuranceAgentUpdate()

  const res = await fetch(`${BASE}/agents/${HEALTH_INSURANCE_AGENT_ID}`, {
    method: 'PATCH',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `revring ${res.status}: ${text}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, agentId: HEALTH_INSURANCE_AGENT_ID, status: res.status })
}
