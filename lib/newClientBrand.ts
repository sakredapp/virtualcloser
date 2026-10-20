/**
 * Brand choice on the operator's "Create a client" form (/admin/clients/new).
 *
 * Pure decisions only, so they can be tested without a database, Vercel or a
 * mailbox:
 *   - which brand the form asked for (anything unknown = Virtual Closer, the
 *     same default as the `reps.brand` column, so an untouched form behaves
 *     exactly as it did before the choice existed)
 *   - which address gets attached for the tenant
 *   - which email the owner gets at creation
 */
import { brandFromHost, getBrand, type BrandKey } from '@/lib/brand'
import { rootDomain } from '@/lib/vercel'

/** The options shown on the form, Virtual Closer first. */
export const OPERATOR_BRAND_CHOICES: Array<{ key: BrandKey; label: string }> = [
  { key: 'virtualcloser', label: 'Virtual Closer' },
  { key: 'cxo', label: 'Suite CXO' },
]

/**
 * The brand a new client defaults to on this host: Suite CXO on a Suite CXO
 * host (suitecxo.com and its previews), Virtual Closer everywhere else. An
 * operator creating a client from suitecxo.com never gets a Virtual Closer
 * account by default (owner 2026-10-20).
 */
export function defaultOperatorBrand(host: string | null | undefined): BrandKey {
  return brandFromHost(host).key === 'cxo' ? 'cxo' : 'virtualcloser'
}

/** The form's options for this host, its default first. */
export function operatorBrandChoices(host: string | null | undefined): Array<{ key: BrandKey; label: string }> {
  const first = defaultOperatorBrand(host)
  return [...OPERATOR_BRAND_CHOICES].sort((x, y) => Number(y.key === first) - Number(x.key === first))
}

/**
 * Read the form's `brand` field. Missing or unknown values fall back to
 * `fallback`: Virtual Closer (the `reps.brand` column default) unless the
 * caller passes the host's default from defaultOperatorBrand.
 */
export function operatorBrand(raw: unknown, fallback: BrandKey = 'virtualcloser'): BrandKey {
  if (raw === 'cxo') return 'cxo'
  if (raw === 'virtualcloser') return 'virtualcloser'
  return fallback === 'cxo' ? 'cxo' : 'virtualcloser'
}

/**
 * The tenant address to attach in Vercel.
 * Virtual Closer keeps `<slug>.<ROOT_DOMAIN>` (unchanged). Every other brand
 * uses its own root domain from lib/brand, never the deployment's ROOT_DOMAIN.
 */
export function tenantDomain(slug: string, brand: BrandKey): string {
  if (brand === 'virtualcloser') return `${slug}.${rootDomain()}`
  return `${slug}.${getBrand(brand).rootDomain}`
}

/**
 * Which email the owner gets when the operator leaves "send welcome" ticked.
 *   - `password_welcome`: the original Virtual Closer welcome (unchanged).
 *   - `login_link`: the brand-aware "Your login is ready" email
 *     (lib/loginLinkSend), on the brand's own domain, no password in the email.
 */
export function creationWelcome(brand: BrandKey): 'password_welcome' | 'login_link' {
  return brand === 'virtualcloser' ? 'password_welcome' : 'login_link'
}
