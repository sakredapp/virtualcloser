// Per-tenant dialer settings. Stored on client_integrations row with
// key='dialer' under config.dialer_settings (migrated from the legacy
// 'vapi' key when Vapi was scrapped). Defaults applied if missing so the
// system keeps working out of the box. Reads also fall through to the
// legacy 'vapi' key so existing tenant rows aren't lost.

import { getIntegrationConfig, upsertClientIntegration } from '../client-integrations'

export type DialerMode = 'concierge' | 'appointment_setter' | 'pipeline' | 'live_transfer'
export type VoiceProviderKey = 'revring'

export type DialerSettings = {
  // Master switch. When false, the confirm-appointments cron skips this rep.
  // Manual "Call now" buttons in the UI still work.
  auto_confirm_enabled: boolean
  // How many minutes before the meeting to auto-dial. We dial when the
  // meeting falls in [lead_min, lead_max] minutes from now.
  auto_confirm_lead_min: number
  auto_confirm_lead_max: number
  // Retry once if the first attempt hit voicemail / no_answer.
  retry_on_voicemail: boolean
  retry_delay_min: number
  // Maximum total attempts per meeting (cron will not exceed).
  max_attempts: number
  // After-call: run Claude over the transcript and store a 3-bullet summary.
  enable_post_call_summary: boolean
  // After-call: if outcome is no_response / voicemail / cancelled, drop a
  // brain_item follow-up task for the rep.
  enable_followup_tasks: boolean
  // Mode controls. A rep/account can run one or many modes in parallel.
  enabled_modes: DialerMode[]
  // Rep-owned opt-in for pipeline workflow dialing.
  pipeline_opt_in: boolean
  // What to do if live transfer cannot find an available rep.
  live_transfer_fallback: 'book_appointment' | 'collect_callback' | 'end_call'
  // Provider preference per mode (used by orchestration resolver).
  mode_providers: Partial<Record<DialerMode, VoiceProviderKey>>
  // Hard cap, always 1 — the AI dialer is one phone line, one mouth.
  // Kept on the type for backward-compat reads of older tenant configs;
  // enforced regardless in lib/voice/dialer.ts:gateDialerCall via the
  // hasActiveDialerCall check, and clamped to exactly 1 below.
  max_concurrent_calls: 1
}

export const DEFAULT_DIALER_SETTINGS: DialerSettings = {
  auto_confirm_enabled: true,
  auto_confirm_lead_min: 25,
  auto_confirm_lead_max: 45,
  retry_on_voicemail: true,
  retry_delay_min: 30,
  max_attempts: 2,
  enable_post_call_summary: true,
  enable_followup_tasks: true,
  enabled_modes: ['concierge', 'appointment_setter', 'pipeline', 'live_transfer'],
  pipeline_opt_in: false,
  live_transfer_fallback: 'book_appointment',
  mode_providers: {
    concierge: 'revring',
    appointment_setter: 'revring',
    pipeline: 'revring',
    live_transfer: 'revring',
  },
  // Always 1. The dialer is single-threaded by design — see
  // hasActiveDialerCall in lib/voice/dialer.ts.
  max_concurrent_calls: 1,
}

export async function getDialerSettings(repId: string): Promise<DialerSettings> {
  // Prefer the new 'dialer' key; fall back to the legacy 'vapi' row so
  // existing tenant config isn't orphaned by the Vapi scrub.
  const cfg =
    (await getIntegrationConfig(repId, 'dialer')) ??
    (await getIntegrationConfig(repId, 'vapi'))
  const ds = (cfg?.dialer_settings as Partial<DialerSettings> | undefined) ?? {}
  const enabledModes = sanitizeModes(ds.enabled_modes)
  const modeProviders = sanitizeModeProviders(ds.mode_providers)
  const fallback =
    ds.live_transfer_fallback === 'collect_callback' || ds.live_transfer_fallback === 'end_call'
      ? ds.live_transfer_fallback
      : DEFAULT_DIALER_SETTINGS.live_transfer_fallback
  return {
    ...DEFAULT_DIALER_SETTINGS,
    ...ds,
    // Sanity clamps so a misconfigured tenant cannot break the cron.
    auto_confirm_lead_min: clamp(ds.auto_confirm_lead_min, 5, 240, DEFAULT_DIALER_SETTINGS.auto_confirm_lead_min),
    auto_confirm_lead_max: clamp(ds.auto_confirm_lead_max, 10, 300, DEFAULT_DIALER_SETTINGS.auto_confirm_lead_max),
    retry_delay_min: clamp(ds.retry_delay_min, 5, 240, DEFAULT_DIALER_SETTINGS.retry_delay_min),
    max_attempts: clamp(ds.max_attempts, 1, 5, DEFAULT_DIALER_SETTINGS.max_attempts),
    // Hard-locked to 1 regardless of saved value. See hasActiveDialerCall.
    max_concurrent_calls: 1,
    enabled_modes: enabledModes,
    mode_providers: modeProviders,
    pipeline_opt_in: Boolean(ds.pipeline_opt_in),
    live_transfer_fallback: fallback,
  }
}

export async function saveDialerSettings(repId: string, patch: Partial<DialerSettings>): Promise<DialerSettings> {
  const current = await getDialerSettings(repId)
  const merged: DialerSettings = { ...current, ...patch }
  // Read existing 'dialer' config so we don't trample sibling keys.
  const existing = (await getIntegrationConfig(repId, 'dialer')) ?? {}
  await upsertClientIntegration(repId, 'dialer', {
    label: 'Dialer settings',
    kind: 'config',
    config: { ...existing, dialer_settings: merged },
  })
  return merged
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function sanitizeModes(raw: unknown): DialerMode[] {
  const allowed: DialerMode[] = ['concierge', 'appointment_setter', 'pipeline', 'live_transfer']
  if (!Array.isArray(raw)) return [...DEFAULT_DIALER_SETTINGS.enabled_modes]
  const deduped = Array.from(new Set(raw.filter((v): v is DialerMode => typeof v === 'string' && allowed.includes(v as DialerMode))))
  return deduped.length ? deduped : [...DEFAULT_DIALER_SETTINGS.enabled_modes]
}

function sanitizeModeProviders(_raw: unknown): Partial<Record<DialerMode, VoiceProviderKey>> {
  // RevRing is the only valid provider post-Vapi-scrub. Anything stored
  // historically (vapi, twilio, retell, bland, wavv) is treated as if it
  // said revring so pre-scrub tenants don't break on first read.
  return { ...DEFAULT_DIALER_SETTINGS.mode_providers }
}
