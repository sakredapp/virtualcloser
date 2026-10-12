/**
 * A short pass that lets the store app start "Connect Google" in the phone's
 * own browser.
 *
 * Google refuses to show its sign-in inside an app's WebView, so the app opens
 * the phone's browser for that one step. The browser does not have the app's
 * session cookie, so the app first asks the server (signed in, from the
 * WebView) for this pass and puts it on the link. The pass names the member,
 * lasts ten minutes, and is good for connecting Google and nothing else: it is
 * signed with a different prefix from a session, so it can never be used as a
 * session cookie.
 *
 * It travels in the OAuth `state`, so it uses no ":" or "|" (the separators
 * that state already uses).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireSessionSecret } from '@/lib/client-auth'

const PURPOSE = 'cxo-native-google-connect:v1'
export const NATIVE_TICKET_TTL_MS = 10 * 60 * 1000
// Slugs, hosts and member ids: letters, digits, dash, underscore. Never the separators.
const PART = /^[a-z0-9_-]*$/i

export type NativeTicket = { slug: string; memberId: string | null; home: string; exp: number }

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
function sign(raw: string): string {
  return createHmac('sha256', requireSessionSecret()).update(`${PURPOSE}\n${raw}`).digest('base64url')
}

export function signNativeTicket(input: { slug: string; memberId: string | null; home: string }, now = Date.now()): string {
  const { slug, home } = input
  const memberId = input.memberId ?? ''
  if (!slug || !PART.test(slug) || !PART.test(home) || !PART.test(memberId)) throw new Error('Bad ticket input')
  const raw = [slug, memberId, home || slug, String(now + NATIVE_TICKET_TTL_MS)].join('.')
  return `${b64(raw)}~${sign(raw)}`
}

export function verifyNativeTicket(token: string | null | undefined, now = Date.now()): NativeTicket | null {
  if (!token || typeof token !== 'string' || token.length > 600) return null
  const [payload, sig, extra] = token.split('~')
  if (!payload || !sig || extra !== undefined) return null
  let raw: string
  try {
    raw = Buffer.from(payload, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const want = Buffer.from(sign(raw))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const [slug, memberId, home, expRaw, more] = raw.split('.')
  const exp = Number(expRaw)
  if (more !== undefined || !slug || !home || !Number.isFinite(exp) || exp < now) return null
  if (!PART.test(slug) || !PART.test(home) || !PART.test(memberId ?? '')) return null
  return { slug, memberId: memberId || null, home, exp }
}

/** The ticket carried in an OAuth state (`repId:member:nonce:flag|flag|app=<ticket>`), if any. */
export function ticketFromState(state: string | null | undefined): string | null {
  const flags = String(state ?? '').split(':')[3] ?? ''
  const f = flags.split('|').find((x) => x.startsWith('app='))
  return f ? f.slice(4) : null
}

/** The link that hands the result back to the app: suitecxo://open?company=…&path=… */
export function appReturnLink(home: string, path: string): string {
  const p = new URLSearchParams({ company: home, path })
  return `suitecxo://open?${p.toString()}`
}
