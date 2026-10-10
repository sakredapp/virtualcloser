/**
 * "Bring your own Google client" (owner 10-10). A company can run Mira's
 * Google connection through an OAuth client created inside ITS OWN Google
 * Workspace (consent screen = Internal), so no Google app verification or
 * CASA assessment is needed on our side. Pinnacle is the first.
 *
 * Storage: reps.settings.google_oauth = { client_id, client_secret_enc,
 * redirect_uri?, updated_at }. The secret is AES-256-GCM encrypted with the
 * app key (lib/google: GOOGLE_TOKEN_KEY, else derived from SESSION_SECRET),
 * never logged and never sent back to a browser. When nothing is set the
 * global env client is used, exactly as before (lib/google resolveOAuthClient).
 *
 * Who may manage it: the workspace owner or an admin on the tenant.
 */
import { supabase } from '@/lib/supabase'
import {
  decryptGoogleSecret,
  defaultTenantRedirectUri,
  encryptGoogleSecret,
  type GoogleOAuthClient,
  type TenantGoogleOAuthSetting,
} from '@/lib/google'

const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token'
const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i
const REDIRECT_RE = /^https:\/\/[a-z0-9.-]+\/api\/google\/oauth\/callback$/i

export const TENANT_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const

type Viewer = { role?: string | null } | null | undefined

/** Owner or admin on the tenant. Employees and observers never see the form. */
export function canManageGoogleClient(member: Viewer): boolean {
  const r = String(member?.role ?? '')
  return r === 'owner' || r === 'admin'
}

/** "123456789012-abc…ent.com": enough to recognise, never the whole id. */
export function maskClientId(id: string | null | undefined): string | null {
  const s = (id ?? '').trim()
  if (!s) return null
  if (s.length <= 18) return `${s.slice(0, 4)}…`
  return `${s.slice(0, 12)}…${s.slice(-10)}`
}

export type TenantGoogleClientView = {
  /** true when a complete client of their own is saved */
  own: boolean
  clientIdMasked: string | null
  /** the callback they must register in Google Cloud */
  redirectUri: string
  updatedAt: string | null
  /** the secret is saved but cannot be decrypted (app key changed) */
  secretUnreadable: boolean
}

/** What the browser may see. No secret, ever. */
export function tenantGoogleClientView(setting: TenantGoogleOAuthSetting | null | undefined, rootDomain: string): TenantGoogleClientView {
  const id = (setting?.client_id ?? '').trim()
  const hasEnc = Boolean(setting?.client_secret_enc)
  const secret = hasEnc ? decryptGoogleSecret(setting?.client_secret_enc) : null
  return {
    own: Boolean(id && secret),
    clientIdMasked: maskClientId(id),
    redirectUri: (setting?.redirect_uri ?? '').trim() || defaultTenantRedirectUri(rootDomain),
    updatedAt: setting?.updated_at ?? null,
    secretUnreadable: Boolean(id && hasEnc && !secret),
  }
}

export type TenantGoogleClientInput = { clientId?: string; clientSecret?: string; redirectUri?: string }

/** Field-level validation. Empty client id / secret keep what is saved (on an update). */
export function validateTenantGoogleClient(input: TenantGoogleClientInput, existing: TenantGoogleOAuthSetting | null | undefined): { ok: true; next: TenantGoogleOAuthSetting } | { ok: false; error: string } {
  const clientId = (input.clientId ?? '').trim()
  const secret = (input.clientSecret ?? '').trim()
  const redirectUri = (input.redirectUri ?? '').trim()
  if (clientId && !CLIENT_ID_RE.test(clientId)) return { ok: false, error: 'The client ID should look like 123456789012-abc123.apps.googleusercontent.com.' }
  if (secret && !/^[A-Za-z0-9_\-]{10,200}$/.test(secret)) return { ok: false, error: 'That does not look like a Google client secret.' }
  if (redirectUri && !REDIRECT_RE.test(redirectUri)) return { ok: false, error: 'The redirect URI must be https://<your app host>/api/google/oauth/callback.' }
  const next: TenantGoogleOAuthSetting = { ...(existing ?? {}), updated_at: new Date().toISOString() }
  if (clientId) next.client_id = clientId
  if (secret) {
    const enc = encryptGoogleSecret(secret)
    if (!enc) return { ok: false, error: 'The app has no encryption key configured, so the secret cannot be stored safely. Nothing was saved.' }
    next.client_secret_enc = enc
  }
  if (redirectUri) next.redirect_uri = redirectUri
  else delete next.redirect_uri
  if (!next.client_id) return { ok: false, error: 'Enter the client ID.' }
  if (!next.client_secret_enc) return { ok: false, error: 'Enter the client secret.' }
  return { ok: true, next }
}

async function loadSettings(repId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from('reps').select('settings').eq('id', repId).maybeSingle()
  return { ...(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}) }
}

export async function getTenantGoogleClientSetting(repId: string): Promise<TenantGoogleOAuthSetting | null> {
  const s = await loadSettings(repId)
  return (s.google_oauth ?? null) as TenantGoogleOAuthSetting | null
}

export async function saveTenantGoogleClient(repId: string, input: TenantGoogleClientInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await loadSettings(repId)
  const v = validateTenantGoogleClient(input, (settings.google_oauth ?? null) as TenantGoogleOAuthSetting | null)
  if (!v.ok) return v
  settings.google_oauth = v.next
  const { error } = await supabase.from('reps').update({ settings }).eq('id', repId)
  if (error) return { ok: false, error: 'Could not save. Try again.' }
  console.log(`[google] tenant client saved rep=${repId} id=${maskClientId(v.next.client_id)}`)
  return { ok: true }
}

export async function clearTenantGoogleClient(repId: string): Promise<void> {
  const settings = await loadSettings(repId)
  if (!('google_oauth' in settings)) return
  delete settings.google_oauth
  const { error } = await supabase.from('reps').update({ settings }).eq('id', repId)
  if (error) throw error
  console.log(`[google] tenant client removed rep=${repId} (back to the global client)`)
}

export type GoogleClientCheck = { ok: boolean; code: string; message: string }

/**
 * Reads Google's answer to a deliberately bad authorization code. Google
 * checks the client credentials BEFORE the code, so:
 *   invalid_client        → the id/secret pair is wrong
 *   invalid_grant / invalid_request ("Malformed auth code") → credentials accepted
 *   redirect_uri_mismatch → credentials fine, callback not registered
 * Pure; unit-tested.
 */
export function classifyGoogleClientCheck(status: number, body: { error?: string; error_description?: string } | null): GoogleClientCheck {
  const err = String(body?.error ?? '')
  if (err === 'invalid_client' || status === 401) return { ok: false, code: 'invalid_client', message: 'Google rejected the client ID or secret. Check both and save again.' }
  if (err === 'redirect_uri_mismatch') return { ok: false, code: 'redirect_uri_mismatch', message: 'The client works but the redirect URI is not registered on it in Google Cloud.' }
  if (err === 'invalid_grant' || err === 'invalid_request') return { ok: true, code: 'ok', message: 'Google accepted the client ID and secret.' }
  if (status >= 500) return { ok: false, code: 'google_unavailable', message: 'Google did not answer. Try again in a minute.' }
  return { ok: false, code: err || `http_${status}`, message: `Unexpected answer from Google (${err || status}).` }
}

/** "Test connection": one request to Google's token endpoint, nothing stored. */
export async function testGoogleClient(client: Pick<GoogleOAuthClient, 'clientId' | 'clientSecret' | 'redirectUri'>): Promise<GoogleClientCheck> {
  const body = new URLSearchParams({
    code: 'suitecxo-connection-test',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: 'authorization_code',
  })
  try {
    const res = await fetch(OAUTH_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(8000) })
    let json: { error?: string; error_description?: string } | null = null
    try { json = (await res.json()) as typeof json } catch { json = null }
    return classifyGoogleClientCheck(res.status, json)
  } catch {
    return { ok: false, code: 'network', message: 'Could not reach Google. Try again in a minute.' }
  }
}
