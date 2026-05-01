import { getDialerSettings, type DialerMode, type VoiceProviderKey } from './dialerSettings'
import { makeRevringProviderForRep } from './revring'
import type { ProviderResolveResult, VoiceProviderFactory } from './providerTypes'

// RevRing is the only voice provider in production. Tenants with stale
// 'vapi' values in their dialer_settings.mode_providers are coerced to
// 'revring' on read by getDialerSettings — see dialerSettings.ts.
const PROVIDER_FACTORIES: Partial<Record<VoiceProviderKey, VoiceProviderFactory>> = {
  revring: makeRevringProviderForRep,
}

/**
 * Central resolver for dialer voice provider by mode.
 */
export async function resolveVoiceProviderForMode(
  repId: string,
  mode: DialerMode,
  options?: {
    memberId?: string
  },
): Promise<ProviderResolveResult> {
  const settings = await getDialerSettings(repId)
  const selected = settings.mode_providers[mode] ?? 'revring'

  const factory = PROVIDER_FACTORIES[selected]
  if (!factory) {
    return { ok: false, reason: `provider_not_implemented:${selected}` }
  }

  const client = await factory(repId, mode, options)
  if (!client) return { ok: false, reason: `${selected}_not_configured` }

  return {
    ok: true,
    client,
  }
}
