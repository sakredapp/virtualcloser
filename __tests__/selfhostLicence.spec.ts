import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Private-server licence (selfhost/licence/): a signed file replaces Whop on a
// client's box. Tests sign with a throwaway key; the committed fixtures are
// signed with the real key and are expired or tampered, never valid.
const root = path.resolve(__dirname, '..')
const lic = path.join(root, 'selfhost/licence')
let L: typeof import('../selfhost/licence/licence.mjs')
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const base: import('../selfhost/licence/licence.mjs').LicencePayload = { v: 1, client_id: 'acme', client_name: 'Acme Corp', box_id: 'acme-01', seats: 25, issued_at: '2026-10-23T00:00:00.000Z', expires_at: '2027-10-31' }

beforeEach(async () => {
  L = await import('../selfhost/licence/licence.mjs')
})

describe('licence format', () => {
  it('signs and verifies, good through the end of the expiry day (UTC)', () => {
    const line = L.signLicence(base, PRIV)
    expect(line.startsWith('SCXO1.')).toBe(true)
    const r = L.verifyLicence(line, { boxId: 'acme-01', publicKeyPem: PUB, now: Date.parse('2027-10-31T23:59:00Z') })
    expect(r).toMatchObject({ ok: true, daysLeft: 0, licence: { seats: 25, client_id: 'acme' } })
    const after = L.verifyLicence(line, { boxId: 'acme-01', publicKeyPem: PUB, now: Date.parse('2027-11-01T00:00:01Z') })
    expect(after).toMatchObject({ ok: false, expired: true, reason: 'licence expired on 2027-10-31' })
  })

  it('rejects another box, a changed payload, another key and junk', () => {
    const line = L.signLicence(base, PRIV)
    expect(L.verifyLicence(line, { boxId: 'other', publicKeyPem: PUB, now: 0 }).reason).toMatch(/for box acme-01/)
    const [pre, , sig] = line.split('.')
    const forged = Buffer.from(JSON.stringify({ ...base, seats: 999 })).toString('base64url')
    expect(L.verifyLicence(`${pre}.${forged}.${sig}`, { boxId: 'acme-01', publicKeyPem: PUB, now: 0 }).reason).toMatch(/signature/)
    expect(L.verifyLicence(line, { boxId: 'acme-01', now: 0 }).reason).toMatch(/signature/) // the shipped key did not sign it
    expect(L.verifyLicence('', {}).ok).toBe(false)
    expect(L.verifyLicence('hello.world', {}).reason).toBe('not a Suite CXO licence')
  })

  it('refuses to sign a bad payload', () => {
    expect(() => L.signLicence({ ...base, seats: 0 }, PRIV)).toThrow(/seats/)
    expect(() => L.signLicence({ ...base, expires_at: '31/10/2027' }, PRIV)).toThrow(/YYYY-MM-DD/)
  })

  it('committed fixtures are signed by the real key and never valid', () => {
    const read = (f: string) => fs.readFileSync(path.join(lic, 'fixtures', f), 'utf8')
    expect(L.verifyLicence(read('expired.key'), { boxId: 'buildbox-test' })).toMatchObject({ ok: false, expired: true })
    expect(L.verifyLicence(read('tampered.key'), { boxId: 'buildbox-test' }).reason).toMatch(/signature/)
    expect(fs.readdirSync(path.join(lic, 'fixtures')).sort()).toEqual(['expired.key', 'tampered.key'])
  })

  it('no private key is committed anywhere under selfhost/', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    const hits = walk(path.join(root, 'selfhost')).filter((f) => /BEGIN [A-Z ]*PRIVATE KEY/.test(fs.readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('boot gate (check.mjs)', () => {
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, [path.join(lic, 'check.mjs'), ...args], { env: { PATH: process.env.PATH ?? '', ...env } as NodeJS.ProcessEnv, encoding: 'utf8' as const, timeout: 10_000 })

  it('verify: exit 3 with the reason for an expired or missing licence', () => {
    const exp = run(['verify'], { LICENCE_FILE: path.join(lic, 'fixtures/expired.key'), BOX_ID: 'buildbox-test' })
    expect(exp.status).toBe(3)
    expect(exp.stdout).toMatch(/NOT VALID: licence expired on 2000-01-31/)
    const none = run(['verify'], { LICENCE_FILE: path.join(os.tmpdir(), 'no-such-licence.key'), BOX_ID: 'x' })
    expect(none.status).toBe(3)
    expect(none.stdout).toMatch(/no licence file/)
  })

  it('refuses usage without a command', () => {
    expect(run(['app'], {}).status).toBe(2)
  })
})

describe('licence seat cap', () => {
  const KEYS = ['SELFHOST', 'LICENCE_SEATS']
  let saved: Record<string, string | undefined>
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('applies only on a box with a seat count', async () => {
    const { licenceSeatCap } = await import('@/lib/selfhostLicence')
    expect(licenceSeatCap({ LICENCE_SEATS: '25' })).toBeNull()
    expect(licenceSeatCap({ SELFHOST: '1' })).toBeNull()
    expect(licenceSeatCap({ SELFHOST: '1', LICENCE_SEATS: '25' })).toBe(25)
    expect(licenceSeatCap({ SELFHOST: '1', LICENCE_SEATS: 'lots' })).toBeNull()
  })
})

describe('no Whop on a box', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.SELFHOST
    process.env.SELFHOST = '1'
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.SELFHOST
    else process.env.SELFHOST = saved
  })

  it('server events and the pixel stay off', async () => {
    const fetchImpl = vi.fn()
    const { sendCxoRegistrationEvent } = await import('@/lib/billing/whopServerEvents')
    const r = await sendCxoRegistrationEvent({} as never, fetchImpl as never)
    expect(r).toEqual({ ok: false, skipped: 'selfhost' })
    expect(fetchImpl).not.toHaveBeenCalled()
    const { cxoPixelHostAllowed } = await import('@/lib/whopPixel')
    expect(cxoPixelHostAllowed('www.suitecxo.com', 'Mozilla/5.0')).toBe(false)
  })

  it('the Whop API client refuses before any fetch', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    const src = fs.readFileSync(path.join(root, 'lib/billing/whop.ts'), 'utf8')
    const i = src.indexOf("process.env.SELFHOST === '1'")
    expect(i).toBeGreaterThan(-1)
    expect(i).toBeLessThan(src.indexOf('fetch(`${WHOP_API}'))
    f.mockRestore()
  })
})
