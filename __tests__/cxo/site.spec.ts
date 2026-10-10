import { describe, expect, it } from 'vitest'
import { cxoCheckoutUrl, cxoQuote, CXO_PRICE_PER_PERSON, CXO_QUESTIONS_PER_PERSON } from '@/lib/cxoSite'
import { getBrand } from '@/lib/brand'

describe('cxoCheckoutUrl', () => {
  it('is null while no plan is set, so the site shows Book a call', () => {
    expect(cxoCheckoutUrl(undefined)).toBeNull()
    expect(cxoCheckoutUrl(null)).toBeNull()
    expect(cxoCheckoutUrl('')).toBeNull()
    expect(cxoCheckoutUrl('   ')).toBeNull()
  })
  it('rejects anything that is not a Whop plan id', () => {
    expect(cxoCheckoutUrl('prod_abc123')).toBeNull()
    expect(cxoCheckoutUrl('plan_')).toBeNull()
    expect(cxoCheckoutUrl('plan_abc/../x')).toBeNull()
    expect(cxoCheckoutUrl('https://evil.example/plan_abcd')).toBeNull()
  })
  it('builds the Whop checkout link for a real plan id', () => {
    expect(cxoCheckoutUrl(' plan_AbC123xyz ')).toBe('https://whop.com/checkout/plan_AbC123xyz')
  })
})

describe('cxoQuote', () => {
  it('prices per person and pools questions', () => {
    expect(cxoQuote(10)).toEqual({ people: 10, monthly: 10 * CXO_PRICE_PER_PERSON, pool: 10 * CXO_QUESTIONS_PER_PERSON })
    expect(cxoQuote(1)).toEqual({ people: 1, monthly: 60, pool: 500 })
  })
  it('never quotes fewer than one person', () => {
    expect(cxoQuote(0).people).toBe(1)
    expect(cxoQuote(-5).people).toBe(1)
    expect(cxoQuote(Number.NaN).people).toBe(1)
    expect(cxoQuote(3.9).people).toBe(3)
  })
})

describe('assistant name', () => {
  it('lives in one brand constant', () => {
    expect(getBrand('cxo').assistantName).toBe('Mira')
  })
})
