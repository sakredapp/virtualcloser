import type { DialerMode, VoiceProviderKey } from './dialerSettings'

export type VoiceAssistantCatalog = {
  confirm?: string
  reschedule?: string
  appointment_setter?: string
  pipeline?: string
  live_transfer?: string
}

export type PlaceVoiceCallInput = {
  assistantId: string
  toNumber: string
  customerName?: string
  customerEmail?: string
  firstMessage?: string
  variableValues?: Record<string, string | number | null>
  metadata?: Record<string, unknown>
  forwardingPhoneNumber?: string
}

export type PlaceVoiceCallResult = {
  id: string
}

export type VoiceProviderClient = {
  provider: VoiceProviderKey
  assistants: VoiceAssistantCatalog
  aiName?: string
  placeCall(input: PlaceVoiceCallInput): Promise<PlaceVoiceCallResult>
}

export type ProviderResolveResult =
  | { ok: true; client: VoiceProviderClient }
  | { ok: false; reason: string }

export type VoiceProviderFactory = (
  repId: string,
  mode: DialerMode,
  options?: {
    memberId?: string
  },
) => Promise<VoiceProviderClient | null>
