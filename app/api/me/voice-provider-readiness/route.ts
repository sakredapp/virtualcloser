// Returns per-mode readiness for each configured voice provider.
// Drives the "live dialing" indicator in the dashboard and admin.
//
// Shape:
//   {
//     ok: true,
//     modes: {
//       concierge:           { ready: boolean, provider: string, issues: string[] },
//       appointment_setter:  { ... },
//       pipeline:            { ... },
//       live_transfer:       { ... },
//     },
//     overall_ready: boolean,    // true only if every enabled mode is ready
//     live_enabled:  boolean,    // global live gate (false = demo-safe mode)
//   }

import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getDialerSettings, type DialerMode } from '@/lib/voice/dialerSettings'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { normalizeAndValidateFlowDefinition } from '@/lib/voice/revringFlow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODES: DialerMode[] = ['concierge', 'appointment_setter', 'pipeline', 'live_transfer']

type ModeStatus = {
  ready: boolean
  provider: string
  issues: string[]
}

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const repId = ctx.tenant.id
  const settings = await getDialerSettings(repId)

  // Read revring + vapi configs once.
  const [rrCfg, vapiCfg] = await Promise.all([
    getIntegrationConfig(repId, 'revring'),
    getIntegrationConfig(repId, 'vapi'),
  ])

  const liveEnabled = checkLiveEnabled(rrCfg, vapiCfg)

  const modes: Record<DialerMode, ModeStatus> = {} as Record<DialerMode, ModeStatus>

  for (const mode of MODES) {
    const enabled = settings.enabled_modes.includes(mode)
    if (!enabled) {
      modes[mode] = { ready: false, provider: 'none', issues: ['mode_disabled'] }
      continue
    }

    const providerKey = settings.mode_providers[mode] ?? 'vapi'

    if (providerKey === 'revring') {
      modes[mode] = auditRevring(mode, rrCfg, liveEnabled)
    } else if (providerKey === 'vapi') {
      modes[mode] = auditVapi(mode, vapiCfg)
    } else {
      modes[mode] = {
        ready: false,
        provider: providerKey,
        issues: [`provider_not_implemented:${providerKey}`],
      }
    }
  }

  const overall_ready =
    liveEnabled &&
    settings.enabled_modes.every((m) => modes[m]?.ready === true)

  return NextResponse.json({ ok: true, modes, overall_ready, live_enabled: liveEnabled })
}

// ── Live gate check ────────────────────────────────────────────────────────

function checkLiveEnabled(
  rrCfg: Record<string, unknown> | null,
  vapiCfg: Record<string, unknown> | null,
): boolean {
  // Environment override wins: VOICE_LIVE_ENABLED=true enables live calling globally.
  const envFlag = process.env.VOICE_LIVE_ENABLED
  if (envFlag !== undefined) return envFlag === 'true' || envFlag === '1'

  // Otherwise defer to explicit `live_enabled` flag in either provider config.
  if (rrCfg?.live_enabled === true) return true
  if (vapiCfg?.live_enabled === true) return true

  // Default: demo-safe, live calls blocked.
  return false
}

// ── Per-provider auditors ──────────────────────────────────────────────────

function auditRevring(
  mode: DialerMode,
  cfg: Record<string, unknown> | null,
  liveEnabled: boolean,
): ModeStatus {
  const issues: string[] = []

  if (!cfg) {
    return { ready: false, provider: 'revring', issues: ['revring_not_configured'] }
  }

  if (!cfg.api_key || typeof cfg.api_key !== 'string') {
    issues.push('missing_api_key')
  }
  if (!cfg.from_number || typeof cfg.from_number !== 'string') {
    issues.push('missing_from_number')
  }

  const agentKey = `${modeToAgentKey(mode)}_agent_id`
  if (!cfg[agentKey] || typeof cfg[agentKey] !== 'string') {
    issues.push(`missing_${agentKey}`)
  }

  if ('flow_definition' in cfg) {
    const flowResult = normalizeAndValidateFlowDefinition(cfg.flow_definition)
    if (!flowResult.ok) {
      issues.push(`flow_definition_invalid:${flowResult.error}`)
    }
  }

  const dryRun = cfg.dry_run !== false
  if (dryRun) {
    issues.push('dry_run_enabled')
  }

  if (!liveEnabled) {
    issues.push('live_not_enabled')
  }

  return { ready: issues.length === 0, provider: 'revring', issues }
}

function auditVapi(
  mode: DialerMode,
  cfg: Record<string, unknown> | null,
): ModeStatus {
  const issues: string[] = []

  if (!cfg) {
    return { ready: false, provider: 'vapi', issues: ['vapi_not_configured'] }
  }

  if (!cfg.api_key || typeof cfg.api_key !== 'string') {
    issues.push('missing_api_key')
  }
  if (!cfg.phone_number_id || typeof cfg.phone_number_id !== 'string') {
    issues.push('missing_phone_number_id')
  }

  const agentKey = modeToVapiAssistantKey(mode)
  if (!cfg[agentKey] || typeof cfg[agentKey] !== 'string') {
    issues.push(`missing_${agentKey}`)
  }

  return { ready: issues.length === 0, provider: 'vapi', issues }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function modeToAgentKey(mode: DialerMode): string {
  switch (mode) {
    case 'concierge':          return 'confirm'
    case 'appointment_setter': return 'appointment_setter'
    case 'pipeline':           return 'pipeline'
    case 'live_transfer':      return 'live_transfer'
  }
}

function modeToVapiAssistantKey(mode: DialerMode): string {
  switch (mode) {
    case 'concierge':          return 'confirm_assistant_id'
    case 'appointment_setter': return 'appointment_setter_assistant_id'
    case 'pipeline':           return 'pipeline_assistant_id'
    case 'live_transfer':      return 'live_transfer_assistant_id'
  }
}
