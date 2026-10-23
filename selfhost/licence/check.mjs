#!/usr/bin/env node
// Boot gate for the app and worker containers on a private server.
//
//   node check.mjs app -- node server.js          (app image CMD)
//   node check.mjs worker -- npx tsx hetzner-worker/index.ts
//   node check.mjs verify                          (print the licence state; exit 0 ok, 3 not)
//
// Valid licence: starts the command with LICENCE_SEATS / LICENCE_CLIENT_ID /
// LICENCE_EXPIRES_AT set, and rechecks every hour. No licence, a changed one,
// another box's, or past expiry: the command is NOT started (or is stopped), the
// reason is logged, and the app port answers a plain 503 page saying so. When a
// valid licence is dropped in, the container exits and Docker restarts it.
// Never calls out to Whop or anything else: the check is offline.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { verifyLicence } from './licence.mjs'

const FILE = process.env.LICENCE_FILE || '/licence/licence.key'
const BOX_ID = process.env.BOX_ID || ''
const RECHECK_MS = parseInt(process.env.LICENCE_RECHECK_MS || '3600000', 10)
const REFUSED_RECHECK_MS = parseInt(process.env.LICENCE_REFUSED_RECHECK_MS || '300000', 10)
const WARN_DAYS = 30

const [mode, sep, ...cmd] = process.argv.slice(2)

function check() {
  let text = ''
  try {
    text = fs.readFileSync(FILE, 'utf8')
  } catch {
    return { ok: false, reason: `no licence file at ${FILE}` }
  }
  return verifyLicence(text, { boxId: BOX_ID })
}

function describe(r) {
  const l = r.licence
  return `${l.client_name} (${l.client_id}), box ${l.box_id}, ${l.seats} seats, good through ${l.expires_at} (${r.daysLeft} days left)`
}

if (mode === 'verify') {
  const r = check()
  if (r.ok) console.log(`[licence] ok: ${describe(r)}`)
  else console.log(`[licence] NOT VALID: ${r.reason}`)
  process.exit(r.ok ? 0 : 3)
}

if (!['app', 'worker'].includes(mode) || sep !== '--' || cmd.length === 0) {
  console.error('usage: check.mjs app|worker -- <command...>  |  check.mjs verify')
  process.exit(2)
}

function refuse(reason) {
  const msg =
    `[licence] REFUSED: ${reason}. Suite CXO will not run on this server until a valid licence is in place. ` +
    `Put the licence from Suite CXO at selfhost/box-licence/licence.key (support@suitecxo.com); it is picked up within 5 minutes.`
  console.error(msg)
  if (mode === 'app') {
    const expired = /expired/.test(reason)
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Suite CXO</title>
<style>body{margin:0;font:16px/1.55 system-ui,-apple-system,sans-serif;background:#f7f4ef;color:#1c1b1a;display:grid;place-items:center;min-height:100vh}main{max-width:520px;padding:32px 24px}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 10px;color:#4a4845}</style></head>
<body><main><h1>${expired ? "This server's Suite CXO licence has expired" : 'This server has no valid Suite CXO licence'}</h1>
<p>Suite CXO is paused on this server. Your company's data is safe and stays on this machine.</p>
<p>Ask your IT contact to renew the licence with Suite CXO at support@suitecxo.com.</p></main></body></html>`
    http
      .createServer((req, res) => {
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-suitecxo-licence': expired ? 'expired' : 'invalid' })
        res.end(page)
      })
      .listen(parseInt(process.env.PORT || '3000', 10), process.env.HOSTNAME || '0.0.0.0')
  }
  // Pick up a renewed licence without anyone restarting the box.
  setInterval(() => {
    const r = check()
    if (r.ok) {
      console.log(`[licence] valid licence found (${describe(r)}); restarting`)
      process.exit(0)
    }
  }, REFUSED_RECHECK_MS)
}

const first = check()
if (!first.ok) {
  refuse(first.reason)
} else {
  const l = first.licence
  console.log(`[licence] ok: ${describe(first)}`)
  if (first.daysLeft <= WARN_DAYS) console.warn(`[licence] renew soon: ${first.daysLeft} days left`)
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, LICENCE_SEATS: String(l.seats), LICENCE_CLIENT_ID: l.client_id, LICENCE_EXPIRES_AT: l.expires_at },
  })
  let refused = false
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig))
  child.on('exit', (code, signal) => {
    if (!refused) process.exit(code ?? (signal ? 1 : 0))
  })
  setInterval(() => {
    const r = check()
    if (r.ok) {
      if (r.daysLeft <= WARN_DAYS) console.warn(`[licence] renew soon: ${r.daysLeft} days left (good through ${r.licence.expires_at})`)
      return
    }
    if (refused) return
    refused = true
    child.kill('SIGTERM')
    setTimeout(() => refuse(r.reason), 3000)
  }, RECHECK_MS)
}
