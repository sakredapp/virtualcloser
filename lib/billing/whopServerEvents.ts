/**
 * Whop Events API (server side) for Suite CXO: `complete_registration` when a
 * company signs its onboarding link (app/api/onboard/[token]/sign).
 *
 * Why the server and not the pixel: the onboarding page's URL carries the
 * secret onboarding token, and the pixel sends the full page URL with every
 * event, so the pixel never runs there (lib/whopPixel.ts). The server knows the
 * moment the signature lands. The visitor's Whop id (`_wuid` cookie, set by the
 * pixel on www.suitecxo.com) ties it to the ad visit when it is present; the
 * plain-text email and name match it otherwise.
 *
 * Never `purchase`: Whop records its own checkout and would count it twice.
 * Best effort: a Whop error is logged, the signing never waits on it for long
 * and never fails because of it.
 *
 * Docs: docs.whop.com/developer/ads/events-api. The key (WHOP_API_KEY, the
 * Suite CXO business) needs the event:create permission.
 */
import { CXO_SITE_ORIGIN } from '@/lib/seo'
import { CXO_WHOP_PIXEL_ACCOUNT_ID } from '@/lib/whopPixel'

const WHOP_EVENTS_URL = 'https://api.whop.com/api/v1/events'

export type CxoRegistrationInput = {
  repId: string
  email?: string | null
  name?: string | null
  whopVisitorId?: string | null
  ip?: string | null
  userAgent?: string | null
  at?: Date
}

const WUID_RE = /^wuid_[A-Za-z0-9]{4,128}$/

/** The request body. Pure, so the test pins it. The URL never carries the onboarding token. */
export function cxoRegistrationEvent(input: CxoRegistrationInput) {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  const [first, ...rest] = name ? name.split(' ') : []
  const email = (input.email ?? '').trim()
  const wuid = (input.whopVisitorId ?? '').trim()
  const user: Record<string, string> = { external_id: `cxo_rep_${input.repId}` }
  if (email) user.email = email
  if (first) user.first_name = first
  if (rest.length) user.last_name = rest.join(' ')
  if (WUID_RE.test(wuid)) user.anonymous_id = wuid
  const context: Record<string, string> = {}
  if (input.ip) context.ip_address = input.ip
  if (input.userAgent) context.user_agent = input.userAgent.slice(0, 512)
  return {
    account_id: CXO_WHOP_PIXEL_ACCOUNT_ID,
    event_name: 'complete_registration' as const,
    // One registration per company: a retry or a second signer collapses into one.
    event_id: `cxo_reg_${input.repId}`,
    event_time: (input.at ?? new Date()).toISOString(),
    action_source: 'website' as const,
    url: `${CXO_SITE_ORIGIN}/onboard`,
    user,
    ...(Object.keys(context).length ? { context } : {}),
  }
}

/** Read the pixel's visitor id from a Cookie header. */
export function whopVisitorIdFromCookie(cookieHeader: string | null | undefined): string | null {
  const m = (cookieHeader ?? '').match(/(?:^|;\s*)_wuid=([^;]*)/)
  if (!m) return null
  const v = decodeURIComponent(m[1]).trim()
  return WUID_RE.test(v) ? v : null
}

/** Send it. Returns what happened, never throws. */
export async function sendCxoRegistrationEvent(
  input: CxoRegistrationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number; skipped?: string }> {
  const key = process.env.WHOP_API_KEY
  if (!key) return { ok: false, skipped: 'no_key' }
  try {
    const res = await fetchImpl(WHOP_EVENTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cxoRegistrationEvent(input)),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) console.error('[whop events] complete_registration failed', res.status)
    return { ok: res.ok, status: res.status }
  } catch (err) {
    console.error('[whop events] complete_registration error', err instanceof Error ? err.message : 'unknown')
    return { ok: false }
  }
}
