import { getIntegrationConfig } from '../client-integrations'
import type { DialerMode } from './dialerSettings'
import type {
  PlaceVoiceCallInput,
  PlaceVoiceCallResult,
  VoiceProviderClient,
} from './providerTypes'

const BASE = 'https://api.revring.ai/v1'

// Voice billing model controls which credentials are used for calls:
//   shared         — individual clients. api_key comes from REVRING_API_KEY env var;
//                    agent IDs are stored per-client in DB.
//   own_trunk      — enterprise with their own RevRing account. api_key + trunk_sid
//                    are stored per-client in DB.
//   platform_trunk — enterprise on a platform-provisioned trunk. REVRING_MASTER_API_KEY
//                    is used; trunk_sid is stored per-client in DB.
export type VoiceBillingModel = 'shared' | 'own_trunk' | 'platform_trunk'

type RevRingConfig = {
  api_key?: string
  from_number?: string
  caller_id_name?: string
  skip_queue?: boolean
  dry_run?: boolean
  live_enabled?: boolean
  voice_billing_model?: VoiceBillingModel
  trunk_sid?: string
  confirm_agent_id?: string
  reschedule_agent_id?: string
  appointment_setter_agent_id?: string
  pipeline_agent_id?: string
  live_transfer_agent_id?: string
  webhook_secret?: string
}

class RevRingProviderClient implements VoiceProviderClient {
  provider: 'revring' = 'revring'

  assistants: {
    confirm?: string
    reschedule?: string
    appointment_setter?: string
    pipeline?: string
    live_transfer?: string
  }

  aiName?: string

  constructor(private readonly config: RevRingConfig) {
    this.assistants = {
      confirm: config.confirm_agent_id,
      reschedule: config.reschedule_agent_id,
      appointment_setter: config.appointment_setter_agent_id,
      pipeline: config.pipeline_agent_id,
      live_transfer: config.live_transfer_agent_id,
    }
  }

  async placeCall(input: PlaceVoiceCallInput): Promise<PlaceVoiceCallResult> {
    const envLive = process.env.VOICE_LIVE_ENABLED
    const envAllows = envLive === 'true' || envLive === '1'
    const liveEnabled = envAllows || this.config.live_enabled === true

    const dryRun = !liveEnabled || this.config.dry_run === true
    if (dryRun) {
      return { id: `rr_mock_${Date.now().toString(36)}` }
    }

    if (!this.config.api_key) {
      throw new Error('revring_missing_api_key')
    }
    if (!this.config.from_number) {
      throw new Error('revring_missing_from_number')
    }

    const payload: Record<string, unknown> = {
      agentId: input.assistantId,
      fromNumber: this.config.from_number,
      toNumber: input.toNumber,
      callerIdName: this.config.caller_id_name,
      skipQueue: Boolean(this.config.skip_queue),
    }

    // Pass trunk_sid when the client has a dedicated trunk (own or platform-provisioned).
    if (this.config.trunk_sid) {
      payload.trunkSid = this.config.trunk_sid
    }

    const variables: Record<string, string | number | null> = {
      ...(input.variableValues ?? {}),
    }
    if (input.customerName) variables.customer_name = input.customerName
    if (input.customerEmail) variables.customer_email = input.customerEmail
    if (input.firstMessage) variables.first_message_override = input.firstMessage
    if (input.forwardingPhoneNumber) {
      variables.transfer_phone = input.forwardingPhoneNumber
    }
    if (Object.keys(variables).length) payload.variables = variables

    const res = await fetch(`${BASE}/calls`, {
      method: 'POST',
      headers: {
        'x-api-key': this.config.api_key,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`revring_send_call_failed:${res.status}:${text}`)
    }

    const json = (await res.json().catch(() => ({}))) as {
      id?: string
      data?: { id?: string }
    }
    const id = json.data?.id || json.id
    if (!id) throw new Error('revring_send_call_missing_id')
    return { id }
  }
}

export async function makeRevringProviderForRep(
  repId: string,
  _mode: DialerMode,
  options?: { memberId?: string },
): Promise<VoiceProviderClient | null> {
  const raw = await getIntegrationConfig(repId, 'revring', { memberId: options?.memberId })

  const billingModel = ((raw?.voice_billing_model as string) || 'shared') as VoiceBillingModel

  // Resolve which API key to use based on the billing model.
  //   shared         → platform REVRING_API_KEY (individual clients share the platform account)
  //   platform_trunk → platform REVRING_MASTER_API_KEY (enterprise on platform-owned trunk)
  //   own_trunk      → per-client api_key stored in DB
  let resolvedApiKey: string | undefined
  if (billingModel === 'shared') {
    resolvedApiKey = process.env.REVRING_API_KEY || (raw?.api_key as string) || undefined
  } else if (billingModel === 'platform_trunk') {
    resolvedApiKey = process.env.REVRING_MASTER_API_KEY || process.env.REVRING_API_KEY || undefined
  } else {
    // own_trunk
    resolvedApiKey = (raw?.api_key as string) || undefined
  }

  // For shared model, also fall back to platform from-number if none set per-client.
  const resolvedFromNumber =
    (raw?.from_number as string) ||
    (billingModel === 'shared' ? process.env.REVRING_FROM_NUMBER : undefined) ||
    undefined

  // No config at all and no platform fallback → can't make calls.
  if (!resolvedApiKey && billingModel !== 'shared') return null
  if (!raw && !process.env.REVRING_API_KEY) return null

  const cfg: RevRingConfig = {
    api_key: resolvedApiKey,
    from_number: resolvedFromNumber,
    caller_id_name: (raw?.caller_id_name as string) || undefined,
    skip_queue: Boolean(raw?.skip_queue),
    dry_run: raw?.dry_run as boolean | undefined,
    live_enabled: raw?.live_enabled === true,
    voice_billing_model: billingModel,
    trunk_sid: (raw?.trunk_sid as string) || undefined,
    confirm_agent_id: (raw?.confirm_agent_id as string) || undefined,
    reschedule_agent_id: (raw?.reschedule_agent_id as string) || undefined,
    appointment_setter_agent_id: (raw?.appointment_setter_agent_id as string) || undefined,
    pipeline_agent_id: (raw?.pipeline_agent_id as string) || undefined,
    live_transfer_agent_id: (raw?.live_transfer_agent_id as string) || undefined,
    webhook_secret: (raw?.webhook_secret as string) || undefined,
  }

  return new RevRingProviderClient(cfg)
}

export async function verifyRevringSecret(repId: string | undefined, req: Request): Promise<boolean> {
  let expected = process.env.REVRING_WEBHOOK_SECRET || ''
  if (repId) {
    const cfg = await getIntegrationConfig(repId, 'revring')
    const tenantSecret = cfg?.webhook_secret as string | undefined
    if (tenantSecret) expected = tenantSecret
  }

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[revring] SECURITY: REVRING_WEBHOOK_SECRET not configured — accepting all webhook requests')
    }
    return true
  }

  const auth = req.headers.get('authorization')
  const direct = req.headers.get('x-revring-secret')
  const provided =
    direct ||
    (auth?.startsWith('Bearer ') ? auth.slice(7) : auth) ||
    ''

  if (!provided || provided.length !== expected.length) return false
  const crypto = await import('node:crypto')
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
