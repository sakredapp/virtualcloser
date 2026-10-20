/**
 * The one list of pages that exist on Suite CXO hosts (suitecxo.com, a
 * company's own <company>.suitecxo.com, and previews of the suitecxo project).
 *
 * This repo also serves Virtual Closer, and every page file is reachable on
 * every host by typed URL. On a Suite CXO host, middleware sends any page that
 * is NOT listed here to the Suite CXO home, so the dialer, prospects, SMS and
 * the other Virtual Closer pages never show there, and a page added later is
 * closed on Suite CXO until it is added here on purpose (default deny).
 *
 * Virtual Closer hosts never consult this list.
 *
 * Pure and edge-safe: no imports, used by middleware and the tests.
 *
 * Only pages are gated. API routes, Next's own files, static files and the
 * app-link verification files are not pages and pass through untouched.
 */

/** Pages matched exactly. */
export const CXO_PAGES_EXACT = ['/', '/dashboard'] as const

/** Pages matched with everything under them (segment boundary). */
export const CXO_PAGE_PREFIXES = [
  // Public: marketing, demo, legal, sign-in and account setup.
  '/cxo',
  '/login',
  '/logout',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/privacy',
  '/terms',
  '/support',
  '/onboard',
  // Operator console. It has its own password gate and is how companies are
  // set up, so it stays reachable on every host.
  '/admin',

  // The Suite CXO menu (app/dashboard/dashboardTabs.ts, executive preset).
  '/dashboard/inbox',
  '/dashboard/plan',
  '/dashboard/revenue',
  '/dashboard/pinnacle',
  '/dashboard/execs',
  '/dashboard/partners',
  '/dashboard/employees',
  '/dashboard/calendar',
  '/dashboard/meetings',
  '/dashboard/boards',
  '/dashboard/approvals',
  // Phone tab bar and the employee's own page.
  '/dashboard/work',
  '/dashboard/me',
  // Settings rail.
  '/dashboard/settings',
  '/dashboard/integrations',
  // Not /dashboard/billing: that is Virtual Closer's weekly dialer plan
  // (hours per week, dialer add-ons). No Suite CXO screen links to it.
  '/dashboard/assistant',
  // Ciao full screen (the bar's "Full screen" button).
  '/dashboard/ciao',
  // Old addresses that only forward into a page above for a Suite CXO
  // company (analytics -> Team, recordings -> Meetings). They render nothing.
  '/dashboard/analytics',
  '/dashboard/recordings',
  // Not in the menu, kept on purpose:
  // Accounting is a Suite CXO page (it turns every other brand away) over the
  // same commissions and deposits the assistant's payroll tool reads.
  '/dashboard/accounting',
  // Not /dashboard/pipeline, /dashboard/leads or /dashboard/projects: Suite CXO
  // has no sales tools (owner 2026-10-20). Those are Virtual Closer's CRM pages;
  // on a Suite CXO host they go to the Suite CXO home, and Ciao no longer has
  // the lead, pipeline or project tools that linked to them.
] as const

/** Paths that are not pages at all. */
const NON_PAGE_DIRS = ['/api', '/_next', '/brands', '/.well-known'] as const
/** Root files Next serves by name (favicon.ico, robots.txt, sitemap.xml and their variants). */
const NON_PAGE_STARTS = ['/favicon', '/robots', '/sitemap'] as const
const STATIC_FILE = /\.(png|jpe?g|svg|ico|webp|gif|avif|css|js|map|json|xml|woff2?|ttf|otf|txt|webmanifest|pdf|mp3|mp4|webm)$/i

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** Lower case, no query, no doubled or trailing slashes. Null for anything that is not a clean absolute path. */
function normalize(pathname: string | null | undefined): string | null {
  if (!pathname || typeof pathname !== 'string') return null
  let p = pathname.split('?')[0].split('#')[0]
  if (!p.startsWith('/')) return null
  p = p.replace(/\/{2,}/g, '/')
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return null
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p.toLowerCase()
}

/** True for API routes, framework files and static files: never gated. */
export function isNonPagePath(pathname: string | null | undefined): boolean {
  const p = normalize(pathname)
  if (!p) return false
  if (NON_PAGE_DIRS.some((x) => under(p, x))) return true
  if (NON_PAGE_STARTS.some((x) => p.startsWith(x))) return true
  return STATIC_FILE.test(p)
}

/**
 * May this path be served on a Suite CXO host?
 *
 * `hasToken`: /welcome is a Virtual Closer page, but the sign-in link in a
 * welcome email lands on /welcome?token=... and signs the person in. That one
 * use stays open; the bare page does not.
 */
export function cxoPathAllowed(pathname: string | null | undefined, opts: { hasToken?: boolean } = {}): boolean {
  const p = normalize(pathname)
  if (!p) return false
  if (isNonPagePath(p)) return true
  if ((CXO_PAGES_EXACT as readonly string[]).includes(p)) return true
  if (CXO_PAGE_PREFIXES.some((x) => under(p, x))) return true
  if (p === '/welcome' && opts.hasToken) return true
  return false
}

/** Where a closed page sends people: the app on a company host, the site on the apex. */
export function cxoHomeFor(isGatewayHost: boolean): string {
  return isGatewayHost ? '/' : '/dashboard'
}
