/**
 * The two App Store / Google Play review accounts (owner 2026-10-14).
 *
 *   review@suitecxo.com           → Suite CXO edition, tenant STORE_REVIEW.suite
 *   review-pinnacle@suitecxo.com  → Pinnacle edition,  tenant STORE_REVIEW.pinnacle
 *
 * Both orgs are invented: a made-up company, made-up people, made-up numbers.
 * Their to-dos, meetings, boards and team usage are ordinary rows in the
 * normal tables. The money is not: neither org has QuickBooks, and the
 * Pinnacle edition's org is NOT on the Pinnacle book allow-list (it must
 * never read Pinnacle Life Group's real book). So the phone app's Revenue /
 * Book tab is answered from the invented figures below for these two
 * tenants only.
 *
 * Background jobs skip both tenants (lib/tenant.ts getAllActiveTenants), so
 * nobody is emailed and no scheduled AI runs on them.
 */
import { pinnacleAllowed } from '@/lib/pinnacle/access'

export const STORE_REVIEW = {
  suite: 'rep_store_review',
  pinnacle: 'rep_store_review_pinnacle',
} as const

export function isStoreReviewTenant(tenantId: string | null | undefined): boolean {
  return tenantId === STORE_REVIEW.suite || tenantId === STORE_REVIEW.pinnacle
}

/** The Pinnacle Life Group edition: the real Pinnacle org, or its review account. */
export function isPinnacleEdition(tenantId: string | null | undefined): boolean {
  return pinnacleAllowed(tenantId) || tenantId === STORE_REVIEW.pinnacle
}

/** What this org calls the product. The Pinnacle edition never shows "Suite CXO". */
export function productNameFor(tenantId: string | null | undefined): string {
  return isPinnacleEdition(tenantId) ? 'Pinnacle Life Group' : 'Suite CXO'
}

// ── Invented figures ────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** Suite CXO review org: 13 months of made-up books, same shape as /api/native/revenue 'books'. */
export function sampleBooks(now = new Date()) {
  const months = []
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const income = 182000 + (12 - i) * 6200 + (i % 3) * 9000
    const expenses = 121000 + (12 - i) * 2100 + (i % 4) * 5000
    months.push({
      month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      income,
      expenses,
      cogs: Math.round(income * 0.22),
      net_income: income - expenses,
      gross_profit: Math.round(income * 0.78),
    })
  }
  return {
    kind: 'books' as const,
    companyName: 'Northwind Partners',
    lastSyncAt: new Date(now.getTime() - 3 * 3600_000).toISOString(),
    needsReconnect: false,
    months,
    topCustomers: [
      { name: 'Bluebird Logistics', amount: 412000 },
      { name: 'Cedar & Pine Co.', amount: 268500 },
      { name: 'Harbor Dental Group', amount: 191200 },
      { name: 'Atlas Fitness', amount: 143900 },
      { name: 'Lumen Studio', amount: 98400 },
    ],
  }
}

/** Pinnacle edition review org: a made-up month to date, same shape as /api/native/revenue 'book'. */
export function sampleBook(now = new Date()) {
  const day = now.getDate()
  const scale = Math.max(1, day) / 14
  const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const yesterday = new Date(now.getTime() - 86_400_000)
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return {
    kind: 'book' as const,
    mtd: {
      premium: Math.round(1_284_600 * scale),
      issued: Math.round(842_300 * scale),
      policies: Math.round(612 * scale),
      monthName: now.toLocaleDateString('en-US', { month: 'long' }),
      monthShort: now.toLocaleDateString('en-US', { month: 'short' }),
      throughDay: day,
      dataThrough: ymd(yesterday),
      prior: {
        premium: Math.round(1_142_900 * scale),
        issued: Math.round(790_100 * scale),
        monthShort: prior.toLocaleDateString('en-US', { month: 'short' }),
      },
    },
  }
}

const AGENCIES = ['Summit Ridge Agency', 'Bright Harbor Group', 'Northgate Financial', 'Cobalt Peak Partners', 'Willow Creek Agency', 'Redwood Lane Advisors', 'Silver Birch Group', 'Lakeshore Benefits']
const PRODUCERS = ['Avery Collins', 'Jamie Ortega', 'Riley Chen', 'Taylor Brooks', 'Casey Morgan', 'Drew Patel', 'Quinn Harper', 'Rowan Blake']
const CARRIERS = ['Northfield Life', 'Harborline Mutual', 'Crestview Annuity', 'Evergreen Health', 'Bluewater Life', 'Granite State Life', 'Meridian Mutual', 'Aspen Annuity']

/** Pinnacle edition review org: made-up leaders, same shape as /api/pinnacle/breakdown rows. */
export function sampleBreakdown(dim: string, line: string, limit: number) {
  const k = line === 'Life' ? 0.46 : line === 'Health' ? 0.31 : line === 'Annuity' ? 0.23 : 1
  const [labels, top] = dim === 'team' ? [AGENCIES, 312_000] : dim === 'carrier' ? [CARRIERS, 401_000] : [PRODUCERS, 96_000]
  return labels.slice(0, limit).map((label, i) => {
    const premium = Math.round(top * k * Math.pow(0.78, i))
    const policies = Math.max(3, Math.round(premium / 2100))
    return {
      label,
      premium,
      policies,
      paid: Math.round(policies * 0.68),
      declined: Math.round(policies * 0.07),
      lapsed: Math.round(policies * 0.04),
      team: dim === 'agent' ? AGENCIES[i % AGENCIES.length] : null,
    }
  })
}
