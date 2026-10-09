/**
 * Login-link invites (admin "Send login link"). A member gets a
 * set-your-password link to /reset-password instead of a plaintext password.
 *
 * If the member already holds an unexpired link with at least a day left,
 * that same link is re-sent, so a link emailed earlier keeps working and a
 * second click never silently kills the first email. Otherwise a fresh
 * 64-hex token valid for 7 days is minted.
 */

export const LOGIN_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const LOGIN_LINK_REUSE_MIN_MS = 24 * 60 * 60 * 1000

const HEX64 = /^[0-9a-f]{64}$/

export type LoginLinkToken = { token: string; expiresAt: string; reused: boolean }

export function pickLoginLinkToken(
  existing: { token: string | null; expiresAt: string | null },
  now: number,
  mint: () => string,
): LoginLinkToken {
  const exp = existing.expiresAt ? Date.parse(existing.expiresAt) : NaN
  if (
    existing.token &&
    HEX64.test(existing.token) &&
    Number.isFinite(exp) &&
    exp - now >= LOGIN_LINK_REUSE_MIN_MS
  ) {
    return { token: existing.token, expiresAt: new Date(exp).toISOString(), reused: true }
  }
  return { token: mint(), expiresAt: new Date(now + LOGIN_LINK_TTL_MS).toISOString(), reused: false }
}

export function loginLinkUrl(rootDomain: string, token: string): string {
  return `https://${rootDomain}/reset-password?token=${token}`
}

/** "Oct 16, 2026" (US Eastern), for the email copy. */
export function loginLinkExpiresLabel(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  })
}
