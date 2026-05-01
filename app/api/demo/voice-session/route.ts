// POST /api/demo/voice-session
//
// Returns the RevRing agent routing number the client-side SDK should
// dial. WebRTC auth is handled inside the @revring/webrtc-sdk package
// (browser-side, via the Twilio account configured in the RevRing
// dashboard) so we don't mint tokens here — we just resolve which agent
// the visitor should hit.
//
// Request body:  { product: 'sdr' | 'trainer', mode?: string, tier?: string }
// Response 200:  { ok: true, agentNumber: string, agentId: string }
// Response 501:  { ok: false, reason, message } when the env var for that
//                product isn't set (still wired tomorrow / for trainer)

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  product?: 'sdr' | 'trainer'
  mode?: string
  tier?: string
}

const AGENT_CONFIG: Record<
  'sdr' | 'trainer',
  { idEnv: string; numberEnv: string; defaultId?: string; label: string }
> = {
  sdr: {
    idEnv: 'REVRING_SDR_AGENT_ID',
    numberEnv: 'REVRING_SDR_AGENT_NUMBER',
    defaultId: 'cmomybpbu003wka0ieiy2giwi',
    label: 'AI SDR',
  },
  trainer: {
    idEnv: 'REVRING_TRAINER_AGENT_ID',
    numberEnv: 'REVRING_TRAINER_AGENT_NUMBER',
    defaultId: 'cmonbi0aw004tka0i89jh5gij',
    label: 'AI Trainer',
  },
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  const product = body.product === 'trainer' ? 'trainer' : 'sdr'
  const cfg = AGENT_CONFIG[product]
  const agentId = process.env[cfg.idEnv] ?? cfg.defaultId ?? null
  const agentNumber = process.env[cfg.numberEnv] ?? null

  if (!agentNumber) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'agent_number_not_configured',
        message: `${cfg.label} demo not wired yet. Set env var ${cfg.numberEnv} to the E.164 number assigned to the agent in RevRing → Agents → Phone Numbers.`,
        productLabel: cfg.label,
      },
      { status: 501 },
    )
  }

  return NextResponse.json({
    ok: true,
    product,
    productLabel: cfg.label,
    agentId,
    agentNumber,
  })
}
