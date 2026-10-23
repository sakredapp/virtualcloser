import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { signLicence, type LicencePayload } from '../selfhost/licence/licence.mjs'
import { parseBoxReport } from '@/lib/privateServerReport'

// Private-server fleet check-in (app/api/ops/private-server/report): the box's
// licence is the bearer; one row per box.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const lic: LicencePayload = { v: 1, client_id: 'acme', client_name: 'Acme Corp', box_id: 'acme-01', seats: 25, issued_at: '2026-10-23T00:00:00.000Z', expires_at: '2027-10-31' }
const line = signLicence(lic, PRIV)
const NOW = Date.parse('2026-11-01T12:00:00Z')
const green = { box: 'acme-01', at: '2026-11-01T11:59:58.000Z', ok: true, checks: [{ name: 'app', ok: true, ms: 12, detail: 'login page 200' }, { name: 'worker', ok: true, ms: 30 }] }
const parse = (auth: string | null, body: unknown, now = NOW) => parseBoxReport(auth, body, { now, publicKeyPem: PUB })

describe('parseBoxReport', () => {
  it('builds the fleet row from a green report', () => {
    const r = parse(`Bearer ${line}`, green)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row).toMatchObject({ box_id: 'acme-01', client_id: 'acme', seats: 25, licence_expires_at: '2027-10-31', status: 'ok', failing_checks: [], last_ok_at: '2026-11-01T12:00:00.000Z' })
    expect(r.row.last_report.licence_expired).toBe(false)
  })

  it('marks failing checks and keeps the last ok time untouched', () => {
    const r = parse(`Bearer ${line}`, { ...green, ok: false, checks: [...green.checks, { name: 'disk:/', ok: false, error: '9.0% free' }] })
    if (!r.ok) throw new Error('expected ok')
    expect(r.row.status).toBe('failing')
    expect(r.row.failing_checks).toEqual(['disk:/'])
    expect(r.row).not.toHaveProperty('last_ok_at')
  })

  it('still records a box whose licence has expired', () => {
    const r = parse(`Bearer ${line}`, green, Date.parse('2027-11-02T00:00:00Z'))
    if (!r.ok) throw new Error('expected ok')
    expect(r.row.last_report.licence_expired).toBe(true)
  })

  it('refuses no licence, a forged licence, another box and junk bodies', () => {
    expect(parse(null, green)).toMatchObject({ ok: false, status: 401, error: 'no_licence' })
    const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(parse(`Bearer ${signLicence(lic, other)}`, green)).toMatchObject({ ok: false, status: 401, error: 'bad_licence' })
    expect(parse(`Bearer ${line}`, { ...green, box: 'globex-01' })).toMatchObject({ ok: false, status: 403, error: 'box_mismatch' })
    expect(parse(`Bearer ${line}`, [])).toMatchObject({ ok: false, status: 400 })
    expect(parse(`Bearer ${line}`, { box: 'acme-01' })).toMatchObject({ ok: false, status: 400, error: 'no_checks' })
  })

  it('an empty check list is never green, and long fields are cut', () => {
    const r = parse(`Bearer ${line}`, { box: 'acme-01', ok: true, checks: [] })
    if (!r.ok) throw new Error('expected ok')
    expect(r.row.status).toBe('failing')
    const long = parse(`Bearer ${line}`, { ...green, checks: [{ name: 'app', ok: false, error: 'x'.repeat(5000) }] })
    if (!long.ok) throw new Error('expected ok')
    expect(long.row.last_report.checks[0].error).toHaveLength(300)
  })
})

describe('fleet check-in wiring', () => {
  const root = path.resolve(__dirname, '..')
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

  it('the route is public to boxes (its own licence auth) and off on a box', () => {
    expect(read('middleware.ts')).toContain("'/api/ops/private-server'")
    expect(read('app/api/ops/private-server/report/route.ts')).toContain("process.env.SELFHOST === '1'")
  })

  it('the health agent signs with the licence and the table is service-role only', () => {
    expect(read('selfhost/health/agent.mjs')).toContain('LICENCE_FILE')
    expect(read('selfhost/docker-compose.yml')).toMatch(/health:[\s\S]*?\.\/box-licence:\/licence:ro/)
    const sql = read('supabase/private_server_boxes.sql')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('to service_role')
    expect(sql).toContain('revoke all on public.private_server_boxes from anon, authenticated')
  })
})
