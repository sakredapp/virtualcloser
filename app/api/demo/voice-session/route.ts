// POST /api/demo/voice-session
//
// Returns the RevRing agent routing number the client-side SDK should
// dial. WebRTC auth is handled inside the @revring/webrtc-sdk package
// (browser-side, via the Twilio account configured in the RevRing
// dashboard) so we don't mint tokens here — we just resolve which agent
// the visitor should hit.
//
// Request body:  { product: 'sdr' | 'trainer', mode?: IndustryKey, tier?: string }
// Response 200:  { ok: true, agentNumber: string, agentId: string }
// Response 501:  { ok: false, reason, message } when the agent for that
//                industry doesn't have a Twilio number wired yet.

import { NextRequest, NextResponse } from 'next/server'
import type { ReceptionistCallType } from '@/lib/voice/receptionistPrompts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type IndustryKey =
  | 'life_mortgage_protection'
  | 'windows'
  | 'solar'
  | 'roofing'
  | 'pest'
  | 'lawn'

type Body = {
  product?: 'sdr' | 'trainer' | 'receptionist'
  mode?: IndustryKey | string
  callType?: ReceptionistCallType | string
  tier?: string
}

// AI Trainer demo (single agent, no industry split today).
const TRAINER_CONFIG = {
  idEnv: 'REVRING_TRAINER_AGENT_ID',
  numberEnv: 'REVRING_TRAINER_AGENT_NUMBER',
  defaultId: 'cmonbi0aw004tka0i89jh5gij',
  label: 'AI Trainer',
}

// AI SDR demo agents — one per industry. Each industry has its own
// RevRing agent ID and its own Twilio routing number; the env var is the
// Twilio number, the defaultId is the live agent we PATCHed via the
// RevRing API. When the rep wires a number, set the matching env var on
// Vercel and the demo flips on.
type SdrIndustry = {
  defaultId: string
  numberEnv: string
  label: string
}

const SDR_INDUSTRY_CONFIG: Record<IndustryKey, SdrIndustry> = {
  life_mortgage_protection: {
    defaultId: 'cmomybpbu003wka0ieiy2giwi',
    numberEnv: 'REVRING_SDR_AGENT_NUMBER',
    label: 'AI SDR — Mortgage Protection',
  },
  windows: {
    defaultId: 'cmooh6ik5000flh0hw5139f8m',
    numberEnv: 'REVRING_SDR_WINDOWS_NUMBER',
    label: 'AI SDR — Windows',
  },
  solar: {
    defaultId: 'cmoohaqjb000hlh0hbge3cm5o',
    numberEnv: 'REVRING_SDR_SOLAR_NUMBER',
    label: 'AI SDR — Solar',
  },
  roofing: {
    defaultId: 'cmoohbmza000jlh0h1vcebw72',
    numberEnv: 'REVRING_SDR_ROOFING_NUMBER',
    label: 'AI SDR — Roofing',
  },
  pest: {
    defaultId: 'cmoohdagf000llh0hdeq7vl1x',
    numberEnv: 'REVRING_SDR_PEST_NUMBER',
    label: 'AI SDR — Pest Control',
  },
  lawn: {
    defaultId: 'cmoohf4js000nlh0h6fwlmcv8',
    numberEnv: 'REVRING_SDR_LAWN_NUMBER',
    label: 'AI SDR — Lawn Care',
  },
}

const DEFAULT_INDUSTRY: IndustryKey = 'life_mortgage_protection'

function resolveIndustry(raw: string | undefined): IndustryKey {
  if (raw && raw in SDR_INDUSTRY_CONFIG) return raw as IndustryKey
  return DEFAULT_INDUSTRY
}

// Receptionist demo — one agent per call type, no industry split.
type ReceptionistAgentConfig = {
  defaultId: string
  idEnv: string
  numberEnv: string
  label: string
}

const RECEPTIONIST_AGENT_CONFIG: Record<ReceptionistCallType, ReceptionistAgentConfig> = {
  inbound: {
    defaultId: 'cmosxr3e50043lc0h96jhtc8k',
    idEnv: 'REVRING_RECEPTIONIST_INBOUND_ID',
    numberEnv: 'REVRING_RECEPTIONIST_INBOUND_NUMBER',
    label: 'AI Receptionist — Inbound (Prospect from Ad)',
  },
  outbound_confirm: {
    defaultId: 'cmosxrwmp0045lc0hx3ejgf2o',
    idEnv: 'REVRING_RECEPTIONIST_OUTBOUND_CONFIRM_ID',
    numberEnv: 'REVRING_RECEPTIONIST_OUTBOUND_CONFIRM_NUMBER',
    label: 'AI Receptionist — Appointment Confirmation',
  },
  life_insurance_missed_payment: {
    defaultId: 'cmosxsjfd0047lc0htyiilh7l',
    idEnv: 'REVRING_RECEPTIONIST_LIFE_INSURANCE_ID',
    numberEnv: 'REVRING_RECEPTIONIST_LIFE_INSURANCE_NUMBER',
    label: 'AI Receptionist — Life Insurance Missed Payment',
  },
}

const DEFAULT_RECEPTIONIST_CALL_TYPE: ReceptionistCallType = 'outbound_confirm'

function resolveCallType(raw: string | undefined): ReceptionistCallType {
  if (raw && raw in RECEPTIONIST_AGENT_CONFIG) return raw as ReceptionistCallType
  return DEFAULT_RECEPTIONIST_CALL_TYPE
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  const product = body.product === 'trainer'
    ? 'trainer'
    : body.product === 'receptionist'
    ? 'receptionist'
    : 'sdr'

  if (product === 'receptionist') {
    const callType = resolveCallType(body.callType)
    const cfg = RECEPTIONIST_AGENT_CONFIG[callType]
    const agentId = process.env[cfg.idEnv] ?? cfg.defaultId
    const agentNumber = process.env[cfg.numberEnv] ?? null
    if (!agentNumber) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'agent_number_not_configured',
          message: `${cfg.label} demo not wired yet. Create a RevRing agent using the prompt from lib/voice/receptionistPrompts.ts, attach a Twilio number, then set ${cfg.numberEnv} on Vercel.`,
          productLabel: cfg.label,
        },
        { status: 501 },
      )
    }
    return NextResponse.json({
      ok: true,
      product,
      callType,
      productLabel: cfg.label,
      agentId,
      agentNumber,
    })
  }

  if (product === 'trainer') {
    const agentId = process.env[TRAINER_CONFIG.idEnv] ?? TRAINER_CONFIG.defaultId
    const agentNumber = process.env[TRAINER_CONFIG.numberEnv] ?? null
    if (!agentNumber) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'agent_number_not_configured',
          message: `${TRAINER_CONFIG.label} demo not wired yet. Set ${TRAINER_CONFIG.numberEnv} to the Twilio number assigned to the agent in RevRing → Agents → Phone Numbers.`,
          productLabel: TRAINER_CONFIG.label,
        },
        { status: 501 },
      )
    }
    return NextResponse.json({
      ok: true,
      product,
      productLabel: TRAINER_CONFIG.label,
      agentId,
      agentNumber,
    })
  }

  const industry = resolveIndustry(body.mode)
  const cfg = SDR_INDUSTRY_CONFIG[industry]
  const agentId = cfg.defaultId
  const agentNumber = process.env[cfg.numberEnv] ?? null

  if (!agentNumber) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'agent_number_not_configured',
        message: `${cfg.label} demo not wired yet. Buy a Twilio number, attach it to the RevRing agent (${agentId}), then set ${cfg.numberEnv} on Vercel to that E.164 number.`,
        productLabel: cfg.label,
      },
      { status: 501 },
    )
  }

  return NextResponse.json({
    ok: true,
    product,
    industry,
    productLabel: cfg.label,
    agentId,
    agentNumber,
  })
}
