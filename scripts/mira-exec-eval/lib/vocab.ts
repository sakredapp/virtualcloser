/**
 * Vocabulary the generator combines: periods, product lines, dimensions,
 * entity names, openers/closers. Every period carries its ground-truth
 * window so the grader can compute the real number.
 */
import type { LineFilter, WindowInput } from './types'
import type { BreakdownDim } from './types'

/** The bank is generated for this "today"; relative windows resolve at grade time. */
export const BANK_TODAY = '2026-10-08'
export const BANK_YEAR = 2026

export type Period = {
  key: string
  window: WindowInput
  /** Phrasings an exec would use. */
  say: string[]
  /** Canonical label the answer should name (one of these substrings must appear). */
  label: string[]
  /** True when the window is a complete past month/quarter (so "pace" questions make no sense). */
  closed: boolean
  /** 2025 / last-year windows — the mirror has no rows; expected refusal. */
  missing?: boolean
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthWindow(y: number, m: number): { start: string; end: string } {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

function monthPeriod(y: number, m: number, opts: { missing?: boolean } = {}): Period {
  const name = MONTHS[m - 1]
  const short = SHORT[m - 1]
  const yr = y === BANK_YEAR ? '' : ` ${y}`
  return {
    key: `${y}-${String(m).padStart(2, '0')}`,
    window: monthWindow(y, m),
    say: [`in ${name}${yr}`, `for ${name}${yr}`, `${name}${yr}`, `in ${short}${yr}`, `for the month of ${name}${yr}`, `during ${name}${yr}`],
    label: [name.toLowerCase(), short.toLowerCase()],
    closed: true,
    missing: opts.missing,
  }
}

function quarterPeriod(y: number, q: number, opts: { missing?: boolean } = {}): Period {
  const m0 = (q - 1) * 3 + 1
  const w = { start: monthWindow(y, m0).start, end: monthWindow(y, m0 + 2).end }
  const yr = y === BANK_YEAR ? '' : ` ${y}`
  return {
    key: `${y}-Q${q}`,
    window: w,
    say: [`in Q${q}${yr}`, `for Q${q}${yr}`, `Q${q}${yr}`, `in the ${['first', 'second', 'third', 'fourth'][q - 1]} quarter${yr}`],
    label: [`q${q}`, `${['first', 'second', 'third', 'fourth'][q - 1]} quarter`],
    closed: true,
    missing: opts.missing,
  }
}

export const RELATIVE_PERIODS: Period[] = [
  { key: 'mtd', window: 'mtd', say: ['this month', 'so far this month', 'month to date', 'MTD', 'in October so far', 'this month so far'], label: ['this month', 'month to date', 'mtd', 'october', 'oct'], closed: false },
  { key: 'last_month', window: 'last_month', say: ['last month', 'in September', 'for September', 'the month that just closed', 'Sept'], label: ['last month', 'september', 'sept', 'sep'], closed: true },
  { key: 'qtd', window: 'qtd', say: ['this quarter', 'quarter to date', 'QTD', 'in Q4 so far', 'so far this quarter'], label: ['this quarter', 'quarter to date', 'qtd', 'q4'], closed: false },
  { key: 'ytd', window: 'ytd', say: ['year to date', 'YTD', 'this year', 'so far in 2026', 'for 2026 so far', 'so far this year'], label: ['year to date', 'ytd', 'this year', '2026'], closed: false },
  { key: '3m', window: '3m', say: ['over the last 3 months', 'in the last three months', 'trailing 3 months', 'the past 3 months', 'over the last 90 days'], label: ['3 month', 'three month', '90 day', 'last 3', 'trailing 3'], closed: false },
  { key: '6m', window: '6m', say: ['over the last 6 months', 'in the last six months', 'trailing 6 months', 'the past 6 months', 'over the last half year'], label: ['6 month', 'six month', 'last 6', 'trailing 6', 'half year'], closed: false },
  { key: '12m', window: '12m', say: ['over the last 12 months', 'in the last twelve months', 'trailing 12 months', 'the past year', 'over the last 12 mo', 'TTM'], label: ['12 month', 'twelve month', 'last 12', 'trailing 12', 'past year', 'ttm'], closed: false },
]

export const MONTH_PERIODS_2026: Period[] = Array.from({ length: 9 }, (_, i) => monthPeriod(2026, i + 1))
export const QUARTER_PERIODS_2026: Period[] = [quarterPeriod(2026, 1), quarterPeriod(2026, 2), quarterPeriod(2026, 3)]

export const RANGE_PERIODS: Period[] = [
  { key: 'r1', window: { start: '2026-03-01', end: '2026-04-15' }, say: ['from March 1 to April 15', 'between Mar 1 and Apr 15'], label: ['march 1', 'mar 1', 'april 15', 'apr 15'], closed: true },
  { key: 'r2', window: { start: '2026-06-10', end: '2026-06-30' }, say: ['from June 10 through June 30', 'between June 10 and June 30'], label: ['june 10', 'jun 10', 'june 30'], closed: true },
  { key: 'r3', window: { start: '2026-08-01', end: '2026-08-14' }, say: ['in the first two weeks of August', 'from Aug 1 to Aug 14'], label: ['august', 'aug'], closed: true },
  { key: 'r4', window: { start: '2026-01-01', end: '2026-06-30' }, say: ['in the first half of 2026', 'for H1 2026', 'from January through June'], label: ['first half', 'h1', 'january', 'jan', 'june'], closed: true },
  { key: 'r5', window: { start: '2026-09-01', end: '2026-09-15' }, say: ['in the first half of September', 'from Sept 1 to Sept 15'], label: ['september', 'sept', 'sep'], closed: true },
  { key: 'r6', window: { start: '2026-05-15', end: '2026-07-15' }, say: ['from mid-May to mid-July', 'between May 15 and July 15'], label: ['may', 'july', 'jul'], closed: true },
  { key: 'r7', window: { start: '2026-09-28', end: '2026-10-08' }, say: ['over the last 10 days', 'in the past 10 days'], label: ['10 day', 'ten day', 'last 10'], closed: false },
  { key: 'r8', window: { start: '2026-10-01', end: '2026-10-07' }, say: ['in the first week of October', 'from Oct 1 to Oct 7'], label: ['october', 'oct', 'first week'], closed: true },
]

/** Periods the mirror has no rows for. The right answer says so plainly. */
export const MISSING_PERIODS: Period[] = [
  { key: 'last_year', window: 'last_year', say: ['last year', 'in 2025', 'for 2025', 'for calendar 2025', 'for all of last year'], label: ['2025', 'last year'], closed: true, missing: true },
  monthPeriod(2025, 9, { missing: true }),
  monthPeriod(2025, 10, { missing: true }),
  monthPeriod(2025, 12, { missing: true }),
  monthPeriod(2025, 1, { missing: true }),
  monthPeriod(2025, 6, { missing: true }),
  quarterPeriod(2025, 4, { missing: true }),
  quarterPeriod(2025, 3, { missing: true }),
  { key: '2024', window: { start: '2024-01-01', end: '2024-12-31' }, say: ['in 2024', 'for 2024', 'two years ago'], label: ['2024'], closed: true, missing: true },
  { key: 'ly_same', window: { start: '2025-10-01', end: '2025-10-08' }, say: ['this time last year', 'the same period last year', 'same point last year'], label: ['last year', '2025'], closed: true, missing: true },
]

export const ALL_DATA_PERIODS: Period[] = [...RELATIVE_PERIODS, ...MONTH_PERIODS_2026, ...QUARTER_PERIODS_2026, ...RANGE_PERIODS]

export type Line = { key: LineFilter; say: string[]; label: string[] }
export const LINES: Line[] = [
  { key: 'All', say: ['', '', '', 'overall', 'across all lines', 'company-wide', 'total'], label: [] },
  { key: 'Health', say: ['on the health side', 'for health', 'in health', 'health', 'for the health line', 'on health'], label: ['health'] },
  { key: 'Life', say: ['on the life side', 'for life', 'in life', 'life', 'for the life line', 'on life insurance'], label: ['life'] },
  { key: 'Annuity', say: ['for annuities', 'in annuity', 'annuity', 'on the annuity side', 'for the annuity line'], label: ['annuit'] },
]

export type Dim = { key: BreakdownDim; one: string[]; many: string[] }
export const DIMS: Dim[] = [
  { key: 'team', one: ['team', 'agency', 'agency'], many: ['teams', 'agencies', 'agencies'] },
  { key: 'agent', one: ['agent', 'producer', 'rep', 'writing agent'], many: ['agents', 'producers', 'reps', 'writing agents'] },
  { key: 'carrier', one: ['carrier', 'carrier', 'insurance company'], many: ['carriers', 'carriers', 'insurance companies'] },
  { key: 'state', one: ['state'], many: ['states'] },
  { key: 'product', one: ['product', 'product'], many: ['products', 'product names'] },
]

export const OPENERS = ['', '', '', '', '', 'Mira, ', 'Hey Mira, ', 'Quick one — ', 'Quick question: ', 'Can you tell me ', 'I need to know ', 'Pull up ', 'Give me ', 'Remind me — ', 'Before the board call, ']
export const CLOSERS = ['', '', '', '?', '?', ' please', ', thanks', '.']

/** Invented entities — the correct answer must say they are not in the data. */
export const FAKE_ENTITIES: Array<{ dim: 'agent' | 'carrier' | 'team' | 'state'; name: string }> = [
  { dim: 'team', name: 'Team Zephyr' },
  { dim: 'team', name: 'Blue Harbor Agency' },
  { dim: 'team', name: 'the Northstar team' },
  { dim: 'team', name: 'Summit Peak Financial' },
  { dim: 'team', name: 'the Lakeside agency' },
  { dim: 'agent', name: 'Marcus Fakewell' },
  { dim: 'agent', name: 'Priya Nonexistant' },
  { dim: 'agent', name: 'Tom Placeholder' },
  { dim: 'agent', name: 'Dana Imaginary' },
  { dim: 'carrier', name: 'Olympus Mutual' },
  { dim: 'carrier', name: 'Granite Shield Life' },
  { dim: 'carrier', name: 'Acme Assurance' },
  { dim: 'state', name: 'Guam' },
  { dim: 'state', name: 'Ontario' },
]

/** Plausible real entities. generate.ts --from-db replaces these with the top names in the mirror. */
export type EntityList = { source: 'placeholder' | 'db'; team: string[]; agent: string[]; carrier: string[]; state: string[]; product: string[] }
export const PLACEHOLDER_ENTITIES: EntityList = {
  source: 'placeholder',
  team: ['East Team', 'West Team'],
  agent: [],
  carrier: ['Transamerica', 'Foresters', 'Mutual of Omaha', 'Americo', 'Aetna', 'Athene', 'Ethos'],
  state: ['Texas', 'Florida', 'California', 'Georgia', 'Ohio', 'Arizona', 'North Carolina', 'Pennsylvania', 'Michigan', 'Tennessee'],
  product: [],
}
