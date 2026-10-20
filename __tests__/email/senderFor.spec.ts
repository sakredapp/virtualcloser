// Guard for the owner rule 2026-10-20: every email sends from the domain of
// the brand it belongs to. Suite CXO mail never goes out as Virtual Closer.
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { addressOf, isOnDomain, senderFor } from '@/lib/sender'

const ENV_KEYS = ['CXO_RESEND_FROM', 'RESEND_FROM', 'CXO_RESEND_API_KEY', 'RESEND_API_KEY'] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('senderFor', () => {
  it('Suite CXO defaults to a suitecxo.com sender with the Suite CXO name and inbox', () => {
    delete process.env.CXO_RESEND_FROM
    const s = senderFor('cxo')
    expect(isOnDomain(s.address, 'suitecxo.com')).toBe(true)
    expect(s.from).toMatch(/^Suite CXO </)
    expect(s.replyTo).toBe('support@suitecxo.com')
    expect(s.rootDomain).toBe('suitecxo.com')
  })

  it('Suite CXO ignores a CXO_RESEND_FROM on the Virtual Closer domain', () => {
    process.env.CXO_RESEND_FROM = 'Virtual Closer <hello@virtualcloser.com>'
    const s = senderFor('cxo')
    expect(s.address).not.toContain('virtualcloser.com')
    expect(isOnDomain(s.address, 'suitecxo.com')).toBe(true)
  })

  it('Suite CXO uses a CXO_RESEND_FROM on suitecxo.com or a subdomain of it', () => {
    process.env.CXO_RESEND_FROM = 'Suite CXO <hello@mail.suitecxo.com>'
    expect(senderFor('cxo').address).toBe('hello@mail.suitecxo.com')
  })

  it('Suite CXO never falls back to RESEND_FROM', () => {
    delete process.env.CXO_RESEND_FROM
    process.env.RESEND_FROM = 'Virtual Closer <hello@virtualcloser.com>'
    expect(senderFor('cxo').address).not.toContain('virtualcloser.com')
  })

  it('Virtual Closer sends from virtualcloser.com and ignores a foreign RESEND_FROM', () => {
    process.env.RESEND_FROM = 'Someone <x@suitecxo.com>'
    const s = senderFor('virtualcloser')
    expect(isOnDomain(s.address, 'virtualcloser.com')).toBe(true)
    expect(s.replyTo).toBe('team@virtualcloser.com')
  })

  it('Suite CXO prefers its own API key when set', () => {
    process.env.RESEND_API_KEY = 'shared'
    process.env.CXO_RESEND_API_KEY = 'cxo-only'
    expect(senderFor('cxo').apiKey).toBe('cxo-only')
    expect(senderFor('virtualcloser').apiKey).toBe('shared')
  })

  it('addressOf handles a bare address and a named one', () => {
    expect(addressOf('a@b.com')).toBe('a@b.com')
    expect(addressOf('Name <A@B.com>')).toBe('a@b.com')
  })
})

// Source scan: the From address is chosen only in lib/sender.ts, and only
// lib/email.ts talks to Resend. A hardcoded `from:` or a second Resend client
// anywhere else would bypass the per-brand rule.
describe('no send path bypasses senderFor', () => {
  const ROOT = path.resolve(__dirname, '..', '..')
  const SKIP = new Set(['node_modules', '.next', '.git', '__tests__', 'scripts', 'public'])
  function walk(dir: string, out: string[]) {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(p)
    }
  }
  const files: string[] = []
  for (const d of ['app', 'lib', 'components']) {
    try {
      walk(path.join(ROOT, d), files)
    } catch {
      // directory may not exist
    }
  }
  const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')

  it('only lib/email.ts creates a Resend client or calls emails.send', () => {
    const offenders = files
      .filter((f) => rel(f) !== 'lib/email.ts')
      .filter((f) => /new Resend\(|\.emails\.send\(|api\.resend\.com/.test(readFileSync(f, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('sendEmail is never handed a from: override', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('sendEmail(')) continue
      // Any sendEmail({ ... from: ... }) call in the first 600 chars of its argument.
      const re = /sendEmail\(\{([\s\S]{0,600}?)\}\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        if (/(^|[\s,{])from\s*:/.test(m[1])) offenders.push(rel(f))
      }
    }
    expect(offenders).toEqual([])
  })
})
