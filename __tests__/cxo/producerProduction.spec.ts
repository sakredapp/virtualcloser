/**
 * Producer (agent) production for Ciao (QA gap #1, 2026-10-18):
 *   - the pure math: periods, ranking, slipping, new producers, detail lookup;
 *   - who may read the book (lib/book/access): any executive member of the
 *     tenant, never an employee login or an assistant; which book comes from
 *     the Pinnacle allow-list env, not a hard-coded account;
 *   - a tenant off the allow-list never reads a pinnacle_* table;
 *   - the tool says "not set up" on an empty book and is exec-only;
 *   - the recurring production report kind.
 * Everything is mocked: no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Supabase mock: records every table/RPC and answers from `answers` ──────
type Row = Record<string, unknown>
const touched: string[] = []
const answers: { rpc: Record<string, (args: Row) => Row[]>; count: number; lastDay: string | null; pinnacleLastDay: string | null } = {
  rpc: {},
  count: 0,
  lastDay: null,
  pinnacleLastDay: null,
}
function query(table: string) {
  let head = false
  const q: Record<string, unknown> = {}
  const self = new Proxy(q, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => void) => {
          if (table === 'cxo_book_producers') return res({ data: null, count: answers.count, error: null })
          if (table === 'cxo_book_policies') return res({ data: answers.lastDay ? [{ submitted_on: answers.lastDay }] : [], error: null })
          if (table === 'pinnacle_dim_rollup') return res({ data: answers.pinnacleLastDay ? [{ d: answers.pinnacleLastDay }] : [], error: null })
          return res({ data: [], error: null })
        }
      }
      return (...args: unknown[]) => {
        if (prop === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true
        void head
        return self
      }
    },
  })
  return self
}
/** A PostgREST rpc result: awaitable, and chainable (.select/.order/.range) like the real builder. */
function rpcResult(res: { data: unknown; error: null }) {
  const self: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad),
  }
  for (const m of ['select', 'order', 'range', 'limit']) self[m] = () => self
  return self
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => {
      touched.push(`from:${t}`)
      return query(t)
    },
    rpc: (fn: string, args: Row) => {
      touched.push(`rpc:${fn}`)
      const f = answers.rpc[fn]
      return rpcResult({ data: f ? f(args) : [], error: null })
    },
  },
}))

import {
  findProducer,
  metricValue,
  newProducers,
  rankOf,
  rankProducers,
  resolvePeriod,
  slippingProducers,
  totals,
  type ProducerRow,
} from '@/lib/book/production'
import { bookSourceFor, canSeeBook } from '@/lib/book/access'
import { productionReportText, reportPeriod } from '@/lib/book/report'
import { authorizeToolCall, EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { CXO_PRODUCER_TOOL_HANDLERS, PRODUCER_PRODUCTION_TOOL } from '@/lib/agent/cxoProducerTool'
import { CAPABILITIES, routingHintsFor } from '@/lib/agent/cxoCatalog'
import { EMPLOYEE_REPORT_KINDS, REPORT_KINDS, asReportKind, buildReport } from '@/lib/ops/reportsShared'

const row = (name: string, o: Partial<ProducerRow> = {}): ProducerRow => ({
  name,
  team: 'Demo Agency',
  premium: 0,
  funded: 0,
  policies: 0,
  paid: 0,
  declined: 0,
  lapsed: 0,
  pending: 0,
  firstPolicy: '2025-01-05',
  contractedAt: null,
  status: null,
  ...o,
})

const ENV = process.env.PINNACLE_VIEWER_REP_IDS
beforeEach(() => {
  touched.length = 0
  answers.rpc = {}
  answers.count = 0
  answers.lastDay = null
  answers.pinnacleLastDay = null
  delete process.env.PINNACLE_VIEWER_REP_IDS
})
afterEach(() => {
  if (ENV === undefined) delete process.env.PINNACLE_VIEWER_REP_IDS
  else process.env.PINNACLE_VIEWER_REP_IDS = ENV
})

describe('periods', () => {
  it('month to date compares with the same days last month', () => {
    const p = resolvePeriod('mtd', '2026-10-18')
    expect([p.start, p.end]).toEqual(['2026-10-01', '2026-10-18'])
    expect(p.prior).toEqual({ start: '2026-09-01', end: '2026-09-18' })
  })
  it('clamps the prior day to a shorter month', () => {
    expect(resolvePeriod('mtd', '2026-03-31').prior).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
  it('last month, quarter to date, last quarter, year to date', () => {
    const lm = resolvePeriod('last_month', '2026-01-10')
    expect([lm.start, lm.end, lm.prior.start, lm.prior.end]).toEqual(['2025-12-01', '2025-12-31', '2025-11-01', '2025-11-30'])
    const q = resolvePeriod('qtd', '2026-10-18')
    expect([q.start, q.prior.start, q.prior.end]).toEqual(['2026-10-01', '2026-07-01', '2026-07-18'])
    const lq = resolvePeriod('last_quarter', '2026-10-18')
    expect([lq.start, lq.end, lq.prior.start, lq.prior.end]).toEqual(['2026-07-01', '2026-09-30', '2026-04-01', '2026-06-30'])
    const y = resolvePeriod('ytd', '2026-10-18')
    expect([y.start, y.prior.start, y.prior.end]).toEqual(['2026-01-01', '2025-01-01', '2025-10-18'])
  })
  it('rolling and custom windows are back to back with equal length', () => {
    const r = resolvePeriod('last_30', '2026-10-18')
    expect([r.start, r.prior.start, r.prior.end]).toEqual(['2026-09-19', '2026-08-20', '2026-09-18'])
    const c = resolvePeriod('custom', '2026-10-18', { start: '2026-09-01', end: '2026-09-10' })
    expect([c.start, c.end, c.prior.start, c.prior.end]).toEqual(['2026-09-01', '2026-09-10', '2026-08-22', '2026-08-31'])
    expect(resolvePeriod('custom', '2026-10-18', { start: 'bad' }).key).toBe('mtd')
  })
})

describe('ranking and figures', () => {
  const rows = [
    row('Avery Sampleton', { premium: 50000, funded: 30000, policies: 20, paid: 15, lapsed: 1 }),
    row('Blake Mockridge', { premium: 80000, funded: 20000, policies: 10, paid: 4 }),
    row('Casey Testwell', { premium: 9000, funded: 9000, policies: 3, paid: 3 }),
    row('Dana Idle'),
  ]
  it('ranks by submitted AP by default, best first, skipping producers with nothing written', () => {
    const { ranked, considered } = rankProducers(rows, 'submitted_ap')
    expect(ranked.map((r) => r.name)).toEqual(['Blake Mockridge', 'Avery Sampleton', 'Casey Testwell'])
    expect(considered).toBe(3)
    expect(ranked[0]).toMatchObject({ rank: 1, submitted_ap: 80000, issued_ap: 20000, placement_pct: 40 })
  })
  it('rates skip producers with too few applications to judge', () => {
    const { ranked, skipped_small } = rankProducers(rows, 'placement')
    expect(ranked.map((r) => r.name)).toEqual(['Avery Sampleton', 'Blake Mockridge'])
    expect(skipped_small).toBe(1)
    expect(rankProducers(rows, 'placement', { order: 'bottom' }).ranked[0].name).toBe('Blake Mockridge')
  })
  it('placement = issued / written; persistency = issued not lapsed', () => {
    expect(metricValue(rows[0], 'placement')).toBe(75)
    expect(metricValue(rows[0], 'persistency')).toBe(93.8)
    const t = totals(rows)
    expect(t).toMatchObject({ producers_writing: 3, submitted_ap: 139000, issued_ap: 59000, applications: 33, issued: 22, placement_pct: 66.7 })
  })
  it('finds one producer by partial or exact name, else returns candidates', () => {
    expect(findProducer(rows, 'avery').match?.name).toBe('Avery Sampleton')
    expect(findProducer(rows, 'BLAKE MOCKRIDGE').match?.name).toBe('Blake Mockridge')
    expect(findProducer(rows, 'a').candidates.length).toBeGreaterThan(1)
    expect(findProducer(rows, 'nobody').match).toBeNull()
    expect(rankOf(rows, 'Avery Sampleton')).toEqual({ rank: 2, of: 3 })
  })
})

describe('slipping and new producers', () => {
  it('flags a big AP drop and a producer who went quiet, biggest dollar drop first', () => {
    const prior = [
      row('Avery Sampleton', { premium: 40000, policies: 12 }),
      row('Blake Mockridge', { premium: 20000, policies: 8 }),
      row('Casey Testwell', { premium: 3000, policies: 2 }),
      row('Emery Steady', { premium: 10000, policies: 5 }),
    ]
    const now = [
      row('Avery Sampleton', { premium: 22000, policies: 7 }),
      row('Casey Testwell', { premium: 1000, policies: 1 }),
      row('Emery Steady', { premium: 9500, policies: 5 }),
    ]
    const { slipping, went_quiet } = slippingProducers(now, prior)
    expect(slipping.map((s) => s.name)).toEqual(['Blake Mockridge', 'Avery Sampleton'])
    expect(slipping[1]).toMatchObject({ now_submitted_ap: 22000, prior_submitted_ap: 40000, ap_change_pct: -45 })
    expect(went_quiet).toBe(1)
  })
  it('new = contracted in the window or first business in it', () => {
    const win = { start: '2026-08-01', end: '2026-10-18' }
    const out = newProducers(
      [
        row('Old Hand', { firstPolicy: '2024-01-01', contractedAt: '2023-12-01', policies: 5 }),
        row('Fresh Contract', { firstPolicy: null, contractedAt: '2026-09-15' }),
        row('First Deal', { firstPolicy: '2026-08-20', policies: 2, premium: 4000 }),
      ],
      win,
    )
    expect(out.map((r) => [r.name, r.new_because])).toEqual([
      ['Fresh Contract', 'contracted'],
      ['First Deal', 'first_business'],
    ])
  })
})

describe('who may read the book', () => {
  const cxo = { id: 'rep_any_cxo', brand: 'cxo' }
  it('any executive member, never an employee login or an assistant', () => {
    for (const role of ['owner', 'admin', 'manager']) expect(canSeeBook({ role }, cxo), role).toBe(true)
    for (const role of ['rep', 'observer']) expect(canSeeBook({ role }, cxo), role).toBe(false)
    expect(canSeeBook({ role: 'assistant' }, cxo)).toBe(false)
    expect(canSeeBook({ role: 'owner', acting_assistant: { id: 'a1' } }, cxo)).toBe(false)
    expect(canSeeBook(null, cxo)).toBe(false)
  })
  it('the Pinnacle book follows the allow-list env, not one hard-coded account', () => {
    expect(bookSourceFor('rep_store_review_pinnacle')).toBe('tenant')
    expect(bookSourceFor('rep_other')).toBe('tenant')
    process.env.PINNACLE_VIEWER_REP_IDS = 'rep_new_imo, rep_other'
    expect(bookSourceFor('rep_new_imo')).toBe('pinnacle')
    expect(bookSourceFor('rep_other')).toBe('pinnacle')
    // Every leader on an allowed tenant, whatever their role title.
    for (const role of ['owner', 'admin', 'manager']) expect(canSeeBook({ role }, { id: 'rep_new_imo', brand: 'cxo' })).toBe(true)
  })
  it('the tool is exec-only in the executor and offered with routing', () => {
    expect(EMPLOYEE_TOOLS).not.toContain('producer_production')
    expect(authorizeToolCall('producer_production', { selfOnly: true })).not.toBeNull()
    expect(authorizeToolCall('producer_production', { selfOnly: false })).toBeNull()
    expect(CAPABILITIES.some((c) => c.tools?.includes('producer_production'))).toBe(true)
    expect(routingHintsFor(['producer_production']).join(' ')).toMatch(/producer_production/)
    expect(PRODUCER_PRODUCTION_TOOL.name).toBe('producer_production')
  })
})

// ── The tool handler ────────────────────────────────────────────────────────
const handler = CXO_PRODUCER_TOOL_HANDLERS.producer_production
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    tenant: { id: 'rep_store_review_pinnacle', brand: 'cxo', timezone: 'America/New_York' },
    caller: { id: 'm1', role: 'owner' },
    timezone: 'America/New_York',
    todayIso: '2026-10-18',
    ownerMemberId: 'm1',
    ...over,
  }) as never
const parse = async (p: Promise<{ text: string }>) => JSON.parse((await p).text)

describe('producer_production tool', () => {
  it('refuses an employee and an assistant before reading anything', async () => {
    expect((await parse(handler(ctx({ selfOnly: true }), {}))).ok).toBe(false)
    expect((await parse(handler(ctx({ caller: { id: 'a', role: 'assistant' } }), {}))).ok).toBe(false)
    expect(touched).toEqual([])
  })
  it('says not set up when the tenant has no book, and reads no pinnacle table', async () => {
    const out = await parse(handler(ctx({ tenant: { id: 'rep_other', brand: 'cxo' } }), {}))
    expect(out).toMatchObject({ has_data: false, not_set_up: true })
    expect(out.say).toMatch(/No producer book is connected/)
    expect(touched.filter((t) => t.includes('pinnacle'))).toEqual([])
  })
  it('ranks the tenant book from its own RPC, scoped to the tenant', async () => {
    answers.count = 3
    answers.lastDay = '2026-10-17'
    const seen: Row[] = []
    answers.rpc.cxo_book_producer_production = (a) => {
      seen.push(a)
      return [
        { label: 'Avery Sampleton', team: 'Demo North', premium: '12000', funded: '8000', policies: 6, paid: 4, declined: 1, lapsed: 0, pending: 1, first_policy: '2025-02-01' },
        { label: 'Blake Mockridge', team: 'Demo South', premium: '30000', funded: '0', policies: 3, paid: 0, declined: 0, lapsed: 0, pending: 3, first_policy: '2025-03-01' },
      ]
    }
    const out = await parse(handler(ctx(), { view: 'rank', metric: 'submitted_ap' }))
    expect(out.has_data).toBe(true)
    expect(out.ranked.map((r: { name: string }) => r.name)).toEqual(['Blake Mockridge', 'Avery Sampleton'])
    expect(out.data_through).toBe('2026-10-17')
    expect(seen[0]).toMatchObject({ p_rep_id: 'rep_store_review_pinnacle', p_start: '2026-10-01', p_end: '2026-10-18', p_line: 'All' })
    expect(touched.filter((t) => t.includes('pinnacle_'))).toEqual([])
  })
  it('an allow-listed tenant reads the Pinnacle agent rollup', async () => {
    process.env.PINNACLE_VIEWER_REP_IDS = 'rep_imo'
    answers.pinnacleLastDay = '2026-10-17'
    answers.rpc.pinnacle_producer_production = () => [{ label: 'Agent One', team: 'T', premium: 100, funded: 50, policies: 1, paid: 1, declined: 0, lapsed: 0, pending: 0 }]
    const out = await parse(handler(ctx({ tenant: { id: 'rep_imo', brand: 'cxo' }, caller: { id: 'x', role: 'manager' } }), {}))
    expect(out.ranked[0].name).toBe('Agent One')
    expect(touched).toContain('rpc:pinnacle_producer_production')
  })
})

describe('recurring production report', () => {
  it('is a report kind for executives only', () => {
    expect(REPORT_KINDS).toContain('production')
    expect(asReportKind('production')).toBe('production')
    expect(EMPLOYEE_REPORT_KINDS.has('production')).toBe(false)
    expect(buildReport({ kind: 'production', items: [], members: [], memberId: 'm', companyWide: true, now: new Date(), tz: 'UTC' })).toBeNull()
  })
  it('uses last month in the first days of a month, else month to date', () => {
    expect(reportPeriod('2026-10-02').key).toBe('last_month')
    expect(reportPeriod('2026-10-18').key).toBe('mtd')
  })
  it('writes totals, top producers and who is slipping; nothing when nothing was written', () => {
    const p = resolvePeriod('mtd', '2026-10-18')
    const r = productionReportText(p, [row('Avery Sampleton', { premium: 20000, funded: 10000, policies: 6, paid: 3 })], [row('Avery Sampleton', { premium: 40000, policies: 12 })], '2026-10-17')
    expect(r?.title).toBe('Producer production: $20,000 submitted AP')
    expect(r?.body).toMatch(/down 50% vs the same days last month/)
    expect(r?.body).toMatch(/Top producers/)
    expect(r?.body).toMatch(/Slipping vs/)
    expect(productionReportText(p, [], [], null)).toBeNull()
  })
})
