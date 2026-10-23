// Suite CXO box health agent. No dependencies (Node 22 built-ins only).
//
// Every HEALTH_INTERVAL_S seconds it checks the box and keeps the latest
// result. GET /health on port 8099 returns it (200 when every check passes,
// 503 when one fails). When HEALTH_REPORT_URL is set it also POSTs the result
// there (our ops endpoint, app/api/ops/private-server/report), signed with the
// box's licence as the bearer (LICENCE_FILE; HEALTH_REPORT_TOKEN overrides it).
// The outcome of the last post shows as `report` in /health.
// The report carries box status only: no client data, no secrets.
import http from 'node:http'
import fs from 'node:fs/promises'

const env = process.env
const INTERVAL = Number(env.HEALTH_INTERVAL_S || 60) * 1000
const BOX_ID = env.BOX_ID || 'unnamed-box'
const APP = env.HEALTH_APP_URL || 'http://app:3000/login'
const API = env.HEALTH_API_URL || 'http://caddy:8000/rest/v1/'
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const DISK_PATHS = (env.HEALTH_DISK_PATHS || '/').split(',')
const DISK_MIN_FREE_PCT = Number(env.HEALTH_DISK_MIN_FREE_PCT || 15)
const STALE_MIN = Number(env.WORKER_STALE_MINUTES || 10)
const LICENCE_FILE = env.LICENCE_FILE || '/licence/licence.key'

async function timed(name, fn) {
  const t = Date.now()
  try {
    const detail = await fn()
    return { name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) }
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t, error: String(e?.message || e).slice(0, 300) }
  }
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`)
  return r
}

const apiHeaders = () => ({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` })

async function runChecks() {
  const checks = await Promise.all([
    timed('app', async () => { await get(APP, { host: 'localhost' }); return 'login page 200' }),
    timed('api', async () => { await get(API, apiHeaders()); return 'postgrest 200' }),
    timed('worker', async () => {
      const r = await get(`${API}worker_health?select=worker,last_tick_at&order=last_tick_at.desc&limit=1`, apiHeaders())
      const [row] = await r.json()
      if (!row) throw new Error('no worker heartbeat yet')
      const ageMin = (Date.now() - new Date(row.last_tick_at).getTime()) / 60000
      if (ageMin > STALE_MIN) throw new Error(`worker heartbeat ${ageMin.toFixed(1)} min old`)
      return `${row.worker} ticked ${ageMin.toFixed(1)} min ago`
    }),
    ...DISK_PATHS.map((p) => timed(`disk:${p}`, async () => {
      const s = await fs.statfs(p)
      const freePct = (s.bavail / s.blocks) * 100
      if (freePct < DISK_MIN_FREE_PCT) throw new Error(`${freePct.toFixed(1)}% free`)
      return `${freePct.toFixed(1)}% free`
    })),
  ])
  return { box: BOX_ID, at: new Date().toISOString(), ok: checks.every((c) => c.ok), checks }
}

let latest = { box: BOX_ID, at: null, ok: false, checks: [], note: 'first check pending' }
let report = env.HEALTH_REPORT_URL ? { ok: false, note: 'first report pending' } : { ok: false, note: 'off (HEALTH_REPORT_URL blank)' }

async function reportToken() {
  if (env.HEALTH_REPORT_TOKEN) return env.HEALTH_REPORT_TOKEN
  try {
    return (await fs.readFile(LICENCE_FILE, 'utf8')).trim()
  } catch {
    return ''
  }
}

async function send(result) {
  const at = new Date().toISOString()
  try {
    const r = await fetch(env.HEALTH_REPORT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await reportToken()}` },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10_000),
    })
    const j = await r.json().catch(() => ({}))
    report = { ok: r.ok, at, http: r.status, ...(j.status ? { status: j.status } : {}), ...(j.error ? { error: j.error } : {}) }
  } catch (e) {
    report = { ok: false, at, error: String(e?.message || e).slice(0, 200) }
  }
  if (!report.ok) console.log(`report failed: ${JSON.stringify(report)}`)
}

async function tick() {
  latest = await runChecks()
  if (!latest.ok) console.log(JSON.stringify(latest))
  if (env.HEALTH_REPORT_URL) send(latest)
}

http.createServer((req, res) => {
  if (req.url !== '/health') { res.writeHead(404).end(); return }
  res.writeHead(latest.ok ? 200 : 503, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ...latest, report }, null, 2))
}).listen(8099, () => console.log(`health agent for ${BOX_ID} on :8099, every ${INTERVAL / 1000}s`))

tick()
setInterval(tick, INTERVAL)
