// Vapi server-side client. Raw fetch (no SDK) to match the agentcrm pattern.
// Credentials per-tenant via client_integrations (key='vapi'):
//   {
//     api_key: string,                  // Vapi private key
//     phone_number_id: string,          // Vapi-provisioned number id
//     confirm_assistant_id?: string,    // Pre-created confirm assistant
//     reschedule_assistant_id?: string, // Pre-created reschedule assistant
//     ai_name?: string,                 // 'Riley' / 'Avery' / etc.
//   }
//
// We default to using a pre-created Vapi Assistant via `assistantId` (cheaper
// + more predictable than inlining assistant config per call). If a tenant
// hasn't created assistants yet, `placeConfirmCall` accepts an inline
// `assistantOverrides` block so we can still ship a working call.

import { getIntegrationConfig } from '../client-integrations'

const BASE = 'https://api.vapi.ai'

export type VapiCustomer = {
  number: string                 // E.164 — '+15551234567'
  name?: string
  email?: string
}

export type VapiAssistantOverrides = {
  firstMessage?: string
  variableValues?: Record<string, string | number | null>
  metadata?: Record<string, unknown>
}

export type VapiCall = {
  id: string
  status?: string
  endedReason?: string
  startedAt?: string
  endedAt?: string
  cost?: number                  // dollars
  transcript?: string
  recordingUrl?: string
  stereoRecordingUrl?: string
  artifact?: {
    transcript?: string
    recordingUrl?: string
    messages?: Array<{ role: string; message: string }>
  }
  analysis?: {
    summary?: string
    structuredData?: Record<string, unknown>
    successEvaluation?: string
  }
  customer?: VapiCustomer
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export class VapiClient {
  constructor(
    private readonly apiKey: string,
    private readonly phoneNumberId: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Vapi ${method} ${path} ${res.status}: ${text}`)
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  /**
   * Place an outbound call using a pre-created Vapi assistant.
   * Returns the Vapi call record (immediately, before the call connects).
   */
  async placeCall(opts: {
    assistantId: string
    customer: VapiCustomer
    assistantOverrides?: VapiAssistantOverrides
    metadata?: Record<string, unknown>
  }): Promise<VapiCall> {
    return this.request<VapiCall>('POST', '/call', {
      phoneNumberId: this.phoneNumberId,
      assistantId: opts.assistantId,
      customer: opts.customer,
      assistantOverrides: opts.assistantOverrides,
      metadata: opts.metadata,
    })
  }

  /** Fetch a call by id (status, transcript, recording, cost). */
  async getCall(callId: string): Promise<VapiCall> {
    return this.request<VapiCall>('GET', `/call/${callId}`)
  }

  /** End a call early (e.g. user cancelled from dashboard). */
  async endCall(callId: string): Promise<void> {
    await this.request('PATCH', `/call/${callId}`, { status: 'ended' })
  }
}

export type VapiConfig = {
  api_key: string
  phone_number_id: string
  confirm_assistant_id?: string
  reschedule_assistant_id?: string
  ai_name?: string
}

/** Resolve Vapi config + client for a rep. Null if not configured. */
export async function makeVapiForRep(
  repId: string,
): Promise<{ client: VapiClient; config: VapiConfig } | null> {
  const raw = await getIntegrationConfig(repId, 'vapi')
  if (!raw) return null
  const apiKey = raw.api_key as string | undefined
  const phoneNumberId = raw.phone_number_id as string | undefined
  if (!apiKey || !phoneNumberId) return null
  const config: VapiConfig = {
    api_key: apiKey,
    phone_number_id: phoneNumberId,
    confirm_assistant_id: (raw.confirm_assistant_id as string) || undefined,
    reschedule_assistant_id: (raw.reschedule_assistant_id as string) || undefined,
    ai_name: (raw.ai_name as string) || undefined,
  }
  return { client: new VapiClient(apiKey, phoneNumberId), config }
}

/**
 * Verify a Vapi webhook by shared secret.
 *
 * Vapi sends the secret in the `x-vapi-secret` header (legacy) or as a
 * Bearer token in `Authorization`. Configure the secret per-tenant in
 * `client_integrations.config.webhook_secret` OR globally via
 * `process.env.VAPI_WEBHOOK_SECRET`. If no secret is configured we
 * skip verification (dev / first hookup).
 */
export async function verifyVapiSecret(
  secretHeader: string | null,
  authHeader: string | null,
  repId?: string,
): Promise<boolean> {
  let expected = process.env.VAPI_WEBHOOK_SECRET || ''
  if (repId) {
    const cfg = await getIntegrationConfig(repId, 'vapi')
    const tenantSecret = cfg?.webhook_secret as string | undefined
    if (tenantSecret) expected = tenantSecret
  }
  if (!expected) return true                  // no secret configured — skip
  const provided =
    secretHeader ||
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader) ||
    ''
  if (!provided) return false
  if (provided.length !== expected.length) return false
  const crypto = await import('node:crypto')
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
