/**
 * Ciao refinement loop of 2026-10-18 (docs/qa/ciao-refinement-2026-10-18.md):
 * the pure pieces behind each round's fixes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in this spec') } } }))

import { isParallelReadBatch, readCallKey } from '@/lib/agent/readBatch'
import { tableFromToolResult, isSheetSourceTool } from '@/lib/agent/sheetFromTool'
import { agencyTotals, changePct, paceProjection, type ProducerRow } from '@/lib/book/production'
import { isStaleUntouchedDraft } from '@/lib/boardUpdate/data'
import { stripHistoryStamps } from '@/lib/agent/runAgent'
import { claimsAction, UNBACKED_CLAIM_NOTE } from '@/lib/agent/actionClaims'
import { PRODUCER_PRODUCTION_TOOL } from '@/lib/agent/cxoProducerTool'
import { renderGoogleState } from '@/lib/agent/googleState'
import { routingHintsFor } from '@/lib/agent/cxoCatalog'

const row = (name: string, team: string | null, premium: number, policies: number): ProducerRow => ({
  name, team, premium, funded: 0, policies, paid: 0, declined: 0, lapsed: 0, pending: 0, firstPolicy: null, contractedAt: null, status: null,
})

describe('parallel reads and the repeat guard', () => {
  it('keys a read the same whatever the argument order, and ignores undefined args', () => {
    expect(readCallKey('producer_production', { view: 'rank', period: 'mtd' })).toBe(readCallKey('producer_production', { period: 'mtd', view: 'rank', team: undefined }))
    expect(readCallKey('producer_production', { view: 'rank', period: 'mtd' })).not.toBe(readCallKey('producer_production', { view: 'rank', period: 'qtd' }))
  })
  it('never keys a tool that may write', () => {
    expect(readCallKey('add_my_todo', { body: 'x' })).toBeNull()
    expect(readCallKey('send_member_message', {})).toBeNull()
  })
  it('runs a batch side by side only when it is two or more reads', () => {
    expect(isParallelReadBatch(['producer_production', 'list_my_todos'])).toBe(true)
    expect(isParallelReadBatch(['producer_production'])).toBe(false)
    expect(isParallelReadBatch(['list_my_todos', 'add_my_todo'])).toBe(false)
  })
})

describe('sheet from a tool result', () => {
  it('takes the largest row list, rank first, and skips nested values and the repeated value column', () => {
    const t = tableFromToolResult({
      totals: { submitted_ap: 10 },
      agencies_by_submitted_ap: [{ rank: 1, agency: 'A' }],
      ranked: [
        { name: 'Avery', team: 'North', submitted_ap: 500, value: 500, rank: 1, trend: { a: 1 } },
        { name: 'Blake', team: null, submitted_ap: 300, value: 300, rank: 2, trend: { a: 2 } },
      ],
    })
    expect(t).toEqual([
      ['Rank', 'Producer', 'Agency', 'Submitted AP'],
      ['1', 'Avery', 'North', '500'],
      ['2', 'Blake', '', '300'],
    ])
  })
  it('returns null when there are no rows, and only allows the producer tool as a source', () => {
    expect(tableFromToolResult({ ok: false, say: 'not set up' })).toBeNull()
    expect(tableFromToolResult(null)).toBeNull()
    expect(isSheetSourceTool('producer_production')).toBe(true)
    expect(isSheetSourceTool('payroll')).toBe(false)
  })
})

describe('production figures', () => {
  it('projects a to-date window to its full length and skips closed windows', () => {
    const p = paceProjection('mtd', { start: '2026-10-01', end: '2026-10-10' }, { submitted_ap: 1000, applications: 10 })
    expect(p).toEqual({ days_elapsed: 10, days_in_period: 31, projected_submitted_ap: 3100, projected_applications: 31, period_end: '2026-10-31' })
    expect(paceProjection('qtd', { start: '2026-10-01', end: '2026-10-18' }, { submitted_ap: 0, applications: 0 })?.period_end).toBe('2026-12-31')
    expect(paceProjection('last_month', { start: '2026-09-01', end: '2026-09-30' }, { submitted_ap: 1, applications: 1 })).toBeNull()
  })
  it('gives percent change to one decimal and null on a zero base', () => {
    expect(changePct(112.8, 100)).toBe(12.8)
    expect(changePct(50, 200)).toBe(-75)
    expect(changePct(10, 0)).toBeNull()
  })
  it('rolls producers up by agency with rank and share, biggest first', () => {
    const a = agencyTotals([row('a', 'North', 600, 3), row('b', 'North', 200, 1), row('c', 'Lake', 200, 2), row('d', null, 0, 0)])
    expect(a.map((x) => [x.rank, x.agency, x.submitted_ap, x.applications, x.producers_writing, x.share_of_ap_pct])).toEqual([
      [1, 'North', 800, 4, 2, 80],
      [2, 'Lake', 200, 2, 1, 20],
    ])
    expect(agencyTotals([row('a', 'X', 1, 1), row('b', 'Y', 2, 1)], 1)).toHaveLength(1)
  })
})

describe('board update refresh', () => {
  const now = new Date('2026-10-18T15:00:00Z')
  it('refreshes an untouched draft older than an hour', () => {
    expect(isStaleUntouchedDraft({ status: 'draft', edited: false, generated_at: '2026-10-18T13:00:00Z' }, now)).toBe(true)
    expect(isStaleUntouchedDraft({ status: 'draft', edited: false, generated_at: 'not a date' }, now)).toBe(true)
  })
  it('keeps fresh, edited and sent ones', () => {
    expect(isStaleUntouchedDraft({ status: 'draft', edited: false, generated_at: '2026-10-18T14:30:00Z' }, now)).toBe(false)
    expect(isStaleUntouchedDraft({ status: 'draft', edited: true, generated_at: '2026-10-01T00:00:00Z' }, now)).toBe(false)
    expect(isStaleUntouchedDraft({ status: 'sent', edited: false, generated_at: '2026-10-01T00:00:00Z' }, now)).toBe(false)
  })
})

describe('answer hygiene', () => {
  it('strips history stamps the model copied into its answer', () => {
    expect(stripHistoryStamps('[sent today 9:48 AM, earlier]\nUp 12.8% vs last month.')).toBe('Up 12.8% vs last month.')
    expect(stripHistoryStamps('[earlier turn, time unknown] Done.')).toBe('Done.')
    expect(stripHistoryStamps('Policies [sent 3] stay.')).toBe('Policies [sent 3] stay.')
  })
  it('tells the model to rewrite from scratch without mentioning the check', () => {
    expect(UNBACKED_CLAIM_NOTE).toMatch(/never sees/i)
    expect(UNBACKED_CLAIM_NOTE).toMatch(/from scratch/i)
  })
  it('reads book figures as figures, not action claims', () => {
    expect(claimsAction('Life is 69%.\n\nSubmitted AP $2.42M, issued AP $1.80M.')).toBe(false)
    expect(claimsAction('Issued 730 of 1,051.')).toBe(false)
    expect(claimsAction('- **Declined:** 17.8%')).toBe(false)
    expect(claimsAction('Sent 3 emails to the team.')).toBe(true)
    expect(claimsAction('Added to your to-dos.')).toBe(true)
  })
})

describe('tool schema, prompt lines and routing', () => {
  it('requires view and period on producer_production (GLM drops optional args)', () => {
    expect(PRODUCER_PRODUCTION_TOOL.input_schema.required).toEqual(['view', 'period'])
  })
  it('says Sheets is not connected when Google is not', () => {
    const text = renderGoogleState({ calendar: { connected: false } } as Parameters<typeof renderGoogleState>[0])
    expect(text).toMatch(/Google Sheets: NOT connected/)
  })
  it('routes owed-to-a-person, worst placement and vague asks', () => {
    const hints = routingHintsFor(['list_followups', 'list_my_todos', 'producer_production', 'list_approvals', 'list_calendar_events']).join('\n')
    expect(hints).toMatch(/What do I owe <person>.*list_my_todos/)
    expect(hints).toMatch(/worst or best placement.*metric=placement/)
    expect(hints).toMatch(/How's the team doing.*view=rank period=mtd/)
    expect(hints).toMatch(/list_approvals and list_my_todos in one go/)
    expect(hints).toMatch(/list_calendar_events \(window week or today\) and list_my_todos/)
  })
})

describe('OpenRouter host choice and stall retry', () => {
  const keys = ['OPENROUTER_API_KEY', 'OPENROUTER_PROVIDER_ORDER', 'OPENROUTER_PROVIDER_SORT', 'OPENROUTER_STALL_MS']
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) saved[k] = process.env[k]
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  const params = { model: 'x', max_tokens: 10, messages: [{ role: 'user' as const, content: 'hi' }] }

  it('sorts hosts by latency unless an order is pinned or sorting is off', async () => {
    const { buildOpenRouterBody, textModelId } = await import('@/lib/aiProvider')
    const id = textModelId()
    delete process.env.OPENROUTER_PROVIDER_ORDER
    delete process.env.OPENROUTER_PROVIDER_SORT
    expect((buildOpenRouterBody(params, id).provider as Record<string, unknown>).sort).toBe('latency')
    process.env.OPENROUTER_PROVIDER_ORDER = 'novita'
    const pinned = buildOpenRouterBody(params, id).provider as Record<string, unknown>
    expect(pinned.order).toEqual(['novita'])
    expect(pinned.sort).toBeUndefined()
    delete process.env.OPENROUTER_PROVIDER_ORDER
    process.env.OPENROUTER_PROVIDER_SORT = 'none'
    expect((buildOpenRouterBody(params, id).provider as Record<string, unknown>).sort).toBeUndefined()
  })

  it('retries once when the first attempt stalls, then answers', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_STALL_MS = '50'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const signals: unknown[] = []
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { signal?: unknown }) => {
      signals.push(init.signal)
      calls++
      if (calls === 1) throw Object.assign(new Error('stalled'), { name: 'TimeoutError' })
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: {} }), { status: 200 })
    }))
    const { openRouterCreate } = await import('@/lib/aiProvider')
    const msg = await openRouterCreate(params, 'openrouter:z-ai/glm-5.3')
    expect(calls).toBe(2)
    expect(signals[0]).toBeDefined()
    expect(signals[1]).toBeUndefined()
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'ok' })
  })

  it('does not retry a second stall', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_STALL_MS = '50'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      throw Object.assign(new Error('stalled'), { name: 'TimeoutError' })
    }))
    const { openRouterCreate } = await import('@/lib/aiProvider')
    await expect(openRouterCreate(params, 'openrouter:z-ai/glm-5.3')).rejects.toThrow('stalled')
    expect(calls).toBe(2)
  })
})
