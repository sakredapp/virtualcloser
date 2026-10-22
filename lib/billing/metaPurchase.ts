// Suite CXO's own ads -> a real Whop payment -> Meta Conversions API Purchase
// (2026-10-22, the CXO twin of crmbuilds api/_lib/whop-purchase-attribution.ts).
//
// OFF UNTIL CONFIGURED. Reads CXO_META_PIXEL_ID and CXO_META_CAPI_TOKEN from
// Vercel env (the token lives ONLY there). With either missing this does
// nothing and never errors: when we start running Suite CXO ads, setting the
// env turns it on with no code change (Jace 2026-10-22).
//
// WHICH PAYMENTS. The first purchase only: the build fee, or the first paid
// seat subscription. Renewals and one-off charges are not an ad's Purchase.
//
// DEDUPE / IDEMPOTENT. event_id is `cxo-pur-<Whop payment id>`. Meta keeps one
// event per (event_name, event_id), so a Whop retry that re-runs the webhook
// cannot double count; the webhook's own webhook-id table stops reprocessing
// after a success.
//
// PRIVACY. Email and phone are SHA-256 hashed before they leave. It sends ONLY
// when the checkout metadata says the buyer's browser was checked and sent no
// Global Privacy Control (ad_gpc = "0"); a missing signal sends nothing.
// custom_data is currency + value only. Never throws: a conversion never fails
// a payment webhook.

import { createHash } from 'node:crypto'

type Env = Record<string, string | undefined>
type Obj = Record<string, unknown>

const GRAPH = 'https://graph.facebook.com/v21.0'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const s = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  return t ? t : null
}
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

export const CXO_PIXEL_ENV = 'CXO_META_PIXEL_ID'
export const CXO_CAPI_TOKEN_ENV = 'CXO_META_CAPI_TOKEN'

export const cxoPurchaseEventId = (paymentId: string) => `cxo-pur-${paymentId}`

export function hashEmail(v: unknown): string | null {
  const e = s(v)?.toLowerCase()
  return e && e.includes('@') ? sha(e) : null
}

export function hashPhone(v: unknown): string | null {
  let d = (s(v) ?? '').replace(/\D/g, '')
  if (d.length === 10) d = `1${d}`
  return d.length >= 11 && d.length <= 15 ? sha(d) : null
}

const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/
const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{5,25}$/

/** Only an http(s) URL without its query string (UTMs and click ids stay out). */
function pageUrl(v: unknown): string | null {
  const t = s(v)
  if (!t) return null
  try {
    const u = new URL(t)
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}${u.pathname}`.slice(0, 500) : null
  } catch {
    return null
  }
}

export type CxoPurchaseOutcome = 'sent' | 'no_pixel' | 'no_payment' | 'gpc' | 'failed'

/** The Meta event for one paid Whop payment (exported for tests). */
export function cxoPurchaseEvent(data: Obj, valueCents: number | null, now: () => number = Date.now): Obj | null {
  const paymentId = s(data.id)
  if (!paymentId) return null
  const md = o(data.metadata)
  const user = o(data.user)
  const em = hashEmail(user.email ?? data.email)
  const ph = hashPhone(user.phone ?? data.phone)
  const fbc = s(md.ad_fbc)
  const fbp = s(md.ad_fbp)
  const userData: Obj = {}
  if (em) userData.em = [em]
  if (ph) userData.ph = [ph]
  if (fbc && FBC_RE.test(fbc)) userData.fbc = fbc
  if (fbp && FBP_RE.test(fbp)) userData.fbp = fbp
  const ua = s(md.ad_ua)
  if (ua) userData.client_user_agent = ua.slice(0, 500)
  const url = pageUrl(md.ad_url)
  return {
    event_name: 'Purchase',
    event_time: Math.floor(now() / 1000),
    event_id: cxoPurchaseEventId(paymentId),
    action_source: 'website',
    ...(url ? { event_source_url: url } : {}),
    user_data: userData,
    custom_data: { currency: 'USD', value: valueCents && valueCents > 0 ? valueCents / 100 : 0 },
  }
}

/**
 * Send the server-side Purchase for a first CXO payment. Never throws.
 * `fetchImpl` is injectable for tests.
 */
export async function sendCxoPurchase(
  data: Obj,
  valueCents: number | null,
  opts: { env?: Env; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<CxoPurchaseOutcome> {
  try {
    const env = opts.env ?? (process.env as Env)
    const pixelId = s(env[CXO_PIXEL_ENV])
    const token = s(env[CXO_CAPI_TOKEN_ENV])
    if (!pixelId || !token) return 'no_pixel'
    // FAIL CLOSED on privacy: send only when the buyer's own browser was checked
    // and carried no Global Privacy Control (metadata ad_gpc === "0"). Missing,
    // "1" or anything else sends nothing. Today no CXO checkout stamps ad_gpc
    // (the build-fee link is made by an admin, server-side), so this stays off
    // until a buyer-facing checkout route captures it (compliance 2026-10-22).
    if (String(o(data.metadata).ad_gpc ?? '') !== '0') return 'gpc'
    const event = cxoPurchaseEvent(data, valueCents, opts.now)
    if (!event) return 'no_payment'
    const f = opts.fetchImpl ?? fetch
    // The token rides in the body, never the URL (URLs end up in logs).
    const testCode = s(env.CXO_META_TEST_EVENT_CODE)
    const res = await f(`${GRAPH}/${encodeURIComponent(pixelId)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: token, ...(testCode ? { test_event_code: testCode } : {}) }),
      // A hung Meta call must not push the webhook past Whop's timeout.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.error(`[cxo-meta-purchase] Meta answered ${res.status} for ${String(event.event_id)}`)
      return 'failed'
    }
    return 'sent'
  } catch (e) {
    console.error(`[cxo-meta-purchase] could not send: ${e instanceof Error ? e.message : e}`)
    return 'failed'
  }
}
