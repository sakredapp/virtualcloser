import { describe, expect, it, vi, beforeEach } from 'vitest'

// Fake data only. A tiny chainable Supabase fake for the notices read and the emailed_at stamp.
type Call = { table: string; op: 'select' | 'update'; patch: unknown; filters: Array<[string, unknown]> }
const state: {
  noticeRows: Array<Record<string, unknown>>
  noticeError: { code?: string; message: string } | null
  calls: Call[]
} = { noticeRows: [], noticeError: null, calls: [] }

function chain(table: string) {
  const call: Call = { table, op: 'select', patch: null, filters: [] }
  state.calls.push(call)
  const c: Record<string, unknown> = {}
  const add = (k: string) => (a: unknown, b?: unknown) => (call.filters.push([k, b === undefined ? a : [a, b]]), c)
  c.select = () => c
  c.update = (p: unknown) => ((call.op = 'update'), (call.patch = p), c)
  for (const k of ['eq', 'is', 'in', 'gte', 'or', 'order', 'limit']) c[k] = add(k)
  c.then = (res: (v: unknown) => unknown) => {
    if (table === 'cxo_followup_notices' && call.op === 'select') {
      return Promise.resolve(res(state.noticeError ? { data: null, error: state.noticeError } : { data: state.noticeRows, error: null }))
    }
    return Promise.resolve(res({ data: null, error: null }))
  }
  return c
}

const sendEmail = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => {}) }))
vi.mock('@/lib/health', () => ({ recordJobRun: async (_job: string, fn: () => Promise<unknown>) => fn() }))
vi.mock('@/lib/tenant', () => ({
  getAllActiveTenants: async () => [
    { id: 'rep-1', slug: 'acme', brand: 'cxo', timezone: 'America/New_York', settings: {}, host_aliases: [] },
  ],
}))
vi.mock('@/lib/members', () => ({
  listMembers: async () => [
    { id: 'mem-1', rep_id: 'rep-1', role: 'owner', is_active: true, email: 'alex@example.test', display_name: 'Alex Sample', timezone: 'America/New_York', settings: { exec_email_digest: true } },
  ],
}))
vi.mock('@/lib/exec/digest', () => ({
  buildExecDigest: async () => ({ pendingDrafts: 0, unansweredThreads: 0, quietDeals: [], todayEvents: undefined, topLeads: [], overnightChanges: 0 }),
}))
vi.mock('@/lib/exec/summary', () => ({
  buildPinnacleBriefData: async () => null,
  generateExecSummary: async () => '',
  fmtM: (n: number) => `$${n}`,
  paceWords: () => null,
}))
vi.mock('@/lib/pinnacle/rollup', () => ({ isPinnacleViewer: () => false }))

import { runExecEmail } from '@/lib/exec/execEmailRun'

const NOW = new Date('2026-10-20T11:05:00Z') // a Tuesday, 7:05am New York
const notice = (id: string, title: string) => ({ id, key: `k-${id}`, kind: 'nudge', item_kind: null, item_id: null, title, body: null, href: `/dashboard/${id}`, due_date: null, created_at: '2026-10-19T12:00:00Z' })
const stamps = () => state.calls.filter((c) => c.table === 'cxo_followup_notices' && c.op === 'update')

beforeEach(() => {
  state.noticeRows = []
  state.noticeError = null
  state.calls = []
  sendEmail.mockReset()
})

describe('exec brief email carries Ciao notices', () => {
  it('reads only unread, never-emailed notices for that member', async () => {
    sendEmail.mockResolvedValue({ ok: true })
    await runExecEmail({ force: true, now: NOW })
    const read = state.calls.find((c) => c.table === 'cxo_followup_notices' && c.op === 'select')!
    expect(read.filters).toEqual(expect.arrayContaining([['eq', ['rep_id', 'rep-1']], ['eq', ['member_id', 'mem-1']], ['is', ['read_at', null]], ['is', ['emailed_at', null]]]))
    expect(read.filters.find((f) => f[0] === 'limit')?.[1]).toBe(5)
  })

  it('an ok send stamps emailed_at on only the listed ids', async () => {
    state.noticeRows = [notice('n1', 'Day wrap'), notice('n2', 'A number slipped')]
    sendEmail.mockResolvedValue({ ok: true })
    const r = await runExecEmail({ force: true, now: NOW })
    expect(r.totalSent).toBe(1)
    const sent = sendEmail.mock.calls[0][0] as { html: string; text: string }
    expect(sent.html).toContain('From Ciao')
    expect(sent.html).toContain('href="https://acme.suitecxo.com/dashboard/n1"')
    expect(sent.text).toContain('https://acme.suitecxo.com/dashboard/n2')
    const st = stamps()
    expect(st).toHaveLength(1)
    expect(st[0].patch).toEqual({ emailed_at: expect.any(String) })
    expect(st[0].filters).toEqual(expect.arrayContaining([['eq', ['rep_id', 'rep-1']], ['eq', ['member_id', 'mem-1']], ['in', ['id', ['n1', 'n2']]]]))
  })

  it('a failed send stamps nothing', async () => {
    state.noticeRows = [notice('n1', 'Day wrap')]
    sendEmail.mockResolvedValue({ ok: false, error: 'provider down' })
    const r = await runExecEmail({ force: true, now: NOW })
    expect(r.totalSent).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(stamps()).toHaveLength(0)
  })

  it('a notices read error still sends the brief, without the section', async () => {
    state.noticeError = { code: 'XX000', message: 'boom' }
    sendEmail.mockResolvedValue({ ok: true })
    const r = await runExecEmail({ force: true, now: NOW })
    expect(r.totalSent).toBe(1)
    const sent = sendEmail.mock.calls[0][0] as { html: string; text: string }
    expect(sent.html).not.toContain('From Ciao')
    expect(sent.text).not.toContain('FROM CIAO')
    expect(stamps()).toHaveLength(0)
  })

  it('no notices: the brief goes without the section and nothing is stamped', async () => {
    sendEmail.mockResolvedValue({ ok: true })
    await runExecEmail({ force: true, now: NOW })
    expect((sendEmail.mock.calls[0][0] as { html: string }).html).not.toContain('From Ciao')
    expect(stamps()).toHaveLength(0)
  })
})

describe('notice links only open app paths', async () => {
  const { safeNoticePath } = await import('@/lib/exec/execEmailRun')
  it('keeps a "/..." path', () => {
    expect(safeNoticePath('/dashboard/numbers')).toBe('/dashboard/numbers')
  })
  it('sends a full URL, a "//host" link, empty or null to the dashboard', () => {
    for (const bad of ['https://evil.example/x', '//evil.example', '', null, undefined, 'javascript:alert(1)'])
      expect(safeNoticePath(bad as never)).toBe('/dashboard')
  })
})
