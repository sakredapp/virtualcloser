/**
 * Public copy drift (2026-10-22, vault "Keep Public Surfaces in Sync with the
 * Product"). What www.suitecxo.com says must match what Suite CXO sells today
 * (vault 02 Businesses/Suite CXO.md):
 *   - never "chief of staff" / "Chief AI Officer";
 *   - no boards, no customer email inbox / Gmail (only "an edition set up by
 *     agreement", as /privacy says);
 *   - no sales tools or targets, and the public demo is not an insurance agency;
 *   - private server = "coming"; the only private-server prices are our build
 *     and care fees (no hardware, running, rent, power or battery estimates).
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cxoLlmsTxt, sitemapFor, CXO_SITE_DESCRIPTION } from '@/lib/seo'
import { PHONE_STARTERS } from '@/app/components/cxo/phone/PhoneStarters'

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
/** The rendered part of a page component: from its first `return (`. */
const jsx = (rel: string) => {
  const src = read(rel)
  return src.slice(src.indexOf('return ('))
}

describe('support page', () => {
  it('uses the home page positioning, not "chief of staff", boards or numbers', () => {
    const page = jsx('app/support/page.tsx')
    expect(page).not.toMatch(/chief of staff|chief ai officer|\bboards\b|\bnumbers\b/i)
    expect(page).toContain('one company AI your team logs into')
  })
})

describe('terms', () => {
  it('lists no boards and no customer Google email; Gmail only on an edition set up by agreement', () => {
    const src = read('app/terms/CxoTerms.tsx')
    expect(src).not.toMatch(/\bboards\b/i)
    expect(src).not.toMatch(/Google email/i)
    expect(src).toContain('an edition set up by agreement')
  })
})

describe('book a call page', () => {
  it('is titled "Book a call"', () => {
    expect(read('app/cxo/request-access/page.tsx')).toMatch(/cxoPageMeta\(\s*'\/cxo\/request-access',\s*'Book a call',/)
  })
})

describe('sizing page', () => {
  it('is in the sitemap', () => {
    expect(sitemapFor('www.suitecxo.com').map((e) => e.url)).toContain('https://www.suitecxo.com/cxo/sizing')
  })
  it('shows only our build and care fees, never hardware, running, rent, power or battery costs', () => {
    const calc = jsx('app/cxo/sizing/SizingCalculator.tsx')
    expect(calc).not.toMatch(/Hardware, one time|Running cost|Server rent|Power and cooling|Battery|Training on your work, each run|r\.hardware|r\.monthly\b|p\.rent|p\.power|p\.ups|fineTuneRun/)
    expect(calc).toContain('r.buildFee')
    expect(calc).toContain('p.care')
    const page = read('app/cxo/sizing/page.tsx')
    expect(page).not.toMatch(/cost(s)? to buy\s+and run|buy and run/i)
    expect(page).toMatch(/coming/i)
  })
})

/**
 * The words a file can show a visitor: its string literals, template text and
 * JSX text. Field names of the shared rollup rows (premium, policies) are code,
 * not copy, so they are left out.
 */
function copyOf(src: string): string {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const literals = noComments.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []
  const jsxText = noComments.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g) ?? []
  // 'carrier' as a bare literal is the rollup's breakdown key (lib/pinnacle/rollup), not copy.
  return [...literals.filter((l) => l !== "'carrier'"), ...jsxText].join('\n')
}

describe('public demo (/cxo/demo)', () => {
  const files = ['app/cxo/demo/CxoDemo.tsx', 'app/cxo/demo/DemoPartners.tsx', 'app/cxo/demo/DemoPhone.tsx', 'app/cxo/demo/page.tsx']
  it('names no carriers and is not an insurance agency', () => {
    for (const f of files) {
      expect(copyOf(read(f)), f).not.toMatch(/Athene|Foresters|Mutual of Omaha|Americo|Transamerica|Aetna|annuity|final expense|mortgage protection|carrier|polic(y|ies)|premium|enrollment|underwrit/i)
    }
  })
  it('the copy scan sees literals and JSX text but not field names', () => {
    const c = copyOf("const r = { premium: 1 }\nconst t = 'Booked revenue'\nreturn <b>Top offices</b>")
    expect(c).toContain('Booked revenue')
    expect(c).toContain('Top offices')
    expect(c).not.toMatch(/premium/)
  })
  it('has no sales targets in the starters', () => {
    expect(PHONE_STARTERS.join(' ')).not.toMatch(/target/i)
  })
  it('does not freeze the date', () => {
    const src = read('app/cxo/demo/CxoDemo.tsx') + read('app/cxo/demo/DemoPartners.tsx')
    expect(src).not.toMatch(/2026-10-08|Date\.UTC\(2026, 9, 8|October 8|Oct 8|Thursday, October 8/)
  })
  it('describes the real nav in its meta description', () => {
    const page = read('app/cxo/demo/page.tsx')
    expect(page).toMatch(/Revenue, team, employees, partners, calendar, meetings and settings/i)
    expect(page).not.toMatch(/performance, reports|recordings and integrations/i)
  })
})

describe('search and AI files', () => {
  it('never say chief of staff, never offer an inbox, private server only as coming', () => {
    const t = cxoLlmsTxt() + CXO_SITE_DESCRIPTION
    expect(t).not.toMatch(/chief of staff|chief ai officer|inbox|gmail|\bboards\b/i)
    expect(t).toMatch(/## Coming\s+A private server you own/)
  })
})
