/**
 * The store app's address rules (native/src/host.ts): which company address
 * it accepts, and which links it will open. The app must never point its
 * WebView at a host that is not suitecxo.com.
 */
import { describe, expect, it } from 'vitest'
import {
  companyFromHost,
  isSuiteHost,
  normalizeCompany,
  resolveDeepLink,
  startUrl,
} from '../../native/src/host'

describe('normalizeCompany', () => {
  it('accepts a name, a host or a pasted link', () => {
    expect(normalizeCompany('Pinnacle')).toBe('pinnacle')
    expect(normalizeCompany(' pinnacle.suitecxo.com ')).toBe('pinnacle')
    expect(normalizeCompany('https://pinnacle.suitecxo.com/dashboard?x=1')).toBe('pinnacle')
  })
  it('refuses other domains, reserved names and junk', () => {
    expect(normalizeCompany('pinnacle.example.com')).toBeNull()
    expect(normalizeCompany('www')).toBeNull()
    expect(normalizeCompany('www.suitecxo.com')).toBeNull()
    expect(normalizeCompany('a b')).toBeNull()
    expect(normalizeCompany('-bad')).toBeNull()
    expect(normalizeCompany('')).toBeNull()
    expect(normalizeCompany(null)).toBeNull()
  })
})

describe('hosts', () => {
  it('knows a Suite CXO host from a lookalike', () => {
    expect(isSuiteHost('suitecxo.com')).toBe(true)
    expect(isSuiteHost('pinnacle.suitecxo.com')).toBe(true)
    expect(isSuiteHost('suitecxo.com.evil.com')).toBe(false)
    expect(isSuiteHost('evilsuitecxo.com')).toBe(false)
  })
  it('reads the company from a customer host only', () => {
    expect(companyFromHost('pinnacle.suitecxo.com')).toBe('pinnacle')
    expect(companyFromHost('suitecxo.com')).toBeNull()
    expect(companyFromHost('www.suitecxo.com')).toBeNull()
  })
  it('starts at the company dashboard, or the shared sign-in page', () => {
    expect(startUrl('pinnacle')).toBe('https://pinnacle.suitecxo.com/dashboard')
    expect(startUrl(null)).toBe('https://suitecxo.com/login')
    expect(startUrl('not a company')).toBe('https://suitecxo.com/login')
  })
})

describe('resolveDeepLink', () => {
  it('opens Suite CXO web links as they are', () => {
    expect(resolveDeepLink('https://pinnacle.suitecxo.com/dashboard/inbox?a=1')).toEqual({
      kind: 'open',
      url: 'https://pinnacle.suitecxo.com/dashboard/inbox?a=1',
    })
  })
  it('ignores links to anywhere else', () => {
    expect(resolveDeepLink('https://example.com/dashboard')).toBeNull()
    expect(resolveDeepLink('http://pinnacle.suitecxo.com/dashboard')).toBeNull()
    expect(resolveDeepLink('javascript:alert(1)')).toBeNull()
    expect(resolveDeepLink('not a url')).toBeNull()
    expect(resolveDeepLink('suitecxo://delete-everything')).toBeNull()
  })
  it('handles the app scheme', () => {
    expect(resolveDeepLink('suitecxo://settings')).toEqual({ kind: 'settings' })
    expect(resolveDeepLink('suitecxo://open?company=pinnacle')).toEqual({
      kind: 'open',
      url: 'https://pinnacle.suitecxo.com/dashboard',
    })
    expect(resolveDeepLink('suitecxo://open?company=pinnacle&path=/dashboard/inbox')).toEqual({
      kind: 'open',
      url: 'https://pinnacle.suitecxo.com/dashboard/inbox',
    })
    expect(resolveDeepLink('suitecxo://open')).toEqual({ kind: 'open', url: 'https://suitecxo.com/login' })
  })
  it('never lets the path or company move the app off suitecxo.com', () => {
    expect(resolveDeepLink('suitecxo://open?company=pinnacle&path=//evil.com')).toEqual({
      kind: 'open',
      url: 'https://pinnacle.suitecxo.com/dashboard',
    })
    expect(resolveDeepLink('suitecxo://open?company=evil.com')).toEqual({
      kind: 'open',
      url: 'https://suitecxo.com/login',
    })
  })
})
