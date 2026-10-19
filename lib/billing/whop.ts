/**
 * WHOP: the one payment rail for Suite CXO (owner ruling 2026-10-19: everything
 * bills on Whop, Stripe is not used anywhere).
 *
 * Plain fetch against Whop's v1 REST API, the same shape crmbuilds uses
 * (api/_lib/whop.ts there): a handful of endpoints and one signature check do
 * not justify the SDK.
 *
 * What lives on Whop (the Virtual Closer business, biz_wFhgXh7j1hS0BI):
 *   product "Suite CXO"          prod_3VrVQnPFhmgHT, hidden
 *   plan    "Suite CXO seat"     CXO_WHOP_PLAN_ID (plan_joiPWFNiBNGDd), hidden,
 *                                $60 every 30 days, no setup charge
 *
 * Every checkout we make carries metadata `{ kind, rep_id }`. Whop copies it
 * onto the payment and the membership, and app/api/webhooks/whop/route.ts finds
 * the Suite CXO company by it. The browser finishing checkout is never the
 * activation; the webhook is.
 *
 * Env (server only):
 *   WHOP_API_KEY         a company API key of that business (Whop dashboard,
 *                        Developer > API keys). Sensitive.
 *   WHOP_WEBHOOK_SECRET  the secret of the webhook pointed at
 *                        https://www.suitecxo.com/api/webhooks/whop. Sensitive.
 *   CXO_WHOP_PLAN_ID     the $60 seat plan. Not a secret.
 *   WHOP_ACCOUNT_ID      optional, defaults to the business above.
 *   CXO_WHOP_PRODUCT_ID  optional, defaults to the product above.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getBrand } from '@/lib/brand'
import { CXO_PRICE_PER_PERSON } from '@/lib/cxoSite'

const WHOP_API = 'https://api.whop.com/api/v1'
/** Pinned so a Whop-side default change cannot reshape the payloads we read. */
export const WHOP_API_VERSION_DATE = '2026-09-11'

const DEFAULT_WHOP_ACCOUNT_ID = 'biz_wFhgXh7j1hS0BI'
const DEFAULT_CXO_WHOP_PRODUCT_ID = 'prod_3VrVQnPFhmgHT'

/** The metadata `kind` values our checkouts carry. */
export const CXO_WHOP_KINDS = {
  /** The monthly seat subscription. */
  subscription: 'cxo_subscription',
  /** The one-time build fee behind a sign-and-pay onboarding link. */
  buildFee: 'cxo_build_fee',
  /** Any other one-time charge an admin sends (a setup fee, an invoice). */
  charge: 'cxo_charge',
} as const
export type CxoWhopKind = (typeof CXO_WHOP_KINDS)[keyof typeof CXO_WHOP_KINDS]

export function whopAccountId(): string {
  return process.env.WHOP_ACCOUNT_ID || DEFAULT_WHOP_ACCOUNT_ID
}

export function cxoWhopProductId(): string {
  return process.env.CXO_WHOP_PRODUCT_ID || DEFAULT_CXO_WHOP_PRODUCT_ID
}

const PLAN_ID_RE = /^plan_[A-Za-z0-9]{4,64}$/

export function cxoWhopPlanId(): string | null {
  const id = (process.env.CXO_WHOP_PLAN_ID ?? '').trim()
  return PLAN_ID_RE.test(id) ? id : null
}

export function isWhopConfigured(): boolean {
  return Boolean(process.env.WHOP_API_KEY)
}

export class WhopApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
  }
}

const PAYMENT_METHODS = { enabled: ['card', 'apple_pay', 'google_pay', 'link'], disabled: [], include_platform_defaults: true }

/** Only these four keys exist on Whop's checkout_styling. */
function checkoutStyling() {
  const t = getBrand('cxo').theme
  return { background_color: t.bg, button_color: t.accent, border_style: 'rounded', font_family: 'system' }
}

/** Whop rejects a plan title past 30 characters with a 400. */
const WHOP_TITLE_MAX = 30
export function whopPlanTitle(title: string): string {
  const t = String(title ?? '').trim()
  return t.length <= WHOP_TITLE_MAX ? t : t.slice(0, WHOP_TITLE_MAX - 1).trimEnd() + '…'
}

async function whopRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const key = process.env.WHOP_API_KEY
  if (!key) throw new WhopApiError(503, 'WHOP_API_KEY is not configured')
  const res = await fetch(`${WHOP_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Api-Version-Date': WHOP_API_VERSION_DATE,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) {
    const p = parsed as { error?: { message?: string }; message?: string } | null
    const msg = p?.error?.message || p?.message || `Whop ${method} /${path} failed (${res.status})`
    throw new WhopApiError(res.status, String(msg), parsed)
  }
  return parsed as T
}

/**
 * Whop money comes in major units: `{ amount: "500.00" }` on the pinned API
 * version, a bare number on older webhook pins. Both become integer cents
 * without a float multiply that can land on 49999.
 */
export function whopMoneyToCents(v: unknown): number | null {
  if (v == null) return null
  const raw = typeof v === 'object' ? (v as { amount?: unknown }).amount : v
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const [whole, frac = ''] = s.replace('-', '').split('.')
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  return s.startsWith('-') ? -cents : cents
}

export type WhopCheckout = { id: string; purchase_url: string; plan?: { id: string } }

function metadataFor(kind: CxoWhopKind, repId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { kind, rep_id: repId, app: 'suitecxo', ...extra }
}

/** Seats are whole people, at least one. */
export function seatCount(v: unknown): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1
}

/** Monthly price in cents for this many seats. */
export function seatMonthlyCents(seats: number): number {
  return seatCount(seats) * CXO_PRICE_PER_PERSON * 100
}

/**
 * The seat subscription checkout for one company. One seat uses the standing
 * plan (CXO_WHOP_PLAN_ID); more seats get a hidden renewal plan at $60 x seats
 * under the Suite CXO product, so the buyer sees one monthly price.
 */
export async function createSeatCheckout(opts: {
  repId: string
  seats: number
  companyName: string
  redirectUrl: string
}): Promise<WhopCheckout> {
  const seats = seatCount(opts.seats)
  const metadata = metadataFor(CXO_WHOP_KINDS.subscription, opts.repId, { seats: String(seats) })
  const planId = cxoWhopPlanId()
  const base = {
    account_id: whopAccountId(),
    mode: 'payment',
    payment_method_configuration: PAYMENT_METHODS,
    checkout_styling: checkoutStyling(),
    redirect_url: opts.redirectUrl,
    metadata,
  }
  if (seats === 1 && planId) return whopRequest('POST', 'checkout_configurations', { ...base, plan_id: planId })
  return whopRequest('POST', 'checkout_configurations', {
    ...base,
    plan: {
      currency: 'usd',
      plan_type: 'renewal',
      billing_period: 30,
      // On Whop initial_price is charged ON TOP of the first renewal, so 0
      // makes the first charge exactly the monthly price.
      initial_price: 0,
      renewal_price: seatMonthlyCents(seats) / 100,
      title: whopPlanTitle(`Suite CXO ${seats} seats`),
      product_id: cxoWhopProductId(),
      visibility: 'hidden',
    },
  })
}

/** A one-time charge (build fee, setup fee, an admin invoice). */
export async function createOneTimeCheckout(opts: {
  repId: string
  kind: typeof CXO_WHOP_KINDS.buildFee | typeof CXO_WHOP_KINDS.charge
  amountCents: number
  title: string
  redirectUrl: string
  metadata?: Record<string, string>
}): Promise<WhopCheckout> {
  const cents = Math.round(Number(opts.amountCents))
  if (!Number.isFinite(cents) || cents < 100) throw new WhopApiError(400, 'A Whop charge is at least $1.00')
  return whopRequest('POST', 'checkout_configurations', {
    account_id: whopAccountId(),
    mode: 'payment',
    plan: {
      currency: 'usd',
      plan_type: 'one_time',
      initial_price: Number((cents / 100).toFixed(2)),
      title: whopPlanTitle(opts.title),
      product_id: cxoWhopProductId(),
      visibility: 'hidden',
    },
    payment_method_configuration: PAYMENT_METHODS,
    checkout_styling: checkoutStyling(),
    redirect_url: opts.redirectUrl,
    metadata: metadataFor(opts.kind, opts.repId, { amount_cents: String(cents), ...(opts.metadata ?? {}) }),
  })
}

export type WhopMembership = {
  id: string
  status?: string | null
  cancel_at_period_end?: boolean | null
  renewal_period_end?: string | null
  plan?: { id?: string | null } | null
  metadata?: Record<string, unknown> | null
}

export function getMembership(membershipId: string): Promise<WhopMembership> {
  return whopRequest('GET', `memberships/${encodeURIComponent(membershipId)}`)
}

/**
 * Stop the subscription: now, or at the end of the paid period. Whop's stable
 * API takes `cancellation_mode`; newer pins take `cancel_at_period_end`. The
 * first is sent, and a 400 on it retries once with the second.
 */
export async function cancelMembership(membershipId: string, atPeriodEnd: boolean): Promise<WhopMembership> {
  const path = `memberships/${encodeURIComponent(membershipId)}/cancel`
  const key = `cxo_cancel_${membershipId}_${atPeriodEnd ? 'period_end' : 'now'}`
  try {
    return await whopRequest('POST', path, { cancellation_mode: atPeriodEnd ? 'at_period_end' : 'immediate' }, key)
  } catch (e) {
    if (!(e instanceof WhopApiError) || e.status !== 400) throw e
    return whopRequest('POST', path, { cancel_at_period_end: atPeriodEnd }, `${key}_v2`)
  }
}

/** Reverse a pending cancel-at-period-end. */
export function uncancelMembership(membershipId: string): Promise<WhopMembership> {
  return whopRequest('PATCH', `memberships/${encodeURIComponent(membershipId)}`, { cancel_at_period_end: false })
}

export function pauseMembership(membershipId: string): Promise<WhopMembership> {
  return whopRequest('POST', `memberships/${encodeURIComponent(membershipId)}/pause`, {}, `cxo_pause_${membershipId}_${Date.now()}`)
}

export function resumeMembership(membershipId: string): Promise<WhopMembership> {
  return whopRequest('POST', `memberships/${encodeURIComponent(membershipId)}/resume`, {}, `cxo_resume_${membershipId}_${Date.now()}`)
}

export type WhopPayment = {
  id: string
  status?: string | null
  total?: unknown
  usd_total?: unknown
  currency?: string | null
  created_at?: string | null
  paid_at?: string | null
  refunded_amount?: unknown
  membership?: { id?: string | null } | null
  plan?: { id?: string | null } | null
  metadata?: Record<string, unknown> | null
}

/** Payments under one membership, newest first. */
export async function listMembershipPayments(membershipId: string, first = 25): Promise<WhopPayment[]> {
  // Stable API: no membership filter, but `query` searches by membership id.
  const q = new URLSearchParams({ account_id: whopAccountId(), query: membershipId, first: String(first), direction: 'desc' })
  const r = await whopRequest<{ data?: WhopPayment[] }>('GET', `payments?${q.toString()}`)
  const rows = Array.isArray(r?.data) ? r.data : []
  return rows.filter((p) => !p.membership?.id || p.membership.id === membershipId)
}

export function getPayment(paymentId: string): Promise<WhopPayment> {
  return whopRequest('GET', `payments/${encodeURIComponent(paymentId)}`)
}

/** Refund a payment in full, or `partialCents` of it. */
export function refundPayment(paymentId: string, partialCents?: number | null): Promise<WhopPayment> {
  const body: Record<string, unknown> = {}
  if (partialCents != null && partialCents > 0) body.partial_amount = Number((partialCents / 100).toFixed(2))
  return whopRequest(
    'POST',
    `payments/${encodeURIComponent(paymentId)}/refund`,
    body,
    `cxo_refund_${paymentId}_${partialCents ?? 'full'}`,
  )
}

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

/**
 * Standard Webhooks signature check, as Whop sends it: HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${body}`, keyed with the secret's
 * LITERAL bytes (prefix included, not base64-decoded), compared in constant
 * time against each `v1,<base64>` in webhook-signature.
 */
export function verifyWhopWebhook(
  rawBody: string,
  header: (name: string) => string | null | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true; id: string } | { ok: false; reason: 'no_secret' | 'missing_headers' | 'stale_timestamp' | 'bad_signature' } {
  if (!secret) return { ok: false, reason: 'no_secret' }
  const id = header('webhook-id')
  const ts = header('webhook-timestamp')
  const sigHeader = header('webhook-signature')
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing_headers' }
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(nowSeconds - tsNum) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' }
  }
  const expected = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${rawBody}`).digest()
  for (const part of sigHeader.split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    const given = Buffer.from(sig, 'base64')
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, id }
  }
  return { ok: false, reason: 'bad_signature' }
}
