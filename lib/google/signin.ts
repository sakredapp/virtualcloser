/**
 * Sign in with Google (owner 2026-10-17). Only for a company that saved its
 * OWN Google OAuth client (reps.settings.google_oauth, docs/GOOGLE_OAUTH_TENANT.md);
 * today that is Pinnacle. One click signs the person in AND connects their
 * Google (same scopes and storage as the Connect Google button).
 *
 * Flow:
 *   1. /api/google/signin (on the brand apex) mints a nonce, keeps it in a
 *      short-lived httpOnly cookie scoped to the callback path, and sends the
 *      browser to Google with a SIGNED state: { tenant, login host, next, nonce, exp }.
 *   2. Google returns to the one registered callback,
 *      /api/google/oauth/callback. A state starting with `gsi.` is this flow.
 *      The callback checks the signature, the expiry and that the nonce equals
 *      the cookie (so nobody can finish a sign-in started in another browser),
 *      exchanges the code with the company's own client, reads the id_token
 *      (aud = that client, email_verified = true), and matches the email to an
 *      ACTIVE member of THAT company, exact and case-insensitive. Accounts are
 *      never created.
 *   3. Same session cookie as the password login; tokens saved exactly as the
 *      connect flow saves them (which also clears a "needs reconnect" flag).
 *
 * Everything here is pure (no database, no Next imports) and tested in
 * __tests__/cxo/googleSignIn.spec.ts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** A state value that starts with this is a sign-in, not a connect. */
export const SIGNIN_STATE_PREFIX = 'gsi.'
/** How long the person has to finish at Google. */
export const SIGNIN_TTL_MS = 10 * 60 * 1000
/** httpOnly cookie that binds the state to the browser that started it. */
export const SIGNIN_NONCE_COOKIE = 'cx_gsi'
/** The cookie is only ever sent to the callback. */
export const SIGNIN_COOKIE_PATH = '/api/google/oauth/callback'

export type SignInState = {
  v: 1
  /** reps.id of the company being signed in to. */
  repId: string
  /** Host the login page was on (e.g. suitecxo.com or mike.suitecxo.com): errors go back there. */
  loginHost: string
  /** Where to land afterwards (already checked to be one of our https hosts), or ''. */
  next: string
  nonce: string
  exp: number
}

const HOST_RE = /^[a-z0-9.-]+$/i

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function mac(secret: string, payload: string): string {
  // Domain-separated from session cookies, which sign with the same secret.
  return b64url(createHmac('sha256', secret).update(`google-signin-v1:${payload}`).digest())
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signSignInState(
  input: { repId: string; loginHost: string; next?: string; nonce: string },
  opts: { secret: string; now?: number },
): string {
  const state: SignInState = {
    v: 1,
    repId: input.repId,
    loginHost: input.loginHost.toLowerCase(),
    next: input.next ?? '',
    nonce: input.nonce,
    exp: (opts.now ?? Date.now()) + SIGNIN_TTL_MS,
  }
  const payload = b64url(Buffer.from(JSON.stringify(state), 'utf8'))
  return `${SIGNIN_STATE_PREFIX}${payload}.${mac(opts.secret, payload)}`
}

export type SignInStateCheck =
  | { ok: true; state: SignInState }
  | { ok: false; reason: 'not_signin' | 'bad_signature' | 'malformed' | 'expired' | 'nonce_mismatch' }

/**
 * Checks a returned state: our signature, not expired, and its nonce equals
 * the one in this browser's cookie. Any failure → no sign-in.
 */
export function verifySignInState(
  raw: string | null | undefined,
  opts: { secret: string; cookieNonce: string | null | undefined; now?: number },
): SignInStateCheck {
  const s = String(raw ?? '')
  if (!s.startsWith(SIGNIN_STATE_PREFIX)) return { ok: false, reason: 'not_signin' }
  const body = s.slice(SIGNIN_STATE_PREFIX.length)
  const dot = body.indexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const payload = body.slice(0, dot)
  const sig = body.slice(dot + 1)
  if (!safeEqual(sig, mac(opts.secret, payload))) return { ok: false, reason: 'bad_signature' }
  let parsed: SignInState
  try {
    parsed = JSON.parse(fromB64url(payload).toString('utf8')) as SignInState
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (
    !parsed ||
    parsed.v !== 1 ||
    typeof parsed.repId !== 'string' ||
    !parsed.repId ||
    typeof parsed.loginHost !== 'string' ||
    !HOST_RE.test(parsed.loginHost) ||
    typeof parsed.next !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    parsed.nonce.length < 16 ||
    typeof parsed.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' }
  }
  const now = opts.now ?? Date.now()
  if (parsed.exp < now || parsed.exp > now + SIGNIN_TTL_MS + 60_000) return { ok: false, reason: 'expired' }
  if (!opts.cookieNonce || !safeEqual(parsed.nonce, opts.cookieNonce)) return { ok: false, reason: 'nonce_mismatch' }
  return { ok: true, state: parsed }
}

/**
 * A `next` URL we may land on after sign-in: https, on one of our brand roots
 * (the same open-redirect guard as the password login). Anything else → ''.
 */
export function safeNextUrl(next: string | null | undefined, roots: string[]): string {
  if (!next) return ''
  try {
    const u = new URL(next)
    if (u.protocol !== 'https:') return ''
    const h = u.hostname.toLowerCase()
    return roots.some((r) => h === r || h.endsWith(`.${r}`)) ? u.toString() : ''
  } catch {
    return ''
  }
}

/** A login host we may send someone back to: one of our brand roots or a subdomain of it. */
export function safeLoginHost(host: string | null | undefined, roots: string[]): string | null {
  const h = String(host ?? '').split(':')[0].toLowerCase()
  if (!h || !HOST_RE.test(h)) return null
  return roots.some((r) => h === r || h.endsWith(`.${r}`)) ? h : null
}

// ── The id_token Google returns from the token endpoint ────────────────────
//
// It comes straight from Google over TLS in the code exchange (not from the
// browser), so per OpenID Connect Core 3.1.3.7 the signature check may be
// skipped; issuer, audience and expiry are still checked.

export type GoogleIdClaims = {
  iss?: string
  aud?: string
  exp?: number
  email?: string
  email_verified?: boolean | string
  sub?: string
}

export function readIdTokenClaims(idToken: string | null | undefined): GoogleIdClaims | null {
  if (!idToken) return null
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const json = JSON.parse(fromB64url(parts[1]).toString('utf8')) as unknown
    return json && typeof json === 'object' ? (json as GoogleIdClaims) : null
  } catch {
    return null
  }
}

export type IdTokenCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'no_token' | 'bad_issuer' | 'bad_audience' | 'expired' | 'no_email' | 'unverified' }

export function checkIdToken(claims: GoogleIdClaims | null, opts: { clientId: string; now?: number }): IdTokenCheck {
  if (!claims) return { ok: false, reason: 'no_token' }
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return { ok: false, reason: 'bad_issuer' }
  if (!claims.aud || claims.aud !== opts.clientId) return { ok: false, reason: 'bad_audience' }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000)
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - 60) return { ok: false, reason: 'expired' }
  const email = String(claims.email ?? '').trim().toLowerCase()
  if (!email) return { ok: false, reason: 'no_email' }
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'unverified' }
  return { ok: true, email }
}

// ── Which member is signing in ─────────────────────────────────────────────

export type SignInMemberRow = {
  id: string
  rep_id: string
  email: string | null
  is_active: boolean
  role?: string | null
}

/**
 * The ACTIVE member of THIS company whose email is exactly the Google email
 * (case-insensitive). The database lookup uses ilike, where `_` and `%` are
 * wildcards, so the exact match is made here. Another company's member with
 * the same email never matches.
 */
export function pickSignInMember<T extends SignInMemberRow>(rows: T[], repId: string, email: string): T | null {
  const want = email.trim().toLowerCase()
  if (!want) return null
  return rows.find((m) => m.rep_id === repId && m.is_active && String(m.email ?? '').trim().toLowerCase() === want) ?? null
}

/**
 * Where a person's Google tokens are stored, the same rule as the connect
 * callback: on the enterprise tier every member has their own row; otherwise
 * the OWNER's connection is the tenant-level row (member_id null), which the
 * background jobs read, and everyone else has their own.
 */
export function googleTokenSlot(tier: string | null | undefined, member: { id: string; role?: string | null } | null): string | null {
  if (!member) return null
  if (tier === 'enterprise') return member.id
  return member.role === 'owner' ? null : member.id
}

/**
 * A member who was emailed a starting password and signs in with Google for
 * their very first login: Google proved who they are, so the emailed
 * password is retired (cleared), not kept live forever. They go straight to
 * their dashboard and can set a password later (Forgot password, or
 * /set-password while signed in). An exec assistant chose their own password
 * from the invite link, so theirs is never touched.
 */
export function retiresStartingPassword(member: { last_login_at?: string | null; password_hash?: string | null; role?: string | null }): boolean {
  return !member.last_login_at && Boolean(member.password_hash) && member.role !== 'assistant'
}

/** Plain words for the login page, by error code. */
export const SIGNIN_ERRORS: Record<string, string> = {
  google_not_member: "That Google account isn't on this team. Ask your admin to add you.",
  google_unverified: "Google hasn't verified that account's email address, so it can't be used to sign in.",
  google_expired: 'That sign-in took too long or started in another browser. Try again.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_unavailable: "Google sign-in isn't set up for this team. Use your email and password.",
  google_failed: "Google sign-in didn't finish. Try again.",
}
