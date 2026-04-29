// Per-tenant dialer settings. Stored on client_integrations row with
// key='vapi' under config.dialer_settings. Defaults applied if missing so the
// system keeps working out of the box.

import { getIntegrationConfig, upsertClientIntegration } from '../client-integrations'

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
}

export async function getDialerSettings(repId: string): Promise<DialerSettings> {
  const cfg = await getIntegrationConfig(repId, 'vapi')
  const ds = (cfg?.dialer_settings as Partial<DialerSettings> | undefined) ?? {}
  return {
    ...DEFAULT_DIALER_SETTINGS,
    ...ds,
    // Sanity clamps so a misconfigured tenant cannot break the cron.
    auto_confirm_lead_min: clamp(ds.auto_confirm_lead_min, 5, 240, DEFAULT_DIALER_SETTINGS.auto_confirm_lead_min),
    auto_confirm_lead_max: clamp(ds.auto_confirm_lead_max, 10, 300, DEFAULT_DIALER_SETTINGS.auto_confirm_lead_max),
    retry_delay_min: clamp(ds.retry_delay_min, 5, 240, DEFAULT_DIALER_SETTINGS.retry_delay_min),
    max_attempts: clamp(ds.max_attempts, 1, 5, DEFAULT_DIALER_SETTINGS.max_attempts),
  }
}

export async function saveDialerSettings(repId: string, patch: Partial<DialerSettings>): Promise<DialerSettings> {
  const current = await getDialerSettings(repId)
  const merged: DialerSettings = { ...current, ...patch }
  // Read existing vapi config so we don't trample other keys (api_key, etc).
  const existing = (await getIntegrationConfig(repId, 'vapi')) ?? {}
  await upsertClientIntegration(repId, 'vapi', {
    label: 'Vapi',
    kind: 'api',
    config: { ...existing, dialer_settings: merged },
  })
  return merged
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}
