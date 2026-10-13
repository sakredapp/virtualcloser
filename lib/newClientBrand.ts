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
import { getBrand, type BrandKey } from '@/lib/brand'
import { rootDomain } from '@/lib/vercel'

/** The options shown on the form, default first. */
export const OPERATOR_BRAND_CHOICES: Array<{ key: BrandKey; label: string }> = [
  { key: 'virtualcloser', label: 'Virtual Closer' },
  { key: 'cxo', label: 'Suite CXO' },
]

/** Read the form's `brand` field. Missing or unknown values are Virtual Closer. */
export function operatorBrand(raw: unknown): BrandKey {
  return raw === 'cxo' ? 'cxo' : 'virtualcloser'
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
