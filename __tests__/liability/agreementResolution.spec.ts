// Regression coverage for brand-aware agreement resolution.
//
// This is legally significant: getAgreement() decides WHICH contract text and
// version a member signs. A CXO tenant must sign the CXO agreement; a VC, null,
// or unknown brand must fall back to the Virtual Closer agreement — never the
// wrong contract. recordSignature(), the dashboard liability gate, the onboard
// page, and the PDF generator all branch on this, so a regression here would
// silently bind people to the wrong document.

import { describe, it, expect } from 'vitest'
import {
  getAgreement,
  AGREEMENT_TITLE,
  CURRENT_VERSION,
  CXO_AGREEMENT_TITLE,
  CXO_CURRENT_VERSION,
} from '@/lib/liabilityAgreementCopy'

describe('getAgreement brand resolution', () => {
  it('resolves the Virtual Closer agreement for the virtualcloser brand', () => {
    const a = getAgreement('virtualcloser')
    expect(a.title).toBe(AGREEMENT_TITLE)
    expect(a.version).toBe(CURRENT_VERSION)
    expect(a.body.length).toBeGreaterThan(0)
  })

  it('resolves the CXO Suite agreement for the cxo brand', () => {
    const a = getAgreement('cxo')
    expect(a.title).toBe(CXO_AGREEMENT_TITLE)
    expect(a.version).toBe(CXO_CURRENT_VERSION)
    expect(a.body.length).toBeGreaterThan(0)
  })

  it('uses distinct titles, versions, and bodies per brand', () => {
    const vc = getAgreement('virtualcloser')
    const cxo = getAgreement('cxo')
    expect(vc.title).not.toBe(cxo.title)
    expect(vc.version).not.toBe(cxo.version)
    expect(vc.body).not.toBe(cxo.body)
  })

  it('falls back to Virtual Closer for null, undefined, or unknown brand', () => {
    const fallback = { title: AGREEMENT_TITLE, version: CURRENT_VERSION }
    expect(getAgreement(null)).toMatchObject(fallback)
    expect(getAgreement(undefined)).toMatchObject(fallback)
    // Unknown brand string never resolves to the CXO contract by accident.
    expect(getAgreement('totally-unknown' as never).title).toBe(AGREEMENT_TITLE)
  })
})
