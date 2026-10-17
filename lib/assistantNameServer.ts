/**
 * Server side of the assistant name setting (lib/assistantName has the pure
 * rules). Company name: reps.settings.assistant_name. A person's own name:
 * members.settings.assistant_name on THEIR row (an exec assistant working as
 * their exec keeps their own pick, read from their own row).
 *
 * Owner or admin changes the company name; anyone changes their own.
 */
import { cache } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ASSISTANT_NAME,
  ASSISTANT_NAME_KEY,
  readAssistantNameSetting,
  resolveAssistantName,
  validateAssistantName,
} from '@/lib/assistantName'

type SettingsHolder = { settings?: Record<string, unknown> | null } | null | undefined
type MemberLike = {
  id?: string | null
  role?: string | null
  settings?: Record<string, unknown> | null
  acting_assistant?: { id: string } | null
} | null | undefined

export type AssistantNameCtx = { tenant: SettingsHolder & { id?: string }; member?: MemberLike }

/** Owner or admin on the tenant, signed in as themself (not an assistant working as them). */
export function canEditCompanyAssistantName(member: MemberLike): boolean {
  if (!member || member.acting_assistant) return false
  const r = String(member.role ?? '')
  return r === 'owner' || r === 'admin'
}

/** The company's own name (no default), or null. */
export function companyAssistantName(tenant: SettingsHolder): string | null {
  return readAssistantNameSetting(tenant?.settings ?? null)
}

const settingsOfMember = cache(async (memberId: string): Promise<Record<string, unknown>> => {
  const { data } = await supabase.from('members').select('settings').eq('id', memberId).maybeSingle()
  return { ...(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}) }
})

const settingsOfRep = cache(async (repId: string): Promise<Record<string, unknown>> => {
  const { data } = await supabase.from('reps').select('settings').eq('id', repId).maybeSingle()
  return { ...(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}) }
})

/** The signed-in person's own pick (no default), or null. */
export async function personalAssistantName(member: MemberLike): Promise<string | null> {
  if (!member) return null
  if (member.acting_assistant?.id) return readAssistantNameSetting(await settingsOfMember(member.acting_assistant.id).catch(() => ({})))
  return readAssistantNameSetting(member.settings ?? null)
}

/** THE name for this viewer: their own pick → the company's → 'Ciao'. */
export async function assistantNameFor(ctx: AssistantNameCtx | null | undefined): Promise<string> {
  if (!ctx) return ASSISTANT_NAME
  return resolveAssistantName({ personal: await personalAssistantName(ctx.member), company: companyAssistantName(ctx.tenant) })
}

/**
 * For background work (crons, Slack, email, push) that has only ids. With no
 * member it is the company name. Never throws: a failed read is the default.
 */
export async function assistantNameForIds(repId: string | null | undefined, memberId?: string | null): Promise<string> {
  try {
    const [rep, mem] = await Promise.all([
      repId ? settingsOfRep(repId) : Promise.resolve({}),
      memberId ? settingsOfMember(memberId) : Promise.resolve({}),
    ])
    return resolveAssistantName({ personal: readAssistantNameSetting(mem), company: readAssistantNameSetting(rep) })
  } catch {
    return ASSISTANT_NAME
  }
}

type SaveResult = { ok: true; name: string | null } | { ok: false; error: string }

function applyName(settings: Record<string, unknown>, name: string | null): Record<string, unknown> {
  const next = { ...settings }
  if (name) next[ASSISTANT_NAME_KEY] = name
  else delete next[ASSISTANT_NAME_KEY]
  return next
}

/** Save (or clear, on empty) the company name. Caller checks canEditCompanyAssistantName. */
export async function saveCompanyAssistantName(repId: string, raw: unknown): Promise<SaveResult> {
  const v = validateAssistantName(raw)
  if (!v.ok) return v
  const { data, error: readErr } = await supabase.from('reps').select('settings').eq('id', repId).maybeSingle()
  if (readErr) return { ok: false, error: 'Could not save. Try again.' }
  const settings = applyName(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}, v.name)
  const { error } = await supabase.from('reps').update({ settings }).eq('id', repId)
  if (error) return { ok: false, error: 'Could not save. Try again.' }
  return { ok: true, name: v.name }
}

/** Save (or clear, on empty) one person's own name, on their own member row. */
export async function savePersonalAssistantName(memberId: string, raw: unknown): Promise<SaveResult> {
  const v = validateAssistantName(raw)
  if (!v.ok) return v
  const { data, error: readErr } = await supabase.from('members').select('settings').eq('id', memberId).maybeSingle()
  if (readErr) return { ok: false, error: 'Could not save. Try again.' }
  const settings = applyName(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}, v.name)
  const { error } = await supabase.from('members').update({ settings }).eq('id', memberId)
  if (error) return { ok: false, error: 'Could not save. Try again.' }
  return { ok: true, name: v.name }
}
