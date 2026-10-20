/**
 * One place that decides who an email is FROM. Every outbound email in this
 * repo goes through `senderFor(brand)` (via `sendEmail` in lib/email.ts).
 *
 * Owner rule 2026-10-20: every email sends from the domain of the brand it
 * belongs to. Suite CXO mail comes from suitecxo.com, never from Virtual
 * Closer, and Virtual Closer mail comes from virtualcloser.com. There is no
 * cross-brand fallback: a misconfigured env var is ignored and the brand's
 * own default is used instead.
 *
 * Env:
 *   CXO_RESEND_FROM      Suite CXO sender, used only if its address is on suitecxo.com
 *   CXO_RESEND_API_KEY   optional; a separate Resend key for Suite CXO (else RESEND_API_KEY)
 *   RESEND_FROM          Virtual Closer sender, used only if its address is on virtualcloser.com
 *   RESEND_API_KEY       Resend key
 */
import { getBrand, type BrandKey } from './brand'

export type Sender = {
  brand: BrandKey
  /** Full RFC 5322 From header, e.g. `Suite CXO <noreply@suitecxo.com>`. */
  from: string
  /** Display name alone. */
  name: string
  /** The bare from address. */
  address: string
  /** Where replies go: the brand's support inbox. */
  replyTo: string
  /** Resend API key env value for this brand (may be undefined when unset). */
  apiKey: string | undefined
  /** Brand root domain, for links in the email. */
  rootDomain: string
}

const DEFAULT_FROM: Record<BrandKey, string> = {
  cxo: 'Suite CXO <noreply@suitecxo.com>',
  virtualcloser: 'Virtual Closer <hello@virtualcloser.com>',
}

/** Pull the address out of `Name <addr>` or a bare `addr`. Lowercased. */
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim().toLowerCase()
}

/** True if the address is on `root` or any subdomain of it. */
export function isOnDomain(address: string, root: string): boolean {
  const domain = address.split('@')[1] ?? ''
  return domain === root || domain.endsWith(`.${root}`)
}

function envFrom(brand: BrandKey): string | undefined {
  const raw = brand === 'cxo' ? process.env.CXO_RESEND_FROM : process.env.RESEND_FROM
  const v = raw?.trim()
  return v ? v : undefined
}

export function senderFor(brand: BrandKey): Sender {
  const b = getBrand(brand)
  const configured = envFrom(b.key)
  // An env value on another brand's domain is ignored, never used.
  const from =
    configured && isOnDomain(addressOf(configured), b.rootDomain) ? configured : DEFAULT_FROM[b.key]
  const address = addressOf(from)
  const apiKey =
    b.key === 'cxo'
      ? process.env.CXO_RESEND_API_KEY || process.env.RESEND_API_KEY
      : process.env.RESEND_API_KEY
  return {
    brand: b.key,
    from,
    name: b.emailFromName,
    address,
    replyTo: b.supportEmail,
    apiKey: apiKey || undefined,
    rootDomain: b.rootDomain,
  }
}
