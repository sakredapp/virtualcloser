/**
 * Plan + comp-grid uploads: name matching, the rule reader, the review step,
 * profit math, the Claude output mappers and the Google Sheets link fetch.
 * Every number here is a labelled test figure, not Pinnacle data.
 */
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { matchName, similarity } from '@/lib/plan/match'
import {
  allowanceDollars,
  findRate,
  monthsForPeriod,
  payoutOf,
  profitBreakdown,
  profitForMonths,
  profitSummary,
  spreadOf,
  coverageSummary,
  type CompRate,
} from '@/lib/plan/comp'
import {
  applyReview,
  buildReview,
  mergePlanRows,
  normaliseRateScale,
  readCompTable,
  readPlanTable,
  type CompDraft,
  type PlanDraft,
  type Table,
} from '@/lib/plan/importShared'
import { compFromClaude, planFromClaude, sourceOf, tablesFrom } from '@/lib/plan/importServer'
import { PRIVATE_SHEET, SheetLinkError, fetchSheetCsv, sheetCsvUrl } from '@/lib/plan/sheetLink'
import type { PlanTarget } from '@/lib/plan/shared'

const csvTable = (name: string, csv: string): Table => ({ name, rows: csv.trim().split('\n').map((l) => l.split(',')) })
const base = { filename: 'test', source: 'csv' as const, readBy: 'rules' as const, costUsd: 0, notes: [] }

describe('matchName', () => {
  const known = ['Mutual of Omaha', 'Americo', 'Aetna', 'Final Expense', 'IUL']
  it('matches exact, filler-word, initials and prefix spellings', () => {
    expect(matchName('americo', known)).toMatchObject({ kind: 'exact', name: 'Americo' })
    expect(matchName('Mutual Of Omaha Insurance Co.', known)).toMatchObject({ kind: 'fuzzy', name: 'Mutual of Omaha' })
    expect(matchName('MOO', known)).toMatchObject({ kind: 'fuzzy', name: 'Mutual of Omaha' })
    expect(matchName('Final Exp', known)).toMatchObject({ kind: 'fuzzy', name: 'Final Expense' })
  })
  it('leaves an unrelated name unknown', () => {
    expect(matchName('Zurich', known).kind).toBe('unknown')
    expect(similarity('Aetna', 'Americo')).toBeLessThan(0.82)
  })
})

describe('comp math', () => {
  const rates: CompRate[] = [
    { product: 'IUL', carrier: 'Test Carrier A', agency_rate: 110, payout_rate: null, payout_level: null, agent_levels: [{ level: 'L1', rate: 70 }, { level: 'L3', rate: 90 }] },
    { product: '', carrier: 'Test Carrier B', agency_rate: 100, payout_rate: 80, payout_level: null, agent_levels: [{ level: 'Top', rate: 95 }, { level: 'Mid', rate: 80 }] },
  ]
  it('uses the highest agent level unless a payout is set', () => {
    expect(payoutOf(rates[0])).toEqual({ rate: 90, level: 'L3' })
    expect(spreadOf(rates[0])).toBe(20)
    expect(payoutOf(rates[1])).toEqual({ rate: 80, level: 'Mid' })
    expect(spreadOf({ agency_rate: 100, payout_rate: null, agent_levels: [] })).toBeNull()
  })
  it('finds the product row, a whole-word product match, or the carrier catch-all', () => {
    expect(findRate(rates, 'IUL Express', 'test carrier a')?.agency_rate).toBe(110)
    expect(findRate(rates, 'Term', 'Test Carrier B')?.agency_rate).toBe(100)
    expect(findRate(rates, 'Term', 'Test Carrier A')).toBeNull()
  })
  const targets: PlanTarget[] = [
    { year: 2027, month: 4, product: 'IUL', carrier: 'Test Carrier A', premium: 10000, policies: null },
    { year: 2027, month: 5, product: 'Term', carrier: 'Test Carrier B', premium: 5000, policies: null },
    { year: 2027, month: 7, product: 'Health', carrier: 'No Grid Co', premium: 5000, policies: null },
  ]
  it('works out plan profit, coverage and the blended spread', () => {
    const s = profitSummary(targets, rates)
    expect(s.total).toBe(2000 + 1000) // 10k × 20 pts + 5k × 20 pts
    expect(s.coverage).toBe(0.75)
    expect(s.blendedSpread).toBe(20)
    expect(s.uncovered).toEqual([{ product: 'Health', carrier: 'No Grid Co', premium: 5000 }])
    expect(profitForMonths(s, monthsForPeriod('Q2').months)).toBe(3000)
    expect(profitForMonths(s, monthsForPeriod('q3 2027').months)).toBe(0)
  })
  it('breaks profit down by carrier with an estimated actual', () => {
    const lines = profitBreakdown(targets, rates, 'carrier', [{ label: 'Test Carrier A', premium: 4000, policies: 3 }])
    expect(lines[0]).toMatchObject({ name: 'Test Carrier A', planProfit: 2000, spread: 20, actualPremium: 4000, actualProfit: 800 })
    expect(lines.find((l) => l.name === 'No Grid Co')?.covered).toBe(false)
  })
  it('reads periods, allowance dollars and coverage', () => {
    expect(monthsForPeriod('second quarter')).toEqual({ months: [4, 5, 6], label: 'Q2' })
    expect(monthsForPeriod('H2').months).toHaveLength(6)
    expect(monthsForPeriod('March')).toEqual({ months: [3], label: 'Mar' })
    expect(monthsForPeriod('').label).toBe('Full year')
    expect(allowanceDollars('$5,000 marketing allowance')).toBe(5000)
    expect(allowanceDollars('$2.5k co-op')).toBe(2500)
    expect(allowanceDollars('trip')).toBeNull()
    expect(coverageSummary(rates)).toMatchObject({ carriers: 2, rows: 2 })
  })
})

describe('readPlanTable', () => {
  it('reads a wide sheet (months across) and keeps the stated totals', () => {
    const t = csvTable(
      'Plan 2027',
      `Product,Carrier,Measure,Jan,Feb,Mar,Total
Life,Test Carrier A,Premium,1000,2000,3000,6000
Life,Test Carrier A,Policies,4,8,12,24
Total,,,1000,2000,3000,9999`,
    )
    const r = readPlanTable(t)
    expect(r.ok).toBe(true)
    const rows = mergePlanRows(r.rows)
    const jan = rows.find((x) => x.month === 1)!
    expect(jan).toMatchObject({ product: 'Life', carrier: 'Test Carrier A', premium: 1000, policies: 4 })
    expect(rows).toHaveLength(3)
    expect(r.totals.length).toBeGreaterThan(0)
  })
  it('reads a long sheet (a Month column)', () => {
    const t = csvTable(
      'Sheet1',
      `Year,Month,Product,Carrier,Premium,Policies
2027,Jan,Health,Test Carrier B,5000,10
2027,February,Health,Test Carrier B,6000,`,
    )
    const r = readPlanTable(t)
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[1]).toMatchObject({ month: 2, premium: 6000, year: 2027 })
  })
  it('says it cannot read a sheet with no plan in it instead of inventing numbers', () => {
    const r = readPlanTable(csvTable('x', 'foo,bar\n1,2'))
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
  })
})

describe('readCompTable', () => {
  it('finds the agency column and treats the rest as agent levels', () => {
    const r = readCompTable(csvTable('Grid', `Carrier,Product,Agency Contract,Agent L1,Agent L2\nTest Carrier A,IUL,110%,70%,85%`))
    expect(r.ok).toBe(true)
    expect(r.rows[0]).toMatchObject({ carrier: 'Test Carrier A', product: 'IUL', agency_rate: 110 })
    expect(r.rows[0].agent_levels.map((l) => l.rate)).toEqual([70, 85])
  })
  it('reads decimal rates as percents', () => {
    const r = readCompTable(csvTable('Grid', `Carrier,Product,Agency,Agent\nTest Carrier A,IUL,1.1,0.8`))
    const n = normaliseRateScale(r.rows)
    expect(n.scaled).toBe(true)
    expect(n.rows[0].agency_rate).toBeCloseTo(110)
    expect(n.rows[0].agent_levels[0].rate).toBeCloseTo(80)
  })
})

describe('review: plan', () => {
  const draft: PlanDraft = {
    ...base,
    kind: 'plan',
    year: 2027,
    totals: [{ label: 'Total Jan', value: 9999, month: 1, product: null, carrier: null, src: 'stated in the file' }],
    rows: [
      { id: 1, year: 2027, month: 1, product: 'Life', carrier: 'Mutual Of Omaha Ins', premium: 1000, policies: null, src: 'r1' },
      { id: 2, year: 2027, month: 1, product: 'Life', carrier: 'Mutual of Omaha', premium: 500, policies: null, src: 'r2' },
      { id: 3, year: 2027, month: null, product: 'Health', carrier: 'Aetna', premium: 12000, policies: null, src: 'r3' },
      { id: 4, year: 2026, month: 2, product: 'Life', carrier: 'Aetna', premium: 700, policies: null, src: 'r4' },
      { id: 5, year: 2027, month: 3, product: 'Life', carrier: 'Zzzq Mystery', premium: 300, policies: null, src: 'r5' },
    ],
  }
  const known = { carriers: ['Mutual of Omaha', 'Aetna'], products: ['Life', 'Health'] }
  const review = buildReview(draft, known)
  const types = review.issues.map((i) => i.type).sort()
  it('flags every problem with a fix', () => {
    expect(types).toEqual(['duplicate', 'missing_month', 'other_year', 'total_mismatch', 'unknown_carrier'])
    expect(review.matched).toContainEqual(expect.objectContaining({ field: 'carrier', raw: 'Mutual Of Omaha Ins', to: 'Mutual of Omaha' }))
  })
  it('applies the chosen fixes', () => {
    const id = (t: string) => review.issues.find((i) => i.type === t)!.id
    const out = applyReview(draft, review, {
      [id('duplicate')]: 'sum',
      [id('missing_month')]: 'spread',
      year: 'use',
      [id('total_mismatch')]: 'rows',
      [id('unknown_carrier')]: 'skip',
    })
    if (out.kind !== 'plan') throw new Error('plan expected')
    const jan = out.targets.filter((t) => t.month === 1)
    expect(jan.find((t) => t.carrier === 'Mutual of Omaha')?.premium).toBe(1500)
    expect(jan.find((t) => t.product === 'Health')?.premium).toBe(1000)
    expect(out.targets.filter((t) => t.product === 'Health')).toHaveLength(12)
    expect(out.targets.find((t) => t.month === 2 && t.product === 'Life')?.premium).toBe(700)
    expect(out.targets.some((t) => t.carrier === 'Zzzq Mystery')).toBe(false)
    expect(out.skippedRows).toBe(1)
  })
  it('treats undecided issues as skip', () => {
    const out = applyReview(draft, review, {})
    if (out.kind !== 'plan') throw new Error('plan expected')
    expect(out.targets).toEqual([])
  })
})

describe('review: comp', () => {
  const draft: CompDraft = {
    ...base,
    kind: 'comp',
    rows: [
      { id: 1, carrier: 'Test Carrier A', product: 'IUL', agency_rate: 1100, agent_levels: [{ level: 'L1', rate: 80 }], src: 'r1' },
      { id: 2, carrier: 'Test Carrier A', product: 'Term', agency_rate: 100, agent_levels: [], src: 'r2' },
      { id: 3, carrier: 'Test Carrier A', product: 'FE', agency_rate: 90, agent_levels: [{ level: 'L1', rate: 95 }], src: 'r3' },
      { id: 4, carrier: 'Test Carrier A', product: 'Annuity', agency_rate: null, agent_levels: [{ level: 'L1', rate: 5 }], src: 'r4' },
      { id: 5, carrier: 'Test Carrier A', product: 'Term', agency_rate: 105, agent_levels: [{ level: 'L1', rate: 80 }], src: 'r5' },
    ],
  }
  const review = buildReview(draft, { carriers: [], products: [] })
  it('flags high rates, missing payouts, negative spreads, no rate and duplicates', () => {
    expect(review.issues.map((i) => i.type).sort()).toEqual(['duplicate', 'negative_spread', 'no_payout', 'no_rate', 'rate_high'])
    const high = review.issues.find((i) => i.type === 'rate_high')!
    expect(high.fixes.map((f) => f.id)).toEqual(['div10:Agency', 'keep:Agency'])
  })
  it('applies the fixes', () => {
    const id = (t: string) => review.issues.find((i) => i.type === t)!.id
    const out = applyReview(draft, review, { [id('rate_high')]: 'div10:Agency', [id('duplicate')]: 'last', [id('no_payout')]: 'keep', [id('negative_spread')]: 'skip' })
    if (out.kind !== 'comp') throw new Error('comp expected')
    expect(out.rates.find((r) => r.product === 'IUL')?.agency_rate).toBe(110)
    expect(out.rates.find((r) => r.product === 'Term')?.agency_rate).toBe(105)
    expect(out.rates.some((r) => r.product === 'FE' || r.product === 'Annuity')).toBe(false)
  })
})

describe('Claude output mappers', () => {
  it('turns plan lines into month rows and keeps stated totals', () => {
    const r = planFromClaude({
      lines: [
        { product: 'Life', carrier: 'Test Carrier A', measure: 'premium', year: 2027, months: [100, 200, null, null, null, null, null, null, null, null, null, null] },
        { product: 'Health', carrier: 'Test Carrier B', measure: 'premium', months: null, annual_total: 1200 },
        { product: '', carrier: '' },
      ],
      stated_totals: [{ label: 'Grand total', value: 1500 }],
    })
    expect(r.rows.filter((x) => x.month != null)).toHaveLength(2)
    expect(r.rows.find((x) => x.month == null)).toMatchObject({ premium: 1200, carrier: 'Test Carrier B' })
    expect(r.totals).toEqual([expect.objectContaining({ value: 1500, month: null })])
  })
  it('turns comp rows into draft rows and drops blank carriers', () => {
    const r = compFromClaude({ rows: [{ carrier: 'Test Carrier A', product: 'IUL', agency_rate: 110, agent_levels: [{ level: 'L1', rate: 80 }, { level: '', rate: '75%' as unknown as number }] }, { carrier: '' }] })
    expect(r).toHaveLength(1)
    expect(r[0].agent_levels).toEqual([{ level: 'L1', rate: 80 }, { level: 'Agent', rate: 75 }])
  })
})

describe('files', () => {
  it('knows a file by its name and bytes', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 test')
    expect(sourceOf('rates.pdf', pdf)).toBe('pdf')
    expect(sourceOf('plan.csv', new TextEncoder().encode('a,b'))).toBe('csv')
    expect(sourceOf('notes.docx', new Uint8Array([1, 2, 3]))).toBeNull()
  })
  it('reads a generated XLSX sheet by sheet', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Product', 'Carrier', 'Jan', 'Feb'], ['Life', 'Test Carrier A', 1000, 2000]]), 'Plan')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(sourceOf('plan.xlsx', bytes)).toBe('xlsx')
    const tables = tablesFrom('xlsx', bytes)
    expect(tables[0].name).toBe('Plan')
    const r = readPlanTable(tables[0])
    expect(r.rows.find((x) => x.month === 2)?.premium).toBe(2000)
  })
})

describe('Google Sheets link', () => {
  const link = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42'
  const res = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers })
  it('builds the CSV export URL with the tab', () => {
    const u = sheetCsvUrl(link)
    expect(u).toContain('/export?format=csv')
    expect(u).toContain('gid=42')
    expect(sheetCsvUrl('https://example.com/x')).toBeNull()
  })
  it('returns the CSV of a public sheet', async () => {
    const f = (async () => res(200, 'Product,Carrier\nLife,A', { 'content-type': 'text/csv' })) as unknown as typeof fetch
    await expect(fetchSheetCsv(link, f)).resolves.toContain('Life,A')
  })
  it.each([
    ['a redirect to Google sign-in', () => res(302, '', { location: 'https://accounts.google.com/ServiceLogin?continue=x' })],
    ['a 403', () => res(403, 'no')],
    ['an HTML page', () => res(200, '<!DOCTYPE html><html>sign in</html>', { 'content-type': 'text/html' })],
  ])('says to share it on %s', async (_label, make) => {
    const f = (async () => make()) as unknown as typeof fetch
    const p = fetchSheetCsv(link, f)
    await expect(p).rejects.toBeInstanceOf(SheetLinkError)
    await expect(fetchSheetCsv(link, f)).rejects.toThrow(PRIVATE_SHEET)
  })
})
