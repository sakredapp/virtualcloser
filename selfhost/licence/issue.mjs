#!/usr/bin/env node
// Issue a Suite CXO private-server licence (Suite CXO staff only).
//
//   node selfhost/licence/issue.mjs --client-id acme --client-name "Acme Corp" \
//     --box-id acme-01 --seats 25 --expires 2027-10-31 [--out licence.key]
//
// The private key is read from SUITECXO_LICENCE_SIGNING_KEY (the PEM text) or
// --key <path to a PEM file>. It never lives in git. Where it is kept: the GitHub
// Actions secret SUITECXO_LICENCE_SIGNING_KEY on sakredapp/virtualcloser (the
// "Issue a private-server licence" workflow runs this script), plus the backup
// listed in the vault note Secrets & Access. The result is one line; it goes on
// the box at selfhost/box-licence/licence.key.
import fs from 'node:fs'
import { signLicence, verifyLicence } from './licence.mjs'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

const keyPath = arg('key')
const key = keyPath ? fs.readFileSync(keyPath, 'utf8') : process.env.SUITECXO_LICENCE_SIGNING_KEY
if (!key || !key.includes('PRIVATE KEY')) {
  console.error('issue.mjs: no signing key (set SUITECXO_LICENCE_SIGNING_KEY or pass --key <pem>)')
  process.exit(2)
}

const payload = {
  v: 1,
  client_id: arg('client-id'),
  client_name: arg('client-name'),
  box_id: arg('box-id'),
  seats: parseInt(arg('seats') ?? '', 10),
  issued_at: new Date().toISOString(),
  expires_at: arg('expires'),
}

let line
try {
  line = signLicence(payload, key)
} catch (err) {
  console.error(`issue.mjs: ${err.message}`)
  process.exit(2)
}
// Prove the line checks out against the public key every box carries.
const check = verifyLicence(line, { boxId: payload.box_id })
if (!check.ok) {
  console.error(`issue.mjs: signed licence does not verify against the shipped public key (${check.reason}); wrong signing key?`)
  process.exit(3)
}

const out = arg('out')
if (out) {
  fs.writeFileSync(out, line + '\n', { mode: 0o644 })
  console.error(`licence for ${payload.client_name}, box ${payload.box_id}, ${payload.seats} seats, good through ${payload.expires_at} -> ${out}`)
} else {
  process.stdout.write(line + '\n')
}
