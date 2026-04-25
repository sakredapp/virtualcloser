import { randomBytes } from 'node:crypto'

const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 chars, no 0/O/1/I

/**
 * Crypto-secure 8-char base32-ish code (uppercase, no ambiguous chars).
 * Used for Telegram pairing tokens and similar low-friction secrets.
 */
export function generateLinkCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += LINK_ALPHABET[bytes[i] % LINK_ALPHABET.length]
  return out
}

/** URL-safe nonce, hex. Default 16 chars (8 bytes / 64 bits). */
export function generateNonce(bytes = 8): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * Lowercase a-z0-9- slug derived from arbitrary input (e.g. a name or email).
 * Returns 'member' if the input has no usable characters.
 */
export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
  return cleaned || 'member'
}
