import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getBrand } from '@/lib/brand'

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')

describe('Suite CXO brand name and legal pages (owner 2026-10-16)', () => {
  it('the brand is "Suite CXO", never "CXO Suite"', () => {
    const b = getBrand('cxo')
    expect(b.name).toBe('Suite CXO')
    expect(b.emailFromName).toBe('Suite CXO')
    expect(b.supportEmail).toBe('team@suitecxo.com')
  })

  it('no app or lib source spells the old name (logo file URLs excepted)', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.resolve(__dirname, '../..', dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (/\.(tsx?|css)$/.test(e.name) && /CXO Suite(?!\.png)/.test(read(rel))) hits.push(rel)
      }
    }
    walk('app')
    walk('lib')
    expect(hits).toEqual([])
  })

  it('privacy and terms carry Suite CXO copy, not Virtual Closer leftovers', () => {
    for (const rel of ['app/privacy/CxoPrivacy.tsx', 'app/terms/CxoTerms.tsx']) {
      const src = read(rel)
      expect(src, rel).not.toMatch(/sales assistant|sales pipeline|April 2026|build fee|\/offer|Team Builder|leads, notes/i)
      // Opens inside the store app: no prices or checkout links.
      expect(src, rel).not.toMatch(/\$\d|checkout|whop\.com|per month/i)
    }
    expect(read('app/privacy/CxoPrivacy.tsx')).toContain("CXO_LEGAL_EFFECTIVE_DATE = 'October 16, 2026'")
    expect(read('app/privacy/page.tsx')).toContain("if (brand.key === 'cxo') return <CxoPrivacy brand={brand} />")
    expect(read('app/terms/page.tsx')).toContain("if (brand.key === 'cxo') return <CxoTerms brand={brand} />")
  })
})
