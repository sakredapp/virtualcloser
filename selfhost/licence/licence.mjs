// Suite CXO private-server licence: format, signing and checking. No imports
// beyond node:crypto, so the boot check (check.mjs), the issuing script
// (issue.mjs) and the tests share one copy.
//
// A licence is one line:  SCXO1.<base64url(JSON payload)>.<base64url(ed25519 signature)>
// signed over the text "SCXO1.<payload part>". Payload:
//   { v: 1, client_id, client_name, box_id, seats, issued_at, expires_at }
// expires_at is a date (YYYY-MM-DD); the licence is good through the end of that
// day (UTC). Only Suite CXO holds the private key (GitHub secret
// SUITECXO_LICENCE_SIGNING_KEY on sakredapp/virtualcloser; workflow
// issue-licence.yml). The box carries only the public key below.
import crypto from 'node:crypto'

export const PREFIX = 'SCXO1'

// Suite CXO licence public key (ed25519). Replacing it invalidates every
// licence in the field, so rotate only with re-issued licences ready.
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXfjzOntOg0OiSm9dlbZJuYT66MRKcp4+KBNEciB75kQ=
-----END PUBLIC KEY-----
`

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Check the fields of a payload; returns an error string or null. */
export function payloadError(p) {
  if (!p || typeof p !== 'object') return 'payload is not an object'
  if (p.v !== 1) return 'unknown licence version'
  for (const k of ['client_id', 'client_name', 'box_id']) {
    if (typeof p[k] !== 'string' || !p[k].trim()) return `${k} missing`
  }
  if (!Number.isInteger(p.seats) || p.seats < 1) return 'seats must be a whole number of at least 1'
  if (typeof p.expires_at !== 'string' || !DATE.test(p.expires_at)) return 'expires_at must be YYYY-MM-DD'
  if (typeof p.issued_at !== 'string' || Number.isNaN(Date.parse(p.issued_at))) return 'issued_at missing'
  return null
}

/** Sign a payload with our private key (PEM, pkcs8). Returns the licence line. */
export function signLicence(payload, privateKeyPem) {
  const err = payloadError(payload)
  if (err) throw new Error(`licence: ${err}`)
  const body = `${PREFIX}.${b64u(JSON.stringify(payload))}`
  const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(privateKeyPem))
  return `${body}.${b64u(sig)}`
}

/** Last valid moment of a licence: the end of its expires_at day, UTC. */
export function expiresAtMs(p) {
  return Date.parse(`${p.expires_at}T23:59:59.999Z`)
}

/**
 * Check a licence line. Returns
 *   { ok: true, licence, daysLeft }  or  { ok: false, reason, licence? }
 * `boxId` (the box's BOX_ID) must match the licence's box_id.
 */
export function verifyLicence(text, { boxId, now = Date.now(), publicKeyPem = PUBLIC_KEY_PEM } = {}) {
  const line = String(text ?? '').trim()
  if (!line) return { ok: false, reason: 'no licence file' }
  const parts = line.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'not a Suite CXO licence' }
  let good = false
  try {
    good = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey(publicKeyPem), Buffer.from(parts[2], 'base64url'))
  } catch {
    good = false
  }
  if (!good) return { ok: false, reason: 'signature does not match (licence was changed or not issued by Suite CXO)' }
  let licence
  try {
    licence = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'licence payload unreadable' }
  }
  const err = payloadError(licence)
  if (err) return { ok: false, reason: err, licence }
  if (boxId && licence.box_id !== boxId) {
    return { ok: false, reason: `licence is for box ${licence.box_id}, this box is ${boxId}`, licence }
  }
  const end = expiresAtMs(licence)
  if (now > end) return { ok: false, reason: `licence expired on ${licence.expires_at}`, licence, expired: true }
  return { ok: true, licence, daysLeft: Math.floor((end - now) / 86_400_000) }
}
