import { describe, expect, it } from 'vitest'
import { PHONE_VERSIONS, demoPhoneVersion, isWorkPage, orderWork, phoneVersion, phoneVersionKeyFor, phoneVersionStyle } from '@/lib/phoneVersions'

describe('phone versions', () => {
  it('gives a phone version only to executive-suite tenants', () => {
    expect(phoneVersionKeyFor({ brand: 'virtualcloser', pinnacle: false })).toBeNull()
    expect(phoneVersionKeyFor({ brand: 'virtualcloser', pinnacle: true })).toBeNull()
    expect(phoneVersionKeyFor({ brand: null, pinnacle: false })).toBeNull()
    expect(phoneVersionKeyFor({ brand: 'cxo', pinnacle: false })).toBe('cxo')
  })

  it('gives the Pinnacle version only to a tenant already on the Pinnacle book', () => {
    expect(phoneVersionKeyFor({ brand: 'cxo', pinnacle: true })).toBe('pinnacle')
    expect(phoneVersion('pinnacle')?.home).toBe('book')
    expect(phoneVersion('cxo')?.home).toBe('today')
    expect(phoneVersion(null)).toBeNull()
  })

  it('never names the assistant CAIO or Chief AI Officer, and uses no em dash', () => {
    for (const v of Object.values(PHONE_VERSIONS)) {
      const text = JSON.stringify(v)
      expect(text).not.toMatch(/CAIO|Chief AI Officer/i)
      expect(text).not.toContain('—')
      expect(v.assistantName).toBe('Ciao')
    }
  })

  it('orders Work by the version and keeps unlisted pages at the end', () => {
    const pages = [{ href: '/dashboard/boards' }, { href: '/dashboard/something-new' }, { href: '/dashboard/revenue' }, { href: '/dashboard/approvals' }]
    expect(orderWork(pages, PHONE_VERSIONS.pinnacle).map((p) => p.href)).toEqual(['/dashboard/approvals', '/dashboard/revenue', '/dashboard/boards', '/dashboard/something-new'])
    expect(orderWork(pages, PHONE_VERSIONS.cxo).map((p) => p.href)).toEqual(['/dashboard/approvals', '/dashboard/boards', '/dashboard/revenue', '/dashboard/something-new'])
  })

  it('keeps Home, Inbox and Me out of Work, and everything else in', () => {
    expect(isWorkPage('/dashboard')).toBe(false)
    expect(isWorkPage('/dashboard/inbox?tab=email&account=x')).toBe(false)
    expect(isWorkPage('/dashboard/settings')).toBe(false)
    expect(isWorkPage('/dashboard/pinnacle')).toBe(true)
    expect(isWorkPage('/dashboard/calendar')).toBe(true)
  })

  it('shows the public demo under the invented company, never a client', () => {
    const book = demoPhoneVersion('book', 'Northgate Group')
    expect(book.home).toBe('book')
    expect(book.appName).toBe('Northgate Group')
    expect(book.wordmark).toBe('Northgate Group')
    expect(book.work).toEqual(PHONE_VERSIONS.pinnacle.work)
    expect(JSON.stringify({ ...book, key: '', work: [] })).not.toMatch(/pinnacle/i)
    expect(demoPhoneVersion('today', 'Northgate Group')).toBe(PHONE_VERSIONS.cxo)
  })

  it('only emits colour overrides a version sets', () => {
    expect(phoneVersionStyle(PHONE_VERSIONS.cxo)).toEqual({})
    expect(phoneVersionStyle({ ...PHONE_VERSIONS.cxo, colors: { ground: '#fff' } })).toEqual({ '--cxph-ground': '#fff' })
  })
})
