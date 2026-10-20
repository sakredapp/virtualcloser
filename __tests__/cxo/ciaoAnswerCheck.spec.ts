import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import type * as AI from '@/lib/aiTypes'
import {
  answerCheckEnabled,
  checkAnswer,
  checkTimeoutMs,
  collectToolContext,
  modelLeaks,
  parseVerdict,
  scrubModelLeaks,
  type CreateFn,
} from '@/lib/agent/answerCheck'

const msg = (text: string, stop: AI.Message['stop_reason'] = 'end_turn'): AI.Message =>
  ({
    id: 'm1',
    type: 'message',
    role: 'assistant',
    model: 'openrouter:z-ai/glm-5.3',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as AI.Message

const base = {
  question: 'What did we write in premium last week?',
  toolContext: '[revenue_summary]\n{"week":"2026-10-12","premium_written":48200}',
  assistantName: 'Ciao',
  employee: false,
  log: () => {},
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Ciao answer check', () => {
  it('ok: the draft is shown unchanged and marked checked', async () => {
    const create: CreateFn = vi.fn(async () => msg('{"ok": true, "issues": []}'))
    const r = await checkAnswer({ ...base, draft: 'You wrote $48,200 last week.', create })
    expect(r.text).toBe('You wrote $48,200 last week.')
    expect(r.meta).toMatchObject({ checked: true, revised: false })
    expect(r.usage).toMatchObject({ input_tokens: 900, output_tokens: 40 })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('revised: a wrong number against the data is replaced by the revision', async () => {
    const create: CreateFn = async () =>
      msg('```json\n{"ok": false, "issues": ["wrong_fact: premium is 48,200 not 84,200"], "revised": "You wrote $48,200 last week."}\n```')
    const r = await checkAnswer({ ...base, draft: 'You wrote $84,200 last week.', create })
    expect(r.text).toBe('You wrote $48,200 last week.')
    expect(r.meta).toMatchObject({ checked: true, revised: true })
    expect(r.meta.issues?.[0]).toMatch(/wrong_fact/)
  })

  it('revised: a needless refusal becomes the answer from the data', async () => {
    const create: CreateFn = async () => msg('{"ok":false,"issues":["needless_refusal"],"revised":"You wrote $48,200 in premium last week."}')
    const r = await checkAnswer({ ...base, draft: "I can't see revenue numbers.", create })
    expect(r.text).toBe('You wrote $48,200 in premium last week.')
    expect(r.meta.revised).toBe(true)
  })

  it('not ok without a revision: the draft is shown', async () => {
    const create: CreateFn = async () => msg('{"ok":false,"issues":["unsupported: 12 new hires"]}')
    const r = await checkAnswer({ ...base, draft: 'You wrote $48,200.', create })
    expect(r.text).toBe('You wrote $48,200.')
    expect(r.meta).toMatchObject({ checked: true, revised: false })
  })

  it('timeout: falls back to the draft fast and aborts the call', async () => {
    let signal: AbortSignal | undefined
    const create: CreateFn = (_p, _m, opts) => {
      signal = opts.signal
      return new Promise(() => {})
    }
    const t0 = Date.now()
    const r = await checkAnswer({ ...base, draft: 'You wrote $48,200.', create, timeoutMs: 50 })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(r.text).toBe('You wrote $48,200.')
    expect(r.meta).toMatchObject({ checked: false, revised: false, reason: 'timeout' })
    expect(signal?.aborted).toBe(true)
  })

  it('error: a failed call falls back to the draft', async () => {
    const create: CreateFn = async () => {
      throw new Error('openrouter z-ai/glm-5.3 HTTP 500: boom')
    }
    const r = await checkAnswer({ ...base, draft: 'You wrote $48,200.', create })
    expect(r.text).toBe('You wrote $48,200.')
    expect(r.meta).toMatchObject({ checked: false, reason: 'error' })
  })

  it('bad JSON: falls back to the draft', async () => {
    for (const raw of ['Looks fine to me!', '{"issues": []}', '{ok: true', '']) {
      const r = await checkAnswer({ ...base, draft: 'You wrote $48,200.', create: async () => msg(raw) })
      expect(r.text).toBe('You wrote $48,200.')
      expect(r.meta).toMatchObject({ checked: false, reason: 'bad_json' })
    }
    // A verdict cut off at max_tokens is never trusted.
    const cut = await checkAnswer({ ...base, draft: 'You wrote $48,200.', create: async () => msg('{"ok":false,"issues":[],"revised":"Yo', 'max_tokens') })
    expect(cut.meta.reason).toBe('bad_json')
  })

  it('model-name leak: the checker revision is used, and the scrub removes what is left', async () => {
    const draft = "I'm built on GLM-5.3 via OpenRouter. You wrote $48,200 last week."
    const fixed = await checkAnswer({
      ...base,
      draft,
      create: async () => msg('{"ok":false,"issues":["model_leak"],"revised":"You wrote $48,200 last week."}'),
    })
    expect(fixed.text).toBe('You wrote $48,200 last week.')
    expect(modelLeaks(fixed.text)).toEqual([])

    // The checker missed it (said ok): the deterministic scrub still drops the sentence.
    const missed = await checkAnswer({ ...base, draft, create: async () => msg('{"ok":true,"issues":[]}') })
    expect(missed.text).toBe('You wrote $48,200 last week.')
    expect(missed.meta).toMatchObject({ checked: true, revised: true })

    // The checker is down: the scrub still runs.
    const down = await checkAnswer({ ...base, draft, create: async () => Promise.reject(new Error('x')) })
    expect(down.text).not.toMatch(/glm|openrouter/i)

    // A revision that itself names a model is refused.
    const bad = await checkAnswer({
      ...base,
      draft: 'You wrote $48,200 last week.',
      create: async () => msg('{"ok":false,"issues":["x"],"revised":"As an OpenAI model, you wrote $48,200."}'),
    })
    expect(bad.text).toBe('You wrote $48,200 last week.')
    expect(bad.meta.reason).toBe('bad_revision')
  })

  it('model names the person or the data brought up are left alone (an OpenAI bill)', () => {
    const q = 'How much did we pay OpenAI in September?'
    expect(modelLeaks('You paid OpenAI $212 in September.', q)).toEqual([])
    expect(scrubModelLeaks('You paid OpenAI $212 in September.', 'Ciao', q).scrubbed).toBe(false)
    expect(scrubModelLeaks('I am an LLM.', 'Ciao').text).toMatch(/^I'm Ciao/)
  })

  it('reads tool results of this run only, labelled by tool', () => {
    const messages: AI.MessageParam[] = [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'old_tool', input: {} }] as unknown as AI.ContentBlockParam[] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old', content: 'OLD DATA' }] as unknown as AI.ContentBlockParam[] },
      { role: 'user', content: 'premium last week?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'revenue_summary', input: {} }] as unknown as AI.ContentBlockParam[] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"premium_written":48200}' }] as unknown as AI.ContentBlockParam[] },
    ]
    const ctx = collectToolContext(messages, 3)
    expect(ctx).toContain('[revenue_summary]')
    expect(ctx).toContain('48200')
    expect(ctx).not.toContain('OLD DATA')
  })

  it('parses lenient verdicts', () => {
    expect(parseVerdict('Here you go: {"ok": true, "issues": []} thanks')).toEqual({ ok: true, issues: [] })
    expect(parseVerdict('{"ok": "yes"}')).toBeNull()
  })

  it('flag is on by default and off with CIAO_ANSWER_CHECK=0; timeout default is a few seconds', () => {
    expect(answerCheckEnabled({})).toBe(true)
    for (const v of ['0', 'off', 'false', 'OFF']) expect(answerCheckEnabled({ CIAO_ANSWER_CHECK: v })).toBe(false)
    expect(checkTimeoutMs({})).toBe(6000)
    expect(checkTimeoutMs({ CIAO_ANSWER_CHECK_TIMEOUT_MS: '3000' })).toBe(3000)
  })

  it('the checker prompt never names a model and runAgent wires it for Suite CXO', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/agent/answerCheck.ts'), 'utf8')
    expect(src.toLowerCase()).not.toContain('uncensored')
    const run = fs.readFileSync(path.join(__dirname, '../../lib/agent/runAgent.ts'), 'utf8')
    expect(run).toMatch(/isCxo && replyText && !collectedChoice/)
    expect(run).toMatch(/checkAnswer\(/)
  })
})
