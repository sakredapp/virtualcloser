/**
 * Company decision log (Suite CXO, Ciao): the reversal rules, the digest
 * hook's writes, the backfill tick, the in-app notice, and role scope.
 * Invented demo company only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let idSeq = 0

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'update' | 'upsert' = 'select'
  let patch: Row = {}
  let upRows: Row[] = []
  let conflict: string[] = []
  let order: { col: string; asc: boolean } | null = null
  let lim = Infinity
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op === 'upsert') {
      const out: Row[] = []
      for (const r of upRows) {
        if (rows().some((x) => conflict.every((c) => x[c] === r[c]))) continue
        const full = { id: `id-${++idSeq}`, reverses_id: null, reversed_by_id: null, reversal_reason: null, ...r }
        rows().push(full)
        out.push({ ...full })
      }
      return { data: out, error: null }
    }
    let list = rows().filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      for (const r of list) Object.assign(r, patch)
      return { data: null, error: null }
    }
    if (order) {
      const { col, asc } = order
      list = [...list].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1))
    }
    return { data: list.slice(0, lim).map((r) => ({ ...r })), error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
    gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
    lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), b),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), b),
    like: () => b,
    order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
    limit: (n: number) => ((lim = n), b),
    update: (p: Row) => ((op = 'update'), (patch = p), b),
    upsert: (rs: Row | Row[], o?: { onConflict?: string }) => {
      op = 'upsert'
      upRows = Array.isArray(rs) ? rs : [rs]
      conflict = (o?.onConflict ?? 'id').split(',')
      return b
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))
const noticeWrites: Array<Record<string, unknown>> = []
vi.mock('@/lib/followups/engine', () => ({
  insertNotices: vi.fn(async (rows: Array<Record<string, unknown>>) => {
    noticeWrites.push(...rows)
    return rows.map((r, i) => ({ ...r, id: `n-${i}` }))
  }),
}))

import {
  asDecided,
  contradiction,
  decisionsFromDigest,
  findReversal,
  matchScore,
  reversalNoticeKey,
  reversalNoticeText,
  shouldNotify,
} from '@/lib/decisions/shared'
import { listDecisions, recordDecisionsForNote, runDecisionLogTick } from '@/lib/decisions/log'
import { noticeKindsOr } from '@/lib/followups/notices'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import type { SearchScope } from '@/lib/knowledge/searchShared'

const REP = 'rep_demo'
const NOW = new Date('2026-10-17T15:00:00Z')

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  noticeWrites.length = 0
  idSeq = 0
  delete process.env.CXO_DECISION_LOG
})

describe('reversal rules (conservative)', () => {
  it('a later "stop / cancel / not" on the same thing is a reversal', () => {
    expect(contradiction('We will not launch the Brightwell pricing pilot', 'Launch the Brightwell pricing pilot in November')).toBeTruthy()
    expect(contradiction('Cancel the Brightwell pricing pilot', 'Go ahead with the Brightwell pricing pilot')).toBeTruthy()
  })
  it('opposite verbs on the same thing are a reversal', () => {
    expect(contradiction('Lower the referral bonus for partner agencies', 'Raise the referral bonus for partner agencies')).toMatch(/raise to lower/)
    expect(contradiction('Remove the evening shift from the support rota', 'Add an evening shift to the support rota')).toBeTruthy()
  })
  it('the same thing with a different value is a reversal', () => {
    expect(contradiction('Brightwell pricing pilot starts in December', 'Brightwell pricing pilot starts in November')).toMatch(/November to December/)
    expect(contradiction('Hold the board review on Monday', 'Hold the board review on Friday')).toMatch(/Friday to Monday/)
    expect(contradiction('Send the partner newsletter monthly', 'Send the partner newsletter weekly')).toBeTruthy()
  })
  it('a repeat, or a different topic, is never a reversal', () => {
    expect(contradiction('Launch the Brightwell pricing pilot in November', 'Brightwell pricing pilot launches in November')).toBeNull()
    expect(contradiction('Do not renew the office lease', 'Launch the Brightwell pricing pilot')).toBeNull()
    // One shared word is not enough.
    expect(contradiction('Stop the hiring freeze', 'Freeze the travel budget')).toBeNull()
    // Both negative = agreeing.
    expect(contradiction('We will not renew the office lease', 'Do not renew the office lease')).toBeNull()
  })
  it('findReversal: the most recent earlier decision from another meeting, inside the window', () => {
    const later = { id: 'd3', note_id: 'n3', text: 'Brightwell pricing pilot starts in December', decided_at: '2026-10-15T15:00:00Z' }
    const earlier = [
      { id: 'd1', note_id: 'n1', text: 'Brightwell pricing pilot starts in October', decided_at: '2026-08-01T15:00:00Z', meeting_title: 'Ops' },
      { id: 'd2', note_id: 'n2', text: 'Brightwell pricing pilot starts in November', decided_at: '2026-09-20T15:00:00Z', meeting_title: 'Ops' },
      { id: 'd9', note_id: 'n3', text: 'Brightwell pricing pilot starts in March', decided_at: '2026-10-15T15:00:00Z', meeting_title: 'Same meeting' },
      { id: 'd0', note_id: 'n0', text: 'Brightwell pricing pilot starts in June', decided_at: '2024-06-01T15:00:00Z', meeting_title: 'Too old' },
    ]
    expect(findReversal(later, earlier)?.target.id).toBe('d2')
  })
})

describe('reading a digest', () => {
  it('takes the strings, and who decided from `decided`', () => {
    expect(decisionsFromDigest({ decisions: ['Raise the referral bonus', 'x'], decided: [{ text: 'Raise the referral bonus', by: 'Dana' }] })).toEqual([{ idx: 0, text: 'Raise the referral bonus', by: 'Dana' }])
    expect(decisionsFromDigest(null)).toEqual([])
  })
  it('the model may answer with strings or {text, by}; "we" is nobody', () => {
    expect(asDecided(['Ship it', { text: 'Hire a closer', by: 'Sam' }, { text: 'Pause ads', by: 'we' }])).toEqual([
      { text: 'Ship it', by: null },
      { text: 'Hire a closer', by: 'Sam' },
      { text: 'Pause ads', by: null },
    ])
  })
})

describe('notice', () => {
  it('one key per reversal per member; text says now and before', () => {
    expect(reversalNoticeKey('d3', 'm1')).toBe('decision-reversed-d3-m1')
    const t = reversalNoticeText(
      { text: 'Pilot starts in December', decided_at: '2026-10-15T15:00:00Z', meeting_title: 'Leadership sync' },
      { text: 'Pilot starts in November', decided_at: '2026-09-20T15:00:00Z', meeting_title: 'Ops review' },
      'Changed from November to December.',
    )
    expect(t.title).toBe('Decision reversed: Pilot starts in December')
    expect(t.body).toContain('Now (Leadership sync, Oct 15)')
    expect(t.body).toContain('Before (Ops review, Sep 20)')
  })
  it('only recent reversals are announced', () => {
    expect(shouldNotify('2026-10-10T00:00:00Z', NOW)).toBe(true)
    expect(shouldNotify('2026-08-01T00:00:00Z', NOW)).toBe(false)
  })
  it('the notices rail shows them with the ops switch off', () => {
    expect(noticeKindsOr(['praise'])).toContain('key.like.decision-reversed-*')
  })
})

const note = (id: string, at: string, title: string, decisions: string[], extra: Row = {}) => ({
  id,
  rep_id: REP,
  title,
  occurred_at: at,
  owner_member_id: null,
  attendees: [],
  triage_class: null,
  mira_digest: { decisions },
  ...extra,
})

describe('recording and the backfill tick', () => {
  beforeEach(() => {
    db.reps = [{ id: REP, brand: 'cxo', is_active: true }]
    db.members = [
      { id: 'own-1', rep_id: REP, role: 'owner', is_active: true },
      { id: 'adm-1', rep_id: REP, role: 'admin', is_active: true },
      { id: 'rep-1', rep_id: REP, role: 'rep', is_active: true },
    ]
  })

  it('logs each decision once and flags a recent reversal to owner and admins only', async () => {
    db.plaud_notes = [note('n1', '2026-09-20T15:00:00Z', 'Ops review', ['Brightwell pricing pilot starts in November']), note('n2', '2026-10-15T15:00:00Z', 'Leadership sync', ['Brightwell pricing pilot starts in December', 'Hire two support leads'])]
    const r = await runDecisionLogTick(NOW)
    expect(r).toMatchObject({ notes: 2, inserted: 3, reversals: 1, notices: 2 })
    const later = db.cxo_decisions.find((d) => d.text === 'Brightwell pricing pilot starts in December')!
    const earlier = db.cxo_decisions.find((d) => d.text === 'Brightwell pricing pilot starts in November')!
    expect(later.reverses_id).toBe(earlier.id)
    expect(earlier.reversed_by_id).toBe(later.id)
    expect(noticeWrites.map((n) => n.member_id).sort()).toEqual(['adm-1', 'own-1'])
    expect(noticeWrites[0]).toMatchObject({ kind: 'report', item_kind: 'meeting', item_id: 'n2' })
    // Second run: nothing new.
    expect(await runDecisionLogTick(NOW)).toMatchObject({ notes: 0, inserted: 0 })
    // Hook re-run on the same note never doubles.
    expect(await recordDecisionsForNote(REP, { id: 'n2', title: 'Leadership sync', occurred_at: '2026-10-15T15:00:00Z' }, { decisions: ['Brightwell pricing pilot starts in December'] }, NOW)).toMatchObject({ inserted: 0 })
    expect(db.cxo_decisions).toHaveLength(3)
  })

  it('a backfilled old reversal is flagged but not announced', async () => {
    db.plaud_notes = [note('n1', '2026-07-01T15:00:00Z', 'Ops', ['Raise the referral bonus for partner agencies']), note('n2', '2026-08-01T15:00:00Z', 'Ops', ['Lower the referral bonus for partner agencies'])]
    expect(await runDecisionLogTick(NOW)).toMatchObject({ reversals: 1, notices: 0 })
    expect(noticeWrites).toHaveLength(0)
  })

  it('kill switch: CXO_DECISION_LOG=off writes nothing', async () => {
    process.env.CXO_DECISION_LOG = 'off'
    db.plaud_notes = [note('n1', '2026-10-01T15:00:00Z', 'Ops', ['Hire two support leads'])]
    expect(await runDecisionLogTick(NOW)).toMatchObject({ inserted: 0 })
    expect(db.cxo_decisions ?? []).toHaveLength(0)
  })
})

describe('who sees which decisions', () => {
  const scope = (over: Partial<SearchScope>): SearchScope => ({ repId: REP, memberId: 'rep-1', email: 'erin@demo.test', displayName: 'Erin Vale', isExec: false, boardIds: new Set(), sharedNoteIds: new Set(), ...over })

  beforeEach(async () => {
    db.reps = [{ id: REP, brand: 'cxo', is_active: true }]
    db.members = []
    db.plaud_notes = [
      note('n-exec', '2026-10-01T15:00:00Z', 'Exec offsite', ['Close the Lakeside office'], { triage_class: 'executive', attendees: ['erin@demo.test'] }),
      note('n-team', '2026-10-02T15:00:00Z', 'Support standup', ['Add an evening shift to the support rota'], { attendees: ['erin@demo.test'] }),
      note('n-other', '2026-10-03T15:00:00Z', 'Sales huddle', ['Raise the referral bonus for partner agencies']),
    ]
    await runDecisionLogTick(NOW)
  })

  it('an executive sees every decision, newest first', async () => {
    const rows = await listDecisions(scope({ isExec: true, memberId: 'own-1' }))
    expect(rows.map((r) => r.note_id)).toEqual(['n-other', 'n-team', 'n-exec'])
  })
  it('an employee sees only meetings they attended, never an executive-only one', async () => {
    const rows = await listDecisions(scope({}))
    expect(rows.map((r) => r.note_id)).toEqual(['n-team'])
  })
  it('a query narrows by topic', async () => {
    const rows = await listDecisions(scope({ isExec: true }), { query: 'referral bonus' })
    expect(rows.map((r) => r.text)).toEqual(['Raise the referral bonus for partner agencies'])
    expect(matchScore('Close the Lakeside office', null, 'referral bonus')).toBe(0)
  })
  it('the tool is open to employees (it is scoped by meeting visibility)', () => {
    expect(EMPLOYEE_TOOLS.has('decision_log')).toBe(true)
  })
})
