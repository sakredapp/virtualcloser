import { getDialerSettings, type DialerMode, type VoiceProviderKey } from './dialerSettings'
import { makeVapiProviderForRep } from './vapi'
import { makeRevringProviderForRep } from './revring'
import type { ProviderResolveResult, VoiceProviderFactory } from './providerTypes'

const PROVIDER_FACTORIES: Partial<Record<VoiceProviderKey, VoiceProviderFactory>> = {
  vapi: makeVapiProviderForRep,
  revring: makeRevringProviderForRep,
}

/**
 * Central resolver for dialer voice provider by mode.
 *
 * For now we support Vapi in production and keep explicit, non-throwing
 * responses for other providers so orchestration can remain mode-aware while
 * we phase in additional vendors.
 */
export async function resolveVoiceProviderForMode(
  repId: string,
  mode: DialerMode,
  options?: {
    memberId?: string
  },
): Promise<ProviderResolveResult> {
  const settings = await getDialerSettings(repId)
  const selected = settings.mode_providers[mode] ?? 'vapi'

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
