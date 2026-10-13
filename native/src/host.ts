/**
 * Which address the app opens. Pure functions, no imports, so the web repo's
 * test suite can cover them (__tests__/native/host.spec.ts).
 *
 * A customer signs in at <company>.suitecxo.com. The app only ever navigates
 * its WebView to suitecxo.com or a subdomain of it; anything else is refused
 * here and left to the system browser.
 */
export const ROOT_DOMAIN = 'suitecxo.com'
export const URL_SCHEME = 'suitecxo'

/**
 * Local testing only. `CXO_DEV_ORIGIN=http://localhost:3490 npm run sync` bakes
 * a local server's address into the bundle, and the app then opens that server
 * in place of suitecxo.com. A store build is made without it, so this is the
 * empty string there and every function below behaves exactly as documented.
 */
declare const __CXO_DEV_ORIGIN__: string | undefined
const DEV: URL | null = (() => {
  try {
    return typeof __CXO_DEV_ORIGIN__ === 'string' && __CXO_DEV_ORIGIN__ ? new URL(__CXO_DEV_ORIGIN__) : null
  } catch {
    return null
  }
})()
export const DEV_ORIGIN: string | null = DEV ? DEV.origin : null

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const RESERVED = new Set(['www', 'app', 'api', 'mail', 'book', 'portal'])

/** "Pinnacle", "pinnacle.suitecxo.com" or a pasted link → "pinnacle". Null when it is not a company address. */
export function normalizeCompany(input: string | null | undefined): string | null {
  let s = String(input ?? '').trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0].split(':')[0]
  if (s.endsWith(`.${ROOT_DOMAIN}`)) s = s.slice(0, -1 * (ROOT_DOMAIN.length + 1))
  if (s.includes('.')) return null
  if (!SLUG.test(s) || RESERVED.has(s)) return null
  return s
}

/** True for suitecxo.com and any subdomain of it. */
export function isSuiteHost(hostname: string | null | undefined): boolean {
  const h = String(hostname ?? '').toLowerCase()
  if (DEV && h === DEV.hostname) return true
  return h === ROOT_DOMAIN || h.endsWith(`.${ROOT_DOMAIN}`)
}

/** The company part of a customer host, or null on the apex / www. */
export function companyFromHost(hostname: string | null | undefined): string | null {
  const h = String(hostname ?? '').toLowerCase()
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null
  return normalizeCompany(h)
}

/** Where a launch goes: the company's dashboard, or the shared sign-in page when no company is known. */
export function startUrl(company: string | null): string {
  const slug = normalizeCompany(company)
  if (DEV) return `${DEV.origin}${slug ? '/dashboard' : '/login'}`
  return slug ? `https://${slug}.${ROOT_DOMAIN}/dashboard` : `https://${ROOT_DOMAIN}/login`
}

function safePath(p: string | null | undefined): string {
  const path = String(p ?? '')
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/dashboard'
  return path
}

export type DeepLink = { kind: 'open'; url: string } | { kind: 'settings' } | null

/**
 * A link the OS handed the app:
 *   https://<company>.suitecxo.com/...   (universal link / app link)  → opened as is
 *   suitecxo://open?company=pinnacle&path=/dashboard/inbox            → that page
 *   suitecxo://settings                                               → the app's own settings screen
 * Anything else → null (ignored).
 */
export function resolveDeepLink(raw: string | null | undefined): DeepLink {
  let u: URL
  try {
    u = new URL(String(raw ?? ''))
  } catch {
    return null
  }
  if (u.protocol === 'https:' || (DEV && u.origin === DEV.origin)) {
    return isSuiteHost(u.hostname) ? { kind: 'open', url: u.toString() } : null
  }
  if (u.protocol !== `${URL_SCHEME}:`) return null
  // suitecxo://settings parses with host "settings" in browsers; some engines put it in the path.
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase()
  if (action === 'settings') return { kind: 'settings' }
  if (action !== 'open') return null
  if (DEV) return { kind: 'open', url: `${DEV.origin}${safePath(u.searchParams.get('path'))}` }
  const company = normalizeCompany(u.searchParams.get('company'))
  if (!company) return { kind: 'open', url: startUrl(null) }
  return { kind: 'open', url: `https://${company}.${ROOT_DOMAIN}${safePath(u.searchParams.get('path'))}` }
}
