/**
 * Company-wide settings on the Integrations page that change things for
 * everyone: the logo shown in the app, and the private Wispr Flow / Plaud
 * inbox link. Owner or admin only, never an assistant working as their exec
 * (role gap found in the 2026-10-22 settings audit: the page actions only
 * checked that someone was signed in).
 *
 * Used by app/dashboard/integrations/page.tsx and by Ciao / MCP through the
 * settings registry (lib/settings/registry.ts).
 */
import { randomBytes } from 'node:crypto'
import { supabase } from '@/lib/supabase'

type Who = { role?: string | null; is_active?: boolean | null; acting_assistant?: unknown } | null | undefined

export function canEditCompanySettings(member: Who): boolean {
  if (!member || member.acting_assistant || member.is_active === false) return false
  return member.role === 'owner' || member.role === 'admin'
}

export const LOGO_URL_RE = /^https:\/\/[^\s]+$/i

/** '' clears it. Returns the cleaned value or an error. Pure. */
export function checkLogoUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const url = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim()
  if (url.length > 2000) return { ok: false, error: 'That link is too long.' }
  if (url && !LOGO_URL_RE.test(url)) return { ok: false, error: 'The logo must be an https:// link to an image.' }
  return { ok: true, url }
}

export async function saveCompanyLogo(tenantId: string, member: Who, raw: unknown): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (!canEditCompanySettings(member)) return { ok: false, error: 'Only the owner or an admin can change the company logo.' }
  const c = checkLogoUrl(raw)
  if (!c.ok) return c
  const { data, error: readErr } = await supabase.from('reps').select('settings').eq('id', tenantId).maybeSingle()
  if (readErr) return { ok: false, error: 'Could not save. Try again.' }
  const settings = (((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}) as Record<string, unknown>
  const cxo = { ...((settings.cxo as Record<string, unknown> | undefined) ?? {}), logo_url: c.url || null }
  const { error } = await supabase.from('reps').update({ settings: { ...settings, cxo } }).eq('id', tenantId)
  if (error) return { ok: false, error: 'Could not save. Try again.' }
  return { ok: true, url: c.url || null }
}

export function readCompanyLogo(settings: unknown): string | null {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
  const cxo = (s.cxo && typeof s.cxo === 'object' ? s.cxo : {}) as Record<string, unknown>
  return typeof cxo.logo_url === 'string' && cxo.logo_url ? cxo.logo_url : null
}

/**
 * Make a new private inbox link (reps.integrations.plaud_webhook_secret). The
 * old link stops working. The secret is never returned: the person copies the
 * new link from the Integrations page.
 */
export async function rotateWisprLink(tenantId: string, member: Who): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canEditCompanySettings(member)) return { ok: false, error: 'Only the owner or an admin can make a new inbox link.' }
  const { data, error: readErr } = await supabase.from('reps').select('integrations').eq('id', tenantId).maybeSingle()
  if (readErr) return { ok: false, error: 'Could not save. Try again.' }
  const integrations = (((data as { integrations?: Record<string, unknown> | null } | null)?.integrations) ?? {}) as Record<string, unknown>
  const next = { ...integrations, plaud_webhook_secret: randomBytes(18).toString('base64url') }
  const { error } = await supabase.from('reps').update({ integrations: next }).eq('id', tenantId)
  if (error) return { ok: false, error: 'Could not save. Try again.' }
  return { ok: true }
}
