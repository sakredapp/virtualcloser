import { timingSafeEqual } from 'node:crypto'

/**
 * Timing-safe check for the `Authorization: Bearer <CRON_SECRET>` header
 * used by Vercel Cron. Returns true if the header matches process.env.CRON_SECRET.
 *
 * If CRON_SECRET is unset, all requests are denied (fail closed).
 */
export function isAuthorizedCron(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (!authHeader) return false
  const expected = `Bearer ${secret}`
  if (authHeader.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  } catch {
    return false
  }
}
