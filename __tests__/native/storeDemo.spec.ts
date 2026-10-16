import { describe, expect, it } from 'vitest'
import { STORE_REVIEW, isPinnacleEdition, isStoreReviewTenant, productNameFor, sampleBook, sampleBooks, sampleBreakdown } from '@/lib/storeDemo'

describe('store review accounts', () => {
  it('names the product per edition; Pinnacle never says Suite CXO', () => {
    expect(productNameFor(STORE_REVIEW.pinnacle)).toBe('Pinnacle Life Group')
    expect(productNameFor('rep_spence')).toBe('Pinnacle Life Group')
    expect(productNameFor(STORE_REVIEW.suite)).toBe('Suite CXO')
    expect(productNameFor('rep_someone_else')).toBe('Suite CXO')
    expect(productNameFor(null)).toBe('Suite CXO')
  })

  it('the Pinnacle review org is an edition, not a book reader', async () => {
    const { pinnacleAllowed } = await import('@/lib/pinnacle/access')
    expect(isPinnacleEdition(STORE_REVIEW.pinnacle)).toBe(true)
    expect(pinnacleAllowed(STORE_REVIEW.pinnacle)).toBe(false)
    expect(isPinnacleEdition(STORE_REVIEW.suite)).toBe(false)
  })

  it('recognises only the two review tenants', () => {
    expect(isStoreReviewTenant(STORE_REVIEW.suite)).toBe(true)
    expect(isStoreReviewTenant(STORE_REVIEW.pinnacle)).toBe(true)
    expect(isStoreReviewTenant('rep_spence')).toBe(false)
    expect(isStoreReviewTenant(undefined)).toBe(false)
  })

  it('sample figures have the shapes the phone app reads', () => {
    const books = sampleBooks(new Date('2026-10-14T12:00:00'))
    expect(books.kind).toBe('books')
    expect(books.months).toHaveLength(13)
    expect(books.months.at(-1)!.month).toBe('2026-10')
    const book = sampleBook(new Date('2026-10-14T12:00:00'))
    expect(book.kind).toBe('book')
    expect(book.mtd.throughDay).toBe(14)
    expect(book.mtd.premium).toBeGreaterThan(book.mtd.prior.premium)
    const rows = sampleBreakdown('agent', 'Life', 5)
    expect(rows).toHaveLength(5)
    expect(rows[0].premium).toBeGreaterThan(rows[1].premium)
    expect(rows[0].team).toBeTruthy()
    expect(sampleBreakdown('carrier', 'All', 3)[0].team).toBeNull()
  })
})

describe('agreement wall for the store review logins', () => {
  it('skips the wall for both review orgs only', async () => {
    const { skipsAgreementWall, STORE_REVIEW } = await import('@/lib/storeDemo')
    expect(skipsAgreementWall(STORE_REVIEW.suite)).toBe(true)
    expect(skipsAgreementWall(STORE_REVIEW.pinnacle)).toBe(true)
    expect(skipsAgreementWall('rep_spence')).toBe(false)
    expect(skipsAgreementWall(null)).toBe(false)
  })

  it('titles the Pinnacle edition agreement with the org name, never Suite CXO', async () => {
    const { agreementTitleNameFor, STORE_REVIEW } = await import('@/lib/storeDemo')
    const { getAgreement, renderAgreementHtml } = await import('@/lib/liabilityAgreementCopy')
    const titleName = agreementTitleNameFor({ id: STORE_REVIEW.pinnacle, company: 'Pinnacle Life Group' })
    expect(titleName).toBe('Pinnacle Life Group')
    const a = getAgreement('cxo', { titleName })
    expect(a.title).toBe('Pinnacle Life Group — Operational & Liability Agreement')
    expect(a.title).not.toMatch(/CXO Suite|Suite CXO/)
    expect(a.version).toBe(getAgreement('cxo').version)
    expect(renderAgreementHtml({ brand: 'cxo', titleName })).toContain('<title>Pinnacle Life Group — Operational &amp; Liability Agreement</title>')
    // Every other org keeps the default title.
    expect(agreementTitleNameFor({ id: STORE_REVIEW.suite, company: 'Northwind Partners' })).toBeNull()
    expect(getAgreement('cxo', { titleName: null }).title).toMatch(/^Suite CXO/)
  })
})
