import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MIN_ELAPSED,
  WORSE_BY,
  behindItems,
  behindKey,
  bonusItem,
  composeNotice,
  decide,
  isCheckTime,
  quotaItem,
  recipientsFor,
  talkingPointFrom,
  type QuotaFacts,
  type WatchState,
} from '@/lib/people/fallsBehindShared'
import { ALWAYS_SHOWN_PREFIXES, BEHIND_NOTICE_PREFIX, actionsFor } from '@/lib/followups/noticeActionsShared'
import { noticeTag } from '@/lib/followups/shared'
import { fallsBehindOn } from '@/lib/people/fallsBehind'
import { employeeSnapshot, type Kpi } from '@/lib/employees/shared'

const kpi = (over: Partial<Kpi> = {}): Kpi => ({ id: 'k1', employee_id: 'e1', name: 'Premium', unit: 'usd', target: 120_000, period: 'month', weight: 1, lower_is_better: false, sort: 0, quota_type: 'premium', actual_source: 'manual', ...over })
const q = (over: Partial<QuotaFacts> = {}): QuotaFacts => ({ kpi: kpi(), periodKey: '2026-10', actual: 30_000, att: 0.25, projectedAtt: 0.45, elapsed: 0.55, pace: 'behind', ...over })

describe('what counts as behind', () => {
  it('uses the same quota pace as employee_quota_status, with deterministic numbers', () => {
    // Oct 17 of 31 days: 55% gone. $30,000 of $120,000 is 25%, on pace for ~46%.
    const snap = employeeSnapshot({ id: 'e1' }, { kpis: [kpi()], actuals: [{ kpi_id: 'k1', employee_id: 'e1', period_key: '2026-10', actual: 30_000 }], tiers: [] }, '2026-10-17')
    const it0 = quotaItem(snap.quotas[0])!
    expect(snap.quotas[0].pace).toBe('behind')
    expect(it0.line).toBe('Premium (October 2026): $30,000 of $120,000 (25%) with 55% of the month gone. On pace for 46%.')
    expect(it0.pacePct).toBe(46)
  })
  it('says nothing early in a period, or when on pace, met or without numbers', () => {
    expect(quotaItem(q({ elapsed: MIN_ELAPSED - 0.01 }))).toBeNull()
    expect(quotaItem(q({ pace: 'on_pace' }))).toBeNull()
    expect(quotaItem(q({ pace: 'met' }))).toBeNull()
    expect(quotaItem(q({ pace: 'no_data', att: null }))).toBeNull()
  })
  it('a rate quota is not projected', () => {
    const it0 = quotaItem(q({ kpi: kpi({ name: 'Close rate', unit: 'pct', target: 30 }), actual: 18, att: 0.6, projectedAtt: 0.6 }))!
    expect(it0.line).toBe('Close rate (October 2026): 18% of 30% (60%).')
  })
  it('bonus behind uses the payoutFor status, no dollars', () => {
    const b = bonusItem({ period_key: '2026-Q4', status: 'behind', overallAtt: 0.31, elapsed: 0.2 })!
    expect(b.line).toBe('Bonus (Q4 2026): not on pace for a bonus tier this quarter. 31% to goal so far.')
    expect(b.line).not.toMatch(/\$/)
    expect(bonusItem({ period_key: '2026-10', status: 'on_track', overallAtt: 0.9, elapsed: 0.5 })).toBeNull()
    expect(bonusItem({ period_key: '2026-10', status: 'no_plan', overallAtt: null, elapsed: 0.5 })).toBeNull()
  })
  it('worst quota first, bonus last', () => {
    const items = behindItems([q({ kpi: kpi({ id: 'a', name: 'A' }), projectedAtt: 0.8 }), q({ kpi: kpi({ id: 'b', name: 'B' }), projectedAtt: 0.4 })], [{ period_key: '2026-10', status: 'behind', overallAtt: 0.3, elapsed: 0.5 }])
    expect(items.map((i) => i.key)).toEqual(['q:b:2026-10', 'q:a:2026-10', 'b:2026-10'])
  })
})

describe('once per episode', () => {
  const items = behindItems([q()], [])
  const W = '2026-W42'
  it('nobody behind: no notice', () => {
    expect(decide(null, [], W).notify).toBe(false)
  })
  it('new episode notifies once; the same picture later that week or next does not', () => {
    const a = decide(null, items, W)
    expect(a.notify).toBe(true)
    expect(decide(a.next, items, W).notify).toBe(false)
    expect(decide(a.next, items, '2026-W43').notify).toBe(false)
  })
  it('again when it gets worse, but not twice in one week', () => {
    const a = decide(null, items, W).next
    const worse = behindItems([q({ projectedAtt: 0.45 - WORSE_BY / 100 })], [])
    expect(decide(a, worse, W).notify).toBe(false)
    expect(decide(a, worse, '2026-W43').notify).toBe(true)
    const newQuota = behindItems([q(), q({ kpi: kpi({ id: 'k2', name: 'Policies', unit: 'count', target: 40 }) })], [])
    expect(decide(a, newQuota, '2026-W43').notify).toBe(true)
  })
  it('recovering ends the episode; slipping again is new', () => {
    const a = decide(null, items, W).next
    const ok = decide(a, [], '2026-W43').next
    expect(ok.behind).toBe(false)
    expect(decide(ok, items, '2026-W44').notify).toBe(true)
  })
  it('a new period is a new episode', () => {
    const a: WatchState = decide(null, items, W).next
    expect(decide(a, behindItems([q({ periodKey: '2026-11' })], []), '2026-W46').notify).toBe(true)
  })
})

describe('who hears', () => {
  const emps = [
    { id: 'e1', name: 'Dana Lee', manager_id: 'e2', member_id: 'm1' },
    { id: 'e2', name: 'Sam Boss', manager_id: null, member_id: 'm2' },
    { id: 'e3', name: 'Pat Peer', manager_id: 'e2', member_id: 'm3' },
    { id: 'e4', name: 'No Login Boss', manager_id: null, member_id: null },
    { id: 'e5', name: 'Rae', manager_id: 'e4', member_id: 'm5' },
  ]
  const members = [
    { id: 'm1', role: 'rep', employee_only: true },
    { id: 'm2', role: 'member', employee_only: false },
    { id: 'm3', role: 'rep', employee_only: true },
    { id: 'm5', role: 'rep', employee_only: true },
    { id: 'o1', role: 'owner', employee_only: false },
    { id: 'a1', role: 'admin', employee_only: false },
  ]
  it('their manager only, never the person or a peer', () => {
    expect(recipientsFor(emps[0], emps, members)).toEqual(['m2'])
  })
  it('no manager with a login: the owner and admins', () => {
    expect(recipientsFor(emps[4], emps, members)).toEqual(['o1', 'a1'])
    expect(recipientsFor(emps[1], emps, members)).toEqual(['o1', 'a1'])
  })
  it('an owner who is behind is not told about themselves', () => {
    expect(recipientsFor({ id: 'e9', name: 'Owner', manager_id: null, member_id: 'o1' }, emps, members)).toEqual(['a1'])
  })
})

describe('the notice', () => {
  const items = behindItems([q()], [{ period_key: '2026-10', status: 'behind', overallAtt: 0.25, elapsed: 0.55 }])
  it('numbers plus one talking point, read back by Add to 1:1', () => {
    const n = composeNotice('Dana Lee', items, { comp: true })!
    expect(n.title).toBe('Dana Lee is behind on 2 goals')
    expect(n.body).toContain('$30,000 of $120,000')
    expect(n.talking).toBe('Dana is on pace for 45% of Premium this month. Ask what is in the way and agree on one step for this week.')
    expect(talkingPointFrom(n.body)).toBe(n.talking)
    expect(n.body).not.toMatch(/—/)
  })
  it('bonus lines only for readers who may see comp', () => {
    const n = composeNotice('Dana Lee', items, { comp: false })!
    expect(n.title).toBe('Dana Lee is behind on Premium')
    expect(n.body).not.toMatch(/bonus/i)
    const bonusOnly = behindItems([], [{ period_key: '2026-10', status: 'behind', overallAtt: 0.25, elapsed: 0.55 }])
    expect(composeNotice('Dana Lee', bonusOnly, { comp: false })).toBeNull()
    expect(composeNotice('Dana Lee', bonusOnly, { comp: true })!.title).toBe('Dana Lee is not on pace for a bonus')
  })
  it('weekdays from 9am', () => {
    expect(isCheckTime({ weekday: 1, hour: 8 })).toBe(false)
    expect(isCheckTime({ weekday: 1, hour: 9 })).toBe(true)
    expect(isCheckTime({ weekday: 6, hour: 10 })).toBe(false)
  })
})

describe('wiring', () => {
  const n = composeNotice('Dana Lee', behindItems([q()], []), { comp: false })!
  it('the notice gets a one-tap Add to 1:1 and shows regardless of the ops switch', () => {
    const key = behindKey('2026-W42', 'e1', 'm2')
    expect(key.startsWith(BEHIND_NOTICE_PREFIX)).toBe(true)
    expect(actionsFor({ key, item_id: 'e1', body: n.body })).toEqual([{ action: 'add_to_one_on_one', label: 'Add to 1:1' }])
    expect(actionsFor({ key, item_id: null, body: n.body })).toEqual([])
    expect((ALWAYS_SHOWN_PREFIXES as readonly string[]).includes(BEHIND_NOTICE_PREFIX)).toBe(true)
    expect(noticeTag('report', key)).toBe('Your team')
  })
  it('is on unless switched off', () => {
    expect(fallsBehindOn({})).toBe(true)
    expect(fallsBehindOn({ CXO_FALLS_BEHIND: 'off' })).toBe(false)
  })
  it('runs on the Hetzner tick and the server action handles the tap', () => {
    const worker = readFileSync('hetzner-worker/index.ts', 'utf8')
    expect(worker).toContain('runFallsBehindTick')
    expect(worker).toContain("CXO_FALLS_BEHIND !== 'off'")
    expect(readFileSync('lib/followups/noticeActions.ts', 'utf8')).toContain("case 'add_to_one_on_one'")
    expect(readFileSync('.github/workflows/deploy-worker.yml', 'utf8')).toContain("'lib/people/**'")
    const src = readFileSync('lib/people/fallsBehind.ts', 'utf8')
    expect(src).not.toMatch(/aiProvider|openrouter|anthropic/i)
  })
})
