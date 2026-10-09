// Tiny in-memory stand-in for the Supabase query builder: just enough of
// select/eq/is/in/not/gte/neq/or/order/limit/maybeSingle/update/insert for
// the mailbox-access tests to run the real code against real-looking rows.

type Row = Record<string, unknown>
type Pred = (r: Row) => boolean

export type FakeDb = {
  tables: Record<string, Row[]>
  writes: Array<{ table: string; op: 'update' | 'insert'; values: Row; matched: number }>
  from: (table: string) => unknown
}

export function makeFakeDb(tables: Record<string, Row[]>): FakeDb {
  const db: FakeDb = { tables, writes: [], from: () => null }

  function builder(table: string) {
    const preds: Pred[] = []
    let op: 'select' | 'update' | 'insert' = 'select'
    let values: Row = {}
    let lim = Infinity
    let order: { col: string; asc: boolean } | null = null
    let head = false

    const rows = () => (db.tables[table] ??= [])
    const run = () => {
      if (op === 'insert') {
        rows().push({ ...values })
        db.writes.push({ table, op, values, matched: 1 })
        return { data: null, error: null }
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)))
      if (op === 'update') {
        hit.forEach((r) => Object.assign(r, values))
        db.writes.push({ table, op, values, matched: hit.length })
        return { data: null, error: null }
      }
      let out = [...hit]
      if (order) {
        const { col, asc } = order
        out.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1))
      }
      out = out.slice(0, lim)
      return head ? { data: null, count: out.length, error: null } : { data: out, count: out.length, error: null }
    }

    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => {
        if (o?.head) head = true
        return b
      },
      update: (v: Row) => {
        op = 'update'
        values = v
        return b
      },
      insert: (v: Row) => {
        op = 'insert'
        values = v
        return b
      },
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), b),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), b),
      gte: (c: string, v: string) => (preds.push((r) => r[c] != null && String(r[c]) >= v), b),
      not: (c: string, _o: string, list: string) => {
        const vals = list.replace(/[()"]/g, '').split(',')
        preds.push((r) => !vals.includes(String(r[c])))
        return b
      },
      or: () => b,
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((lim = n), b),
      maybeSingle: async () => {
        const r = run() as { data: Row[] | null }
        return { data: r.data?.[0] ?? null, error: null }
      },
      single: async () => {
        const r = run() as { data: Row[] | null }
        return { data: r.data?.[0] ?? null, error: null }
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }

  db.from = (table: string) => builder(table)
  return db
}
