import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny chainable stand-in for supabase: every call chains, awaiting gives the table's canned result.
type Result = { data: unknown; error: unknown; count?: number | null }
const tables: Record<string, Result | ((ops: Array<[string, unknown[]]>) => Result)> = {}
const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = []
function chain(table: string) {
  const ops: Array<[string, unknown[]]> = []
  calls.push({ table, ops })
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'lt', 'order', 'limit', 'upsert', 'update', 'maybeSingle']) {
    c[m] = (...a: unknown[]) => (ops.push([m, a]), c)
  }
  c.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => {
    const t = tables[table]
    const r = typeof t === 'function' ? t(ops) : t ?? { data: [], error: null }
    return Promise.resolve(r).then(res, rej)
  }
  return c
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
const inserted: unknown[][] = []
vi.mock('@/lib/followups/engine', () => ({ insertNotices: async (rows: unknown[]) => (inserted.push(rows), rows.map((r, i) => ({ ...(r as object), id: `n${i}` }))) }))

import { runBoardUpdateTick } from '@/lib/boardUpdate/data'

const MON_9AM_NY = new Date('2026-11-02T14:00:00Z') // first business day of November, 9am EST

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  calls.length = 0
  inserted.length = 0
  tables.reps = { data: [{ id: 'rep_t', brand: 'cxo', timezone: 'America/New_York', company: 'Acme Co', display_name: 'Acme' }], error: null }
  tables.members = {
    data: [
      { id: 'owner1', role: 'owner', settings: {} },
      { id: 'admin1', role: 'admin', settings: {} },
      { id: 'admin2', role: 'admin', settings: { can_view_comp: false } },
    ],
    error: null,
  }
})

describe('board update tick', () => {
  it('drafts last month and tells the owner and money admins once', async () => {
    tables.cxo_board_updates = (ops) => {
      const up = ops.find((o) => o[0] === 'upsert')
      if (!up) return { data: [], error: null }
      const row = (up[1][0] as Array<Record<string, unknown>>)[0]
      return { data: [{ id: 'bu1', ...row }], error: null }
    }
    tables.cxo_goals = (ops) => (ops.some((o) => o[0] === 'eq' && o[1][1] === 'done') ? { data: [{ title: 'Hire a VP Sales' }], error: null } : { data: [], error: null })
    tables.cxo_qbo_pnl_monthly = { data: [{ month: '2026-10', income: 50000, cogs: 0, gross_profit: 50000, expenses: 40000, other_income: 0, other_expenses: 0, net_income: 10000 }], error: null }

    const r = await runBoardUpdateTick(MON_9AM_NY)
    expect(r).toEqual({ tenants: 1, drafted: 1, notices: 2, errors: 0 })
    const up = calls.find((c) => c.table === 'cxo_board_updates' && c.ops.some((o) => o[0] === 'upsert'))!
    const row = (up.ops.find((o) => o[0] === 'upsert')![1][0] as Array<Record<string, unknown>>)[0]
    expect(row.rep_id).toBe('rep_t')
    expect(row.month).toBe('2026-10')
    expect(String(row.body)).toContain('Revenue in Oct: $50,000')
    expect(String(row.body)).toContain('Goals reached: Hire a VP Sales.')
    const notices = inserted[0] as Array<Record<string, unknown>>
    expect(notices.map((n) => n.member_id)).toEqual(['owner1', 'admin1'])
    expect(notices[0].key).toBe('board-update-2026-10-owner1')
    expect(notices[0].href).toBe('/dashboard#board-update')
    // Every read is scoped to the tenant.
    for (const c of calls.filter((c) => c.table.startsWith('cxo_') || c.table === 'members')) {
      expect(c.ops.some((o) => (o[0] === 'eq' && o[1][0] === 'rep_id' && o[1][1] === 'rep_t') || o[0] === 'upsert')).toBe(true)
    }

    // A second check in the same month does nothing.
    inserted.length = 0
    expect(await runBoardUpdateTick(new Date('2026-11-02T14:10:00Z'))).toEqual({ tenants: 1, drafted: 0, notices: 0, errors: 0 })
    expect(inserted).toEqual([])
  })

  it('nothing to say: no draft, no notice', async () => {
    tables.reps = { data: [{ id: 'rep_empty', brand: 'cxo', timezone: 'America/New_York', company: null, display_name: 'Empty' }], error: null }
    const r = await runBoardUpdateTick(MON_9AM_NY)
    expect(r).toEqual({ tenants: 1, drafted: 0, notices: 0, errors: 0 })
    expect(calls.some((c) => c.ops.some((o) => o[0] === 'upsert'))).toBe(false)
    expect(inserted).toEqual([])
  })

  it('not the first business day: no reads beyond the tenant list', async () => {
    tables.reps = { data: [{ id: 'rep_late', brand: 'cxo', timezone: 'America/New_York', company: null, display_name: 'Late' }], error: null }
    expect(await runBoardUpdateTick(new Date('2026-10-17T14:00:00Z'))).toEqual({ tenants: 1, drafted: 0, notices: 0, errors: 0 })
    expect(calls.map((c) => c.table)).toEqual(['reps'])
  })

  it('a missing table is a quiet no-op', async () => {
    tables.reps = { data: [{ id: 'rep_m', brand: 'cxo', timezone: 'America/New_York', company: null, display_name: 'M' }], error: null }
    tables.cxo_board_updates = { data: null, error: { code: 'PGRST205', message: 'missing' } }
    expect(await runBoardUpdateTick(MON_9AM_NY)).toEqual({ tenants: 1, drafted: 0, notices: 0, errors: 0 })
    expect(inserted).toEqual([])
  })

  it('a month-to-date draft saved mid-month is redrawn from the whole month', async () => {
    tables.reps = { data: [{ id: 'rep_mtd', brand: 'cxo', timezone: 'America/New_York', company: 'Acme Co', display_name: 'Acme' }], error: null }
    const saved = { id: 'bu-mtd', rep_id: 'rep_mtd', month: '2026-10', sections: { month: '2026-10', month_label: 'October 2026, month to date through Oct 19', headline: [], wins: [], misses: [], decisions: [], asks: [], sources: [], through: '2026-10-19', to_date: true }, draft_text: 'old', body: 'old', status: 'draft', edited: false, generated_at: '2026-10-19T12:00:00Z', edited_at: null, sent_at: null }
    tables.cxo_board_updates = (ops) => {
      const up = ops.find((o) => o[0] === 'update')
      if (up) return { data: [{ ...saved, ...(up[1][0] as Record<string, unknown>) }], error: null }
      return { data: [saved], error: null }
    }
    tables.cxo_qbo_pnl_monthly = { data: [{ month: '2026-10', income: 50000, cogs: 0, gross_profit: 50000, expenses: 40000, other_income: 0, other_expenses: 0, net_income: 10000 }], error: null }
    await runBoardUpdateTick(MON_9AM_NY)
    const upd = calls.find((c) => c.table === 'cxo_board_updates' && c.ops.some((o) => o[0] === 'update'))
    expect(upd).toBeTruthy()
    const patch = upd!.ops.find((o) => o[0] === 'update')![1][0] as { sections: { to_date?: boolean; month_label: string }; body: string }
    expect(patch.sections.to_date).toBeUndefined()
    expect(patch.sections.month_label).toBe('October 2026')
    expect(patch.body).not.toContain('month to date')
  })
})
