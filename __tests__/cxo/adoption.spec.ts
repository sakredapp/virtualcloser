import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Fakes ───────────────────────────────────────────────────────────────────
// A tiny in-memory database with two orgs. Every query records the rep_id it
// was filtered by, so the tests can prove nothing is read without one.

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const TODAY = '2026-10-11'

const h = vi.hoisted(() => ({
  db: {} as Record<string, Array<Record<string, unknown>>>,
  queries: [] as Array<{ table: string; rep: unknown }>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  session: null as { scope: string | null } | null,
  member: null as Record<string, unknown> | null,
  tenant: { id: 'org-a', timezone: 'UTC', brand: 'cxo' } as Record<string, unknown>,
}))

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = []
    const q = { table, rep: undefined as unknown }
    h.queries.push(q)
    const run = () => ({ data: (h.db[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null })
    const api: Record<string, unknown> = {
      select: () => api,
      order: () => api,
      eq: (col: string, val: unknown) => {
        if (col === 'rep_id') q.rep = val
        filters.push((r) => r[col] === val)
        return api
      },
      gte: (col: string, val: string) => {
        filters.push((r) => String(r[col]) >= val)
        return api
      },
      range: async () => run(),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok),
    }
    return api
  }
  return {
    supabase: {
      from,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        h.rpc.push({ fn, args })
        return { error: null }
      },
    },
  }
})

vi.mock('@/lib/tenant', () => ({
  requireMember: vi.fn(async () => {
    if (!h.member) throw new Error('no session')
    return { tenant: h.tenant, member: h.member }
  }),
}))

vi.mock('@/lib/client-auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSessionPayload: vi.fn(async () => h.session),
}))

import {
  ACTIVE_DAYS_PER_WEEK,
  IMPERSONATED_MIRA_KEY,
  SESSION_KEY,
  actionKey,
  addDays,
  adoptionForAi,
  adoptionStatus,
  buildAdoption,
  demoAdoption,
  type ActivityRow,
  type AdoptionMember,
} from '@/lib/cxoAdoptionShared'
import { canSeeAdoption, orgAdoption } from '@/lib/cxoAdoption'
import { recordUsage } from '@/lib/cxoUsage'

const member = (id: string, role: string, extra: Partial<AdoptionMember> = {}): AdoptionMember => ({ id, display_name: id, email: `${id}@example.com`, role, last_login_at: null, ...extra })
const act = (member_id: string, ago: number, path: string, count = 1): ActivityRow => ({ member_id, day: addDays(TODAY, -ago), path, count, updated_at: `${addDays(TODAY, -ago)}T15:00:00Z` })
const viewer = (role: string, extra: Record<string, unknown> = {}) => ({ id: 'me', role, is_active: true, timezone: 'UTC', ...extra })

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-for-adoption-spec'
})

beforeEach(() => {
  h.db = {
    members: [
      { ...member('a-owner', 'owner'), rep_id: ORG_A, is_active: true },
      { ...member('a-rep', 'rep'), rep_id: ORG_A, is_active: true },
      { ...member('b-owner', 'owner'), rep_id: ORG_B, is_active: true },
    ],
    cxo_activity: [
      { ...act('a-owner', 0, '/dashboard/boards'), rep_id: ORG_A },
      { ...act('a-owner', 1, '/login'), rep_id: ORG_A },
      { ...act('b-owner', 0, '/dashboard/revenue'), rep_id: ORG_B },
      { ...act('b-owner', 1, '/dashboard/revenue'), rep_id: ORG_B },
      // A row filed under org A for a person who is not in org A.
      { ...act('b-owner', 2, '/dashboard/partners'), rep_id: ORG_A },
    ],
    agent_usage: [
      { rep_id: ORG_A, member_id: 'a-owner', day: TODAY, requests: 3 },
      { rep_id: ORG_B, member_id: 'b-owner', day: TODAY, requests: 40 },
    ],
  }
  h.queries.length = 0
  h.rpc.length = 0
  h.session = null
  h.member = null
  h.tenant = { id: ORG_A, timezone: 'UTC', brand: 'cxo' }
})

// ── Status thresholds ───────────────────────────────────────────────────────

describe('adoption status', () => {
  it('is one rule: 2+ days of the last 7 is active, less is slipping, never seen is not started', () => {
    expect(ACTIVE_DAYS_PER_WEEK).toBe(2)
    expect(adoptionStatus(7, true)).toBe('active')
    expect(adoptionStatus(2, true)).toBe('active')
    expect(adoptionStatus(1, true)).toBe('slipping')
    expect(adoptionStatus(0, true)).toBe('slipping')
    expect(adoptionStatus(0, false)).toBe('not_started')
  })

  it('counts days from the rollups and sorts the people who need a nudge first', () => {
    const data = buildAdoption(
      [member('busy', 'admin'), member('once', 'rep'), member('gone', 'manager', { last_login_at: `${addDays(TODAY, -40)}T10:00:00Z` }), member('never', 'rep'), member('edge', 'observer')],
      [
        act('busy', 0, '/login'), act('busy', 0, '/dashboard/boards'), act('busy', 1, '/dashboard/boards'), act('busy', 3, '/dashboard/revenue'), act('busy', 0, actionKey('card_created'), 2),
        act('once', 0, SESSION_KEY, 2),
        // Day 6 is inside the last 7; day 7 is not.
        act('edge', 6, '/dashboard/me'), act('edge', 7, '/dashboard/me'),
      ],
      [{ member_id: 'busy', day: TODAY, requests: 4 }],
      TODAY,
    )
    const by = Object.fromEntries(data.people.map((p) => [p.id, p]))
    expect(by.busy).toMatchObject({ status: 'active', days7: 3, days30: 3, mira30: 4, top_page: 'Boards', group: 'exec' })
    expect(by.busy.actions).toEqual([{ key: 'card_created', label: 'Cards created', count: 2 }])
    expect(by.once).toMatchObject({ status: 'slipping', days7: 1, group: 'employee' })
    expect(by.edge).toMatchObject({ status: 'slipping', days7: 1, days30: 2 })
    expect(by.gone).toMatchObject({ status: 'slipping', days7: 0, days30: 0 })
    expect(by.never).toMatchObject({ status: 'not_started', days7: 0, last_seen: null })
    expect(data).toMatchObject({ total: 5, active: 1, slipping: 3, not_started: 1, pct: 20 })
    expect(data.people.map((p) => p.status)).toEqual(['not_started', 'slipping', 'slipping', 'slipping', 'active'])
    // The weekly trend uses the same rule: only "busy" was active in the last 7 days.
    expect(data.weeks).toHaveLength(12)
    expect(data.weeks[11]).toMatchObject({ end: TODAY, active: 1, mira: 4 })
    expect(data.weeks[10].active).toBe(0)
  })

  it('the demo is invented, and has someone in every status', () => {
    const demo = demoAdoption('2026-10-08')
    expect(demo.total).toBeGreaterThan(10)
    for (const k of ['active', 'slipping', 'not_started'] as const) expect(demo[k]).toBeGreaterThan(0)
    expect(JSON.stringify(demo)).not.toMatch(/@|spence|pinnacle/i)
    expect(demoAdoption('2026-10-08')).toEqual(demo)
  })
})

// ── Who may see it ──────────────────────────────────────────────────────────

describe('adoption access', () => {
  it('owner and admin only', () => {
    expect(canSeeAdoption(viewer('owner'))).toBe(true)
    expect(canSeeAdoption(viewer('admin'))).toBe(true)
    for (const role of ['manager', 'rep', 'observer', 'assistant', '', 'nonsense']) expect(canSeeAdoption(viewer(role))).toBe(false)
    expect(canSeeAdoption(viewer('owner', { is_active: false }))).toBe(false)
    // An assistant working as the owner does not inherit it.
    expect(canSeeAdoption(viewer('owner', { acting_assistant: { id: 'ea' } }))).toBe(false)
    expect(canSeeAdoption(null)).toBe(false)
  })

  it('the API refuses a non-admin with 403 and reads nothing', async () => {
    const { GET } = await import('@/app/api/cxo/adoption/route')
    for (const role of ['manager', 'rep', 'observer', 'assistant']) {
      h.member = viewer(role)
      const res = await GET()
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden' })
    }
    expect(h.queries).toHaveLength(0)
  })

  it('the API refuses a signed-out caller with 401', async () => {
    const { GET } = await import('@/app/api/cxo/adoption/route')
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.queries).toHaveLength(0)
  })

  it('an admin gets their own org and nobody else', async () => {
    const { GET } = await import('@/app/api/cxo/adoption/route')
    h.member = viewer('admin')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.people.map((p: { id: string }) => p.id).sort()).toEqual(['a-owner', 'a-rep'])
    expect(JSON.stringify(body)).not.toContain('b-owner')
  })
})

// ── Cross-org ───────────────────────────────────────────────────────────────

describe('adoption is org-scoped', () => {
  it('every query is filtered by the org, and another org never shows up', async () => {
    const a = await orgAdoption(ORG_A, 'UTC')
    expect(h.queries.map((q) => q.table).sort()).toEqual(['agent_usage', 'cxo_activity', 'members'])
    expect(h.queries.every((q) => q.rep === ORG_A)).toBe(true)
    expect(a.people.map((p) => p.id).sort()).toEqual(['a-owner', 'a-rep'])
    expect(a.weeks.reduce((n, w) => n + w.mira, 0)).toBe(3) // org B's 40 are not here
    // The stray row for someone outside the org is dropped, not shown.
    expect(a.top_pages.map((p) => p.name)).toEqual(['Boards'])

    h.queries.length = 0
    const b = await orgAdoption(ORG_B, 'UTC')
    expect(h.queries.every((q) => q.rep === ORG_B)).toBe(true)
    expect(b.people.map((p) => p.id)).toEqual(['b-owner'])
  })

  it('the org comes from the session, not the request: the route takes no input', async () => {
    const { GET } = await import('@/app/api/cxo/adoption/route')
    expect(GET.length).toBe(0)
    h.member = viewer('owner')
    h.tenant = { id: ORG_B, timezone: 'UTC', brand: 'cxo' }
    const body = await (await GET()).json()
    expect(body.people.map((p: { id: string }) => p.id)).toEqual(['b-owner'])
  })

  it('Mira: refused for a non-admin, and names + counts only for an admin', async () => {
    const { CXO_ADOPTION_TOOL_HANDLERS: tools } = await import('@/lib/agent/cxoAdoptionTool')
    const ctx = (role: string) => ({ tenant: h.tenant, caller: viewer(role), todayIso: TODAY }) as never
    const no = JSON.parse((await tools.team_adoption(ctx('manager'), {})).text)
    expect(no).toEqual({ ok: false, say: 'Adoption is for the workspace owner and admins only.' })
    expect(h.queries).toHaveLength(0)

    // orgAdoption reads the real clock; pin it to the fixtures' day.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T16:00:00Z`))
    const yes = await tools.team_adoption(ctx('owner'), {}).finally(() => vi.useRealTimers())
    const out = JSON.parse(yes.text)
    expect(out).toMatchObject({ ok: true, people: 2, active_this_week: 1 })
    expect(out.not_seen_this_week.map((p: { name: string }) => p.name)).toEqual(['a-rep'])
    expect(yes.text).not.toMatch(/@|salary|b-owner/)
    expect(Object.keys(out.everyone[0]).sort()).toEqual(
      ['days_active_last_30', 'days_active_last_7', 'group', 'last_seen', 'mira_questions_last_30', 'most_used_page', 'name', 'role', 'status'].sort(),
    )
  })

  it('what Mira is given never carries an email, even when the name falls back to one', () => {
    const data = buildAdoption([member('x', 'rep', { display_name: 'Pat Lee' })], [act('x', 0, '/login')], [], TODAY)
    expect(JSON.stringify(adoptionForAi(data))).not.toContain('@')
  })
})

// ── Impersonation ───────────────────────────────────────────────────────────

describe('admin impersonation is not the member\'s usage', () => {
  it('the impersonation cookie is marked, and an ordinary login is not', async () => {
    const { signSession, verifySession } = await vi.importActual<typeof import('@/lib/client-auth')>('@/lib/client-auth')
    const imp = await verifySession(await signSession('acme', { memberId: 'm1', hosts: ['acme'], scope: 'admin' }))
    expect(imp).toMatchObject({ slug: 'acme', memberId: 'm1', scope: 'admin' })
    const own = await verifySession(await signSession('acme', { memberId: 'm1', hosts: ['acme'] }))
    expect(own?.scope ?? null).toBeNull()
  })

  it('the impersonate route signs with the admin scope', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('app/api/admin/impersonate/route.ts', 'utf8')
    expect(src).toMatch(/signSession\([\s\S]*?scope: 'admin'/)
  })

  it('the recorder writes for the member and no-ops for our admin', async () => {
    const ctx = { tenant: { id: ORG_A, timezone: 'UTC' }, member: { id: 'a-owner', timezone: 'UTC' } }
    await recordUsage(ctx, actionKey('card_created'))
    expect(h.rpc).toHaveLength(1)
    expect(h.rpc[0]).toMatchObject({ fn: 'cxo_activity_hit', args: { p_rep: ORG_A, p_member: 'a-owner', p_path: 'act:card_created', p_bump: true } })

    h.rpc.length = 0
    h.session = { scope: 'admin' }
    await recordUsage(ctx, actionKey('card_created'))
    await recordUsage(ctx, SESSION_KEY)
    expect(h.rpc).toHaveLength(0)
  })

  it('an assistant working as an exec is counted as the assistant', async () => {
    await recordUsage({ tenant: { id: ORG_A }, member: { id: 'a-owner', acting_assistant: { id: 'ea-1' } } }, actionKey('todo_done'))
    expect(h.rpc[0].args).toMatchObject({ p_member: 'ea-1', p_path: 'act:todo_done' })
  })

  it('the page beacon is dropped under impersonation', async () => {
    const { POST } = await import('@/app/api/me/activity/route')
    const req = () => new Request('http://x/api/me/activity', { method: 'POST', body: JSON.stringify({ path: '/dashboard/boards', session: true }) }) as never
    h.member = viewer('owner', { id: 'a-owner' })
    h.session = { scope: 'admin' }
    expect((await POST(req())).status).toBe(204)
    expect(h.rpc).toHaveLength(0)

    h.session = { scope: null }
    expect((await POST(req())).status).toBe(204)
    expect(h.rpc.map((r) => r.args.p_path)).toEqual(['/dashboard/boards', 'session'])
  })

  it('Mira questions our admin asked as the member are taken back out', () => {
    const data = buildAdoption(
      [member('m', 'owner')],
      [act('m', 0, IMPERSONATED_MIRA_KEY, 5), act('m', 3, IMPERSONATED_MIRA_KEY, 2)],
      [{ member_id: 'm', day: TODAY, requests: 5 }, { member_id: 'm', day: addDays(TODAY, -3), requests: 6 }],
      TODAY,
    )
    // Today was all our admin: not an active day, and never "last seen".
    expect(data.people[0]).toMatchObject({ mira30: 4, days7: 1, days30: 1, status: 'slipping' })
    expect(data.people[0].days.map((d) => d.day)).toEqual([addDays(TODAY, -3)])
  })
})
