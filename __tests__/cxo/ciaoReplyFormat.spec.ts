/**
 * Ciao's reply formatting step (Nick 2026-10-26): lib/agent/replyFormatShared,
 * lib/agent/replyFormatter, the chat turn pass-through and the renderers in
 * app/components/cxo/ReplyFormat. Same contract as crmbuilds PR #4238: the
 * step may change how an answer LOOKS, never what it SAYS. Every arm has its
 * control: a clean layout is accepted, and each mutation of it (an invented
 * figure in the words, an invented figure in a visual, a dropped correction,
 * junk, no words, a model name) is refused. Made-up figures and names only.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in tests') } } }))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type * as AI from '@/lib/aiTypes'
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import {
  REPLY_FORMATS, acceptFormatter, dataCards, figureAllowed, figuresAllowed, figuresIn, formatterSystemPrompt,
  normalizeChartBlock, normalizeReplyFormat, normalizeStepsBlock, normalizeTableBlock, unknownFigures, wantsModelFormat,
  type ReplyFormatPayload,
} from '@/lib/agent/replyFormatShared'
import { collectReads, formatReply, replyFormatterEnabled, type CreateFn } from '@/lib/agent/replyFormatter'
import { modelLeaks } from '@/lib/agent/answerCheck'
import { runChatTurn } from '@/lib/agent/chatTurn'
import type { RunAgentResult } from '@/lib/agent/runAgent'
import FormattedAnswer, { TABLE_ROWS_SHOWN } from '@/app/components/cxo/ReplyFormat'

// What a producer read returns (invented book).
const BOOK = {
  week: '2026-10-12',
  premium_written: 48200,
  policies: 31,
  producers: [
    { id: 'p1', name: 'Dana Reyes', email: 'dana@acme.test', premium: 18400, policies: 12 },
    { id: 'p2', name: 'Sam Ortiz', email: 'sam@acme.test', premium: 16300, policies: 11 },
    { id: 'p3', name: 'Lee Park', email: 'lee@acme.test', premium: 13500, policies: 8 },
  ],
}
const READS = [{ tool: 'producer_book', data: BOOK }]
const DRAFT = 'Actually 31 policies, not 34, for the week of Oct 12. Premium written was $48,200. '
  + 'Dana Reyes led with $18,400 on 12 policies, Sam Ortiz wrote $16,300 on 11, and Lee Park $13,500 on 8. '
  + 'Lee is the one to watch: lowest premium of the three.'

const cards = dataCards(READS)
const input = { answer: DRAFT, cards, datas: READS.map((r) => r.data), nameLeaks: (t: string) => modelLeaks(t, DRAFT) }
const GOOD = {
  format: 'mixed',
  say: 'You wrote $48,200 last week on 31 policies, not 34.',
  cards: ['producer_book_producers'],
  visuals: [{ kind: 'callout', tone: 'watch', text: 'Lee Park is lowest at $13,500.' }],
  after: 'Dana Reyes led the week.',
}
const j = (o: unknown) => JSON.stringify(o)

describe('the menu', () => {
  it('the prompt names every format and the hard rules', () => {
    const p = formatterSystemPrompt('Ciao')
    for (const f of REPLY_FORMATS) if (f !== 'mixed') expect(p).toContain(`- ${f}:`)
    expect(p).toContain('- mixed:')
    expect(p).toMatch(/Never add a fact/)
    expect(p).toMatch(/Never drop a correction/)
    // The prompt itself never names a model or provider.
    expect(modelLeaks(p)).toEqual([])
  })
  it('normalisers refuse what cannot be drawn', () => {
    expect(normalizeTableBlock({ columns: ['a', 'b'], rows: [] })).toBeNull()
    expect(normalizeChartBlock({ kind: 'line', points: [{ label: 'x', value: 1 }] })).toBeNull()
    expect(normalizeChartBlock({ kind: 'split', points: [{ label: 'x', value: 0 }, { label: 'y', value: 0 }] })).toBeNull()
    expect(normalizeChartBlock({ kind: 'pie', points: [] })).toBeNull()
    expect(normalizeStepsBlock({ items: ['one'] })).toBeNull()
    // A table is a name column plus at most 3 figure columns.
    expect(normalizeTableBlock({ columns: ['a', 'b', 'c', 'd', 'e', 'f'], rows: [['1', '2', '3', '4', '5', '6']] })!.columns).toHaveLength(4)
  })
  it('a stored layout round-trips; old rows and refused layouts draw the answer as written', () => {
    const ok = acceptFormatter(j(GOOD), input)
    expect(ok.ok).toBe(true)
    const payload = ok.ok ? ok.result : null
    expect(normalizeReplyFormat(JSON.parse(JSON.stringify({ ...payload, meta: { via: 'model' } })))).toMatchObject({ format: 'mixed', say: GOOD.say })
    expect(normalizeReplyFormat(null)).toBeNull()
    expect(normalizeReplyFormat({ meta: { via: 'none', format: 'as_written', reason: 'timeout' } })).toBeNull()
    expect(normalizeReplyFormat({ format: 'as_written', say: 'x' })).toBeNull()
    expect(normalizeReplyFormat({ format: 'plain', say: '' })).toBeNull()
  })
})

describe('figures', () => {
  it('reads figures as a person writes them', () => {
    expect(figuresIn('$1,234.50 and 2.1% of 340').map((f) => f.value)).toEqual([1234.5, 2.1, 340])
  })
  it('allows what the data holds (cents as dollars, rates as percents, list sizes), at the precision written', () => {
    const allowed = figuresAllowed([], [{ spend_cents: 7463, opt_in_rate: 0.021, rows: [1, 2, 3] }])
    expect(figureAllowed({ value: 74.63, decimals: 2 }, allowed)).toBe(true)
    expect(figureAllowed({ value: 2.1, decimals: 1 }, allowed)).toBe(true)
    expect(figureAllowed({ value: 3, decimals: 0 }, allowed)).toBe(true)
    // Control: a figure nobody read.
    expect(figureAllowed({ value: 61.5, decimals: 1 }, allowed)).toBe(false)
    expect(unknownFigures('You spent $81.20', allowed)).toEqual(['81.20'])
  })
})

describe('code-built cards from the tool results', () => {
  it('offers the figures as tiles and the list as a table, never ids or emails', () => {
    const ids = cards.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['producer_book_figures', 'producer_book_producers']))
    const t = cards.find((c) => c.id === 'producer_book_producers')!.block as { columns: string[]; rows: { cells: string[] }[] }
    expect(t.columns).toEqual(['Name', 'Premium', 'Policies'])
    expect(t.rows[0].cells).toEqual(['Dana Reyes', '18,400', '12'])
    expect(JSON.stringify(cards)).not.toMatch(/acme\.test|"p1"/)
  })
  it('a plain text result or a single row offers nothing', () => {
    expect(dataCards([{ tool: 'note', data: 'no figures here' }])).toEqual([])
    expect(dataCards([{ tool: 'one', data: [{ name: 'A', n: 1 }] }])).toEqual([])
  })
  it('collectReads parses this run\'s tool results and skips errors', () => {
    const messages = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'producer_book', input: {} }, { type: 'tool_use', id: 't2', name: 'qbo', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(BOOK) }, { type: 'tool_result', tool_use_id: 't2', content: 'failed', is_error: true }] },
    ] as unknown as AI.MessageParam[]
    expect(collectReads(messages, 1)).toEqual([{ tool: 'producer_book', data: BOOK }])
  })
})

describe('acceptFormatter: looks, never says', () => {
  it('CONTROL: a clean layout is accepted, the callout first, the card as built', () => {
    const r = acceptFormatter(j(GOOD), input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.format).toBe('mixed')
    expect(r.result.blocks.map((b) => b.type)).toEqual(['callout', 'table'])
    expect(r.result.blocks[1]).toBe(cards.find((c) => c.id === 'producer_book_producers')!.block)
    expect(r.result.cardsUsed).toEqual(['producer_book_producers'])
  })
  it('MUTATION: an invented figure in the words is refused', () => {
    const r = acceptFormatter(j({ ...GOOD, say: 'You wrote $52,000 last week on 31 policies, not 34.' }), input)
    expect(r).toEqual({ ok: false, reason: 'unknown_figures:52,000' })
  })
  it('MUTATION: an invented figure in a visual is refused', () => {
    const r = acceptFormatter(j({ ...GOOD, visuals: [{ kind: 'bar', title: 'Premium', items: [{ label: 'Dana Reyes', value: 18400, display: '$18,400' }, { label: 'Kim Wu', value: 9100, display: '$9,100' }] }] }), input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/^unknown_figures:/)
  })
  it('MUTATION: a dropped correction is refused', () => {
    const r = acceptFormatter(j({ ...GOOD, say: 'You wrote $48,200 last week on 31 policies.' }), input)
    expect(r).toEqual({ ok: false, reason: 'dropped_correction' })
  })
  it('MUTATION: junk, a format off the menu, and no words are refused', () => {
    expect(acceptFormatter('Sure! Here is a nicer version of the answer.', input)).toEqual({ ok: false, reason: 'not_json' })
    expect(acceptFormatter('{"format":', input)).toEqual({ ok: false, reason: 'not_json' })
    expect(acceptFormatter(j({ ...GOOD, format: 'pie' }), input)).toEqual({ ok: false, reason: 'bad_format' })
    expect(acceptFormatter(j({ ...GOOD, say: '' }), input)).toEqual({ ok: false, reason: 'no_words' })
  })
  it('MUTATION: a model or provider name in the words is refused', () => {
    const r = acceptFormatter(j({ ...GOOD, after: 'Formatted by OpenRouter.' }), input)
    expect(r).toEqual({ ok: false, reason: 'model_name' })
  })
  it('an offered card id that does not exist is ignored, not drawn', () => {
    const r = acceptFormatter(j({ ...GOOD, cards: ['made_up_card'], visuals: [] }), input)
    expect(r.ok && r.result.blocks).toEqual([])
  })
})

// ── the step and its gates ───────────────────────────────────────────────

const reply = (text: string, stop: AI.Message['stop_reason'] = 'end_turn'): AI.Message =>
  ({
    id: 'm1', type: 'message', role: 'assistant', model: 'test-model',
    content: [{ type: 'text', text, citations: null }], stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 700, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as AI.Message

const step = (over: Partial<Parameters<typeof formatReply>[0]> = {}, create: CreateFn = vi.fn(async () => reply(j(GOOD)))) =>
  formatReply({ question: 'How did last week go?', answer: DRAFT, reads: READS, assistantName: 'Ciao', model: 'test-model', create, env: {}, log: () => {}, ...over })

describe('formatReply gates', () => {
  it('flag: on unless "0" / "off" / "false" / "no"', () => {
    expect(replyFormatterEnabled({})).toBe(true)
    expect(replyFormatterEnabled({ CIAO_REPLY_FORMATTER: '1' })).toBe(true)
    for (const v of ['0', 'off', 'false', 'no', ' OFF ']) expect(replyFormatterEnabled({ CIAO_REPLY_FORMATTER: v })).toBe(false)
  })
  it('CONTROL: a dense answer is laid out and its tokens are returned for the usage row', async () => {
    const create = vi.fn(async () => reply(j(GOOD)))
    const r = await step({}, create)
    expect(create).toHaveBeenCalledTimes(1)
    expect(r.payload?.say).toBe(GOOD.say)
    expect(r.meta).toMatchObject({ via: 'model', format: 'mixed' })
    expect(r.usage).toEqual({ input_tokens: 700, output_tokens: 120, model: 'test-model' })
    // The model got the answer and the card list, nothing else.
    const params = (create.mock.calls[0] as unknown as [AI.MessageCreateParams])[0]
    expect(params.messages).toHaveLength(1)
    expect(String(params.messages[0].content)).toContain('producer_book_producers')
  })
  it('flag off: no model call, the answer as written', async () => {
    const create = vi.fn(async () => reply(j(GOOD)))
    const r = await step({ env: { CIAO_REPLY_FORMATTER: '0' } }, create)
    expect(create).not.toHaveBeenCalled()
    expect(r).toMatchObject({ payload: null, meta: { via: 'none', reason: 'off' } })
  })
  it('a short answer: no model call', async () => {
    const create = vi.fn(async () => reply(j(GOOD)))
    const short = 'You have 2 meetings today.'
    expect(wantsModelFormat(short, [])).toBe(false)
    const r = await step({ answer: short, reads: [] }, create)
    expect(create).not.toHaveBeenCalled()
    expect(r.meta.reason).toBe('not_dense')
  })
  it('density: 4 figures, 320 characters, or data cards with 2 figures', () => {
    expect(wantsModelFormat('1, 2, 3 and 4.', [])).toBe(true)
    expect(wantsModelFormat('a'.repeat(320), [])).toBe(true)
    expect(wantsModelFormat('31 policies and $48,200.', cards)).toBe(true)
    expect(wantsModelFormat('31 policies and $48,200.', [])).toBe(false)
  })
  it('a spoken answer: no model call', async () => {
    const create = vi.fn(async () => reply(j(GOOD)))
    const r = await step({ voice: true }, create)
    expect(create).not.toHaveBeenCalled()
    expect(r.meta.reason).toBe('skipped')
  })
  it('a refused layout keeps the answer as written but still counts its tokens', async () => {
    const r = await step({}, vi.fn(async () => reply(j({ ...GOOD, say: 'You wrote $99,999.' }))))
    expect(r.payload).toBeNull()
    expect(r.meta.reason).toMatch(/^unknown_figures/)
    expect(r.usage?.input_tokens).toBe(700)
  })
  it('a cut-off reply, an error and a timeout all fall back', async () => {
    expect((await step({}, vi.fn(async () => reply(j(GOOD), 'max_tokens')))).payload).toBeNull()
    expect((await step({}, vi.fn(async () => { throw new Error('boom') }))).meta.reason).toBe('error')
    vi.useFakeTimers()
    try {
      const p = step({ timeoutMs: 50 }, vi.fn(() => new Promise<AI.Message>(() => {})))
      await vi.advanceTimersByTimeAsync(60)
      expect((await p).meta).toMatchObject({ via: 'none', reason: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the chat turn passes the layout on only for the answer as written', () => {
  const TENANT = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: 'America/New_York', settings: {} } as unknown as Tenant
  const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', role: 'owner', timezone: 'America/New_York' } as unknown as Member
  const payload = (acceptFormatter(j(GOOD), input) as { ok: true; result: ReplyFormatPayload }).result
  const noGate = { load: async () => null, save: async () => null, claim: async () => null, clear: async () => {}, execute: async () => [] } as never
  it('CONTROL: an answer with a layout and nothing else', async () => {
    const run = vi.fn(async (): Promise<RunAgentResult> => ({ replyText: DRAFT, intentsToExecute: [], replyFormat: payload }))
    const t = await runChatTurn({ tenant: TENANT, member: DANA, text: 'How did last week go?', history: [], channel: 'app', gate: noGate, run: run as never })
    expect(t.reply).toBe(DRAFT)
    expect(t.format).toBe(payload)
  })
  it('a choice or an error drops it', async () => {
    const choice = vi.fn(async (): Promise<RunAgentResult> => ({ replyText: DRAFT, intentsToExecute: [], replyFormat: payload, choice: { prompt: 'Which week?', options: [{ label: 'This', value: 'this' }] } as never }))
    expect((await runChatTurn({ tenant: TENANT, member: DANA, text: 'x', history: [], channel: 'app', gate: noGate, run: choice as never })).format).toBeUndefined()
    const failed = vi.fn(async (): Promise<RunAgentResult> => ({ replyText: DRAFT, intentsToExecute: [], replyFormat: payload, error: 'timeout' }))
    expect((await runChatTurn({ tenant: TENANT, member: DANA, text: 'x', history: [], channel: 'app', gate: noGate, run: failed as never })).format).toBeUndefined()
  })
  it('a spoken turn asks runAgent for no layout', async () => {
    const run = vi.fn(async (): Promise<RunAgentResult> => ({ replyText: 'ok', intentsToExecute: [] }))
    await runChatTurn({ tenant: TENANT, member: DANA, text: 'x', history: [], channel: 'app', gate: noGate, voice: true, run: run as never })
    expect((run.mock.calls[0] as unknown as [{ voice?: boolean }])[0].voice).toBe(true)
  })
})

// ── the renderers ────────────────────────────────────────────────────────

describe('FormattedAnswer', () => {
  const html = (p: ReplyFormatPayload, text = DRAFT) => renderToStaticMarkup(createElement(FormattedAnswer, { format: p, text }))
  const rows = Array.from({ length: 7 }, (_, i) => [`Producer ${i + 1}`, `$${(i + 1) * 1000}`, String(i + 1)])
  const P: ReplyFormatPayload = {
    v: 1, format: 'mixed', say: 'Premium was $48,200.', after: 'Dana Reyes led.',
    blocks: [
      { type: 'callout', tone: 'watch', text: 'Lee Park is lowest.' },
      { type: 'numbers', tiles: [{ label: 'Premium', value: '$48,200' }, { label: 'Policies', value: '31' }] },
      normalizeTableBlock({ columns: ['Producer', 'Premium', 'Policies'], rows })!,
      { type: 'chart', kind: 'bar', points: [{ label: 'Dana', value: 18400, display: '$18,400' }, { label: 'Sam', value: 16300, display: '$16,300' }] },
      { type: 'chart', kind: 'line', points: [{ label: 'Oct 5', value: 3, display: '3' }, { label: 'Oct 12', value: 5, display: '5' }, { label: 'Oct 19', value: 4, display: '4' }] },
      { type: 'chart', kind: 'split', points: [{ label: 'Life', value: 3, display: '3' }, { label: 'Annuity', value: 1, display: '1' }] },
      { type: 'steps', items: ['Open Settings', 'Connect QuickBooks', 'Ask again'] },
    ],
  }
  it('draws the words, every visual, the takeaway and the answer as written behind "Full answer"', () => {
    const out = html(P)
    for (const id of ['ciao-formatted', 'ciao-format-callout', 'ciao-format-numbers', 'ciao-format-table', 'ciao-format-bar', 'ciao-format-line', 'ciao-format-split', 'ciao-format-steps', 'ciao-format-full']) {
      expect(out).toContain(`data-testid="${id}"`)
    }
    expect(out.indexOf('Premium was $48,200.')).toBeLessThan(out.indexOf('ciao-format-callout'))
    expect(out).toContain('Full answer')
    expect(out).toContain('Lee is the one to watch')
    expect(out).toContain('>Watch<')
    // Split legend: count and percent.
    expect(out).toContain('>75%<')
    // Line: first and last label only, the latest figure big.
    expect(out).toContain('cx-rf-line-figure">4<')
    expect(out).not.toContain('>Oct 12<')
    expect((out.match(/>Oct 19</g) ?? []).length).toBe(1)
  })
  it('a table shows 5 rows then "Show all"; figures are right-aligned columns', () => {
    const out = html({ ...P, blocks: [P.blocks[2]] })
    expect(TABLE_ROWS_SHOWN).toBe(5)
    expect((out.match(/<tr/g) ?? []).length).toBe(1 + 5)
    expect(out).toContain('Show all 7')
    expect(out).toContain('<th scope="col" data-num="">Premium</th>')
    expect(html({ ...P, blocks: [normalizeTableBlock({ columns: ['A', 'B'], rows: [['x', '1'], ['y', '2']] })!] })).not.toContain('Show all')
  })
  it('the CSS uses theme tokens only and gives the table its own scroller', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'app/components/cxo/reply-format.css'), 'utf8')
    expect(css).toMatch(/\.cx-rf-table-scroll \{[^}]*overflow-x: auto/)
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
