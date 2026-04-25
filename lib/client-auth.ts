import { cookies } from 'next/headers'

// Edge-safe + server-component cookie helpers.
// - signSession / verifySession / SESSION_COOKIE_NAME are safe in middleware.
// - set/clear/getSessionSlug use `cookies()` and must only run in server
//   components or server actions (not middleware).
// Password hashing lives in ./client-password (Node runtime only).

const COOKIE_NAME = 'vc_session'
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Missing SESSION_SECRET (or CRON_SECRET) env var')
  return s
}

function getCookieDomain(): string | undefined {
  // In prod we want the cookie on the apex so every subdomain shares it.
  // In local dev (no ROOT_DOMAIN or host=localhost) leave it host-only.
  const root = process.env.ROOT_DOMAIN
  if (!root) return undefined
  return `.${root}`
}

// ── HMAC (Web Crypto — edge-safe) ──────────────────────────────────────────

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i])
  const b64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(u8).toString('base64')
  return b64.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64Url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const binary =
    typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToHex(b: ArrayBuffer): string {
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return bytesToHex(sig)
}

// ── Session tokens ─────────────────────────────────────────────────────────
//
// Payload format (dot-separated, all strings):
//    legacy:  `${slug}.${exp}`              ← still accepted for older cookies
//    current: `${slug}.${exp}.${memberId}`  ← issued going forward
//
// Both are signed identically; verifySession returns the parsed shape.

export type SessionPayload = { slug: string; memberId: string | null; exp: number }

export async function signSession(
  slug: string,
  opts: { memberId?: string | null; ttlMs?: number } = {},
): Promise<string> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const exp = Date.now() + ttlMs
  const payloadRaw = opts.memberId
    ? `${slug}.${exp}.${opts.memberId}`
    : `${slug}.${exp}`
  const payload = toBase64Url(new TextEncoder().encode(payloadRaw))
  const sig = await hmac(payloadRaw)
  return `${payload}.${sig}`
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  let payloadRaw: string
  try {
    payloadRaw = new TextDecoder().decode(fromBase64Url(payload))
  } catch {
    return null
  }
  const expected = await hmac(payloadRaw)
  if (!timingSafeEqual(sig, expected)) return null
  const segments = payloadRaw.split('.')
  if (segments.length < 2 || segments.length > 3) return null
  const slug = segments[0]
  const exp = Number(segments[1])
  const memberId = segments[2] ?? null
  if (!slug || !Number.isFinite(exp) || exp < Date.now()) return null
  return { slug, memberId, exp }
}

// ── Cookie helpers (used in server components + server actions) ────────────

export async function setSessionCookie(slug: string, memberId?: string | null): Promise<void> {
  const token = await signSession(slug, { memberId })
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    domain: getCookieDomain(),
    maxAge: Math.floor(DEFAULT_TTL_MS / 1000),
  })
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    domain: getCookieDomain(),
    maxAge: 0,
  })
}

export async function getSessionSlug(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  const payload = await verifySession(token)
  return payload?.slug ?? null
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  return verifySession(token)
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
