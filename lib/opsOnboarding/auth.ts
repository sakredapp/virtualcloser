/**
 * The shared secret Accounts (crmbuilds, accounts.virtualcloser.com) sends to
 * /api/ops/onboarding*: `Authorization: Bearer <OPS_ONBOARDING_SECRET>`.
 *
 * Fail closed: an unset or short secret denies everyone. Both sides are
 * hashed first, so the compare is constant time and never leaks the length.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** Shorter than this and the env is treated as unset. */
export const OPS_SECRET_MIN_LENGTH = 32

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

export function isOpsAuthorized(authHeader: string | null | undefined, secret: string | undefined = process.env.OPS_ONBOARDING_SECRET): boolean {
  const want = (secret ?? '').trim()
  if (want.length < OPS_SECRET_MIN_LENGTH) return false
  if (!authHeader) return false
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  if (!m) return false
  return timingSafeEqual(digest(m[1].trim()), digest(want))
}
