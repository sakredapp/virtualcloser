/**
 * The Suite CXO store app (native/), as seen from the server.
 *
 * The app's WebView adds NATIVE_UA_MARKER to its user agent (native/
 * capacitor.config.ts, appendUserAgent). That is how a hosted page knows it is
 * being shown inside the app rather than in a browser.
 *
 * Why it matters: Apple (3.1.1) and Google do not allow an app to sell a
 * subscription, or link out to where one is sold, unless it goes through
 * their own purchase system. So inside the app the billing pages, the
 * checkout calls and the public pricing page are closed, and the person sees
 * a plain note with no link and no price. In a browser nothing changes.
 *
 * Pure and edge-safe: no imports. Used by middleware, pages and the tests.
 * A forged marker can only hide billing from the person forging it.
 */
export const NATIVE_UA_MARKER = 'SuiteCXOApp'

/** Where a closed purchase page sends the person inside the app. */
export const NATIVE_PLAN_NOTE_PATH = '/dashboard/settings/plan'

export function isNativeAppUA(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && userAgent.includes(NATIVE_UA_MARKER)
}

function clean(pathname: string | null | undefined): string {
  let p = String(pathname ?? '').split('?')[0].split('#')[0].replace(/\/{2,}/g, '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}
const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`)

/** Pages where a plan is bought, changed or paid for. */
const PURCHASE_PAGES = ['/dashboard/billing', '/admin/billing']
/** Calls that start or change a purchase. The payment provider's own webhook is not one. */
const PURCHASE_APIS = ['/api/billing', '/api/checkout']
const PURCHASE_API_EXEMPT = ['/api/billing/webhook']
/** Public pages that show the price and the buy button. */
const SALES_PAGES = ['/', '/cxo', '/cxo/request-access', '/offer']

export type NativeBlock = 'purchase-page' | 'purchase-api' | 'sales-page' | null

/** What, if anything, the store app may not show at this path. */
export function nativeBlockFor(pathname: string | null | undefined, opts: { gatewayHost: boolean }): NativeBlock {
  const p = clean(pathname)
  if (PURCHASE_PAGES.some((x) => under(p, x))) return 'purchase-page'
  if (PURCHASE_APIS.some((x) => under(p, x)) && !PURCHASE_API_EXEMPT.some((x) => under(p, x))) return 'purchase-api'
  // The marketing site lives on the apex; on a company host "/" is the app.
  if (opts.gatewayHost && SALES_PAGES.includes(p)) return 'sales-page'
  return null
}

/** True for a menu link the store app must not show. */
export function isPurchaseHref(href: string | null | undefined): boolean {
  const p = clean(href)
  return PURCHASE_PAGES.some((x) => under(p, x))
}

type NavTab = { href: string; children?: NavTab[] }

/** The same menu without purchase links, and with no upgrade offers. */
export function stripPurchaseNav<T extends NavTab, N extends { tabs: T[]; lockedAddons: unknown[] }>(nav: N): N {
  const tabs = nav.tabs
    .filter((t) => !isPurchaseHref(t.href))
    .map((t) => (t.children ? { ...t, children: t.children.filter((c) => !isPurchaseHref(c.href)) } : t))
  return { ...nav, tabs, lockedAddons: [] }
}
