/**
 * The assistant's name from rows already in hand (no database read), for
 * loops that loaded reps.settings / members.settings themselves: the person's
 * pick, else the company's, else the default. Pure; safe for the Hetzner
 * worker and tests. lib/assistantNameServer reads the rows when you only have ids.
 */
import { readAssistantNameSetting, resolveAssistantName } from '@/lib/assistantName'

const asSettings = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export function assistantNameFromSettings(companySettings: unknown, personSettings?: unknown): string {
  return resolveAssistantName({
    personal: readAssistantNameSetting(asSettings(personSettings)),
    company: readAssistantNameSetting(asSettings(companySettings)),
  })
}

/** The person's pick, else a company name already resolved (e.g. from assistantNameForIds(repId)). */
export function assistantNameWithCompany(companyName: string | null | undefined, personSettings?: unknown): string {
  return resolveAssistantName({ personal: readAssistantNameSetting(asSettings(personSettings)), company: companyName ?? null })
}
