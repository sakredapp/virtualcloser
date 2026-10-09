import { getBrand } from '@/lib/brand'

/**
 * A tenant's onboarding link, on its own brand domain (suitecxo.com for CXO,
 * virtualcloser.com for VC). Never the deployment's ROOT_DOMAIN env.
 */
export function onboardingUrl(brand: string | null | undefined, token: string): string {
  return `https://${getBrand(brand).rootDomain}/onboard/${token}`
}
