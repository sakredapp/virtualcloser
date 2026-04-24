import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

// Admin auth:
//   - Preferred: ADMIN_PASSWORD_HASH env var = bcrypt hash (generate via
//     `node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'yourpass'`).
//   - Fallback: ADMIN_PASSWORD plaintext (only for first-run convenience).
// The cookie is NOT the password. It's an HMAC-signed token with expiry,
// so leaking the cookie can't reveal the password.

const COOKIE_NAME = 'vc_admin'
const TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Missing SESSION_SECRET (or CRON_SECRET) for admin auth')
  return s
}

function b64u(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  const b = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bytes).toString('base64')
  return b.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(sig)).map((x) => x.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let m = 0
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return m === 0
}

async function signToken(): Promise<string> {
  const exp = Date.now() + TTL_MS
  const payload = `admin.${exp}`
  const body = b64u(new TextEncoder().encode(payload))
  const sig = await hmac(payload)
  return `${body}.${sig}`
}

async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [body, sig] = parts
  let payload: string
  try {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((body.length + 3) % 4)
    const bin = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    payload = new TextDecoder().decode(bytes)
  } catch {
    return false
  }
  const expected = await hmac(payload)
  if (!timingSafeEqual(sig, expected)) return false
  const [prefix, expStr] = payload.split('.')
  if (prefix !== 'admin') return false
  const exp = Number(expStr)
  return Number.isFinite(exp) && exp > Date.now()
}

async function checkPassword(plain: string): Promise<boolean> {
  const hash = process.env.ADMIN_PASSWORD_HASH
  if (hash) {
    try {
      return await bcrypt.compare(plain, hash)
    } catch {
      return false
    }
  }
  // Legacy fallback — accept plaintext env for first-run ease.
  const plaintext = process.env.ADMIN_PASSWORD
  if (plaintext && plain === plaintext) {
    console.warn('[admin-auth] ADMIN_PASSWORD_HASH not set — using plaintext ADMIN_PASSWORD fallback. Rotate to hash ASAP.')
    return true
  }
  return false
}

export async function isAdminAuthed(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  return verifyToken(token)
}

export async function setAdminCookie(password: string): Promise<boolean> {
  const ok = await checkPassword(password)
  if (!ok) return false
  const token = await signToken()
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  })
  return true
}

export async function clearAdminCookie() {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}
