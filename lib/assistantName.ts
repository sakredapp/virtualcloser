/**
 * The AI assistant's visible name.
 *
 * No imports on purpose: `lib/brand.ts` pulls in `next/headers`, so client
 * components cannot read the name from there. Client and server code both read
 * the default and the pure rules from here.
 *
 * The name is a setting (owner 2026-10-17): a company can rename its assistant
 * (reps.settings.assistant_name) and each person can pick their own name for it
 * (members.settings.assistant_name). Resolution: the person's own name, else the
 * company's, else ASSISTANT_NAME. Read it with assistantNameFor (server,
 * lib/assistantNameServer) or useAssistantName() (client,
 * app/components/AssistantNameProvider). ASSISTANT_NAME is only the default.
 *
 * This is only the name people see and the name the assistant calls herself.
 * Code identifiers, routes (`/api/mira/ask`), events (`mira:ask`), CSS classes
 * and stored keys keep their `mira` spelling and must not be derived from it.
 */

/** Suite CXO default: every executive and employee surface, the public site and the agent prompts. */
export const ASSISTANT_NAME = 'Ciao'

/** Virtual Closer (the sales-rep product) keeps its own name. */
export const VC_ASSISTANT_NAME = 'Mira'

/** Settings key on reps.settings (company) and members.settings (person). */
export const ASSISTANT_NAME_KEY = 'assistant_name'

export const ASSISTANT_NAME_MAX = 24

// Letters (any script), spaces, hyphens and apostrophes; starts with a letter.
const NAME_RE = /^\p{L}[\p{L}\p{M} '’-]*$/u

export type AssistantNameCheck = { ok: true; name: string | null } | { ok: false; error: string }

/**
 * Validate what someone typed. Trimmed, inner spaces collapsed, 1-24 chars,
 * letters / spaces / hyphen / apostrophe. Empty clears the setting (name: null).
 */
export function validateAssistantName(raw: unknown): AssistantNameCheck {
  if (raw !== null && raw !== undefined && typeof raw !== 'string') return { ok: false, error: 'The name must be text.' }
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return { ok: true, name: null }
  if (name.length > ASSISTANT_NAME_MAX) return { ok: false, error: `Keep it to ${ASSISTANT_NAME_MAX} characters or fewer.` }
  if (!NAME_RE.test(name)) return { ok: false, error: 'Use letters, spaces, hyphens and apostrophes only.' }
  return { ok: true, name }
}

/** The valid name stored in a settings object, or null (missing or invalid). */
export function readAssistantNameSetting(settings: Record<string, unknown> | null | undefined): string | null {
  const v = validateAssistantName(settings?.[ASSISTANT_NAME_KEY] ?? null)
  return v.ok ? v.name : null
}

/** The person's own name, else the company's, else the default. */
export function resolveAssistantName(input: { personal?: string | null; company?: string | null; fallback?: string }): string {
  const personal = validateAssistantName(input.personal ?? null)
  if (personal.ok && personal.name) return personal.name
  const company = validateAssistantName(input.company ?? null)
  if (company.ok && company.name) return company.name
  return input.fallback ?? ASSISTANT_NAME
}

/** Swap the default name for the chosen one in text built elsewhere (word boundary, case-sensitive). */
export function withAssistantName(text: string, name: string): string {
  if (!name || name === ASSISTANT_NAME) return text
  return text.replace(new RegExp(`\\b${ASSISTANT_NAME}\\b`, 'g'), name)
}
