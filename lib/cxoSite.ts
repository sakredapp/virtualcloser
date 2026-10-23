/**
 * Suite CXO marketing site: the offer numbers and the one buy link.
 *
 * Pricing (owner 2026-10-10): one price per person, execs and employees
 * alike; each person adds questions to ONE shared company pool; extra
 * questions bill per 100; exec assistants are free. No setup fees listed.
 *
 * Checkout: payments run on Suite CXO's own Whop business. The buy button
 * reads ONE value, CXO_WHOP_PLAN_ID (live: plan_KEayyFwJhavJH). Without it
 * the site shows "Book a call" (the existing request form) instead.
 */

export const CXO_PRICE_PER_PERSON = 60
export const CXO_QUESTIONS_PER_PERSON = 500
export const CXO_OVERAGE_PRICE = 10
export const CXO_OVERAGE_BLOCK = 100

/** The existing contact route: saves a request for the team, sends nothing. */
export const CXO_BOOK_CALL_HREF = '/cxo/request-access'

const PLAN_ID_RE = /^plan_[A-Za-z0-9]{4,64}$/

/** Whop checkout link for the Suite CXO plan, or null while no plan is set. */
export function cxoCheckoutUrl(planId: string | null | undefined = process.env.CXO_WHOP_PLAN_ID): string | null {
  const id = (planId ?? '').trim()
  if (!PLAN_ID_RE.test(id)) return null
  return `https://whop.com/checkout/${id}`
}

export type CxoQuote = { people: number; monthly: number; pool: number }

/** Monthly price and shared question pool for a team of `people`. */
export function cxoQuote(people: number): CxoQuote {
  const n = Number.isFinite(people) ? Math.max(1, Math.floor(people)) : 1
  return { people: n, monthly: n * CXO_PRICE_PER_PERSON, pool: n * CXO_QUESTIONS_PER_PERSON }
}


/**
 * Private server sizing calculator (/cxo/sizing): OUR fees per box size.
 *
 * Owner approved these build and care fees on 2026-10-20 (vault job
 * "Size a Private Server"). Owner go 2026-10-22: the private build is sold as
 * the second way to buy, delivered once the self-hosted package passes QA. The
 * page only quotes and ends in "Book a call"; it takes no orders.
 *
 * Keys are the box sizes in lib/cxoSizing.ts. Hardware, rent and power are
 * NOT here: they are pass-through costs kept with their sources in that file.
 */
export const CXO_PRIVATE_BUILD_FEE = {
  rented: 20_000,
  'office-small': 15_000,
  office: 30_000,
  team: 50_000,
  company: 90_000,
} as const

/** Monthly care plan per box (updates, monitoring, fixes). Owner approved 2026-10-20. */
export const CXO_PRIVATE_CARE_FEE = {
  rented: 1_500,
  'office-small': 500,
  office: 750,
  team: 1_500,
  company: 3_000,
} as const
