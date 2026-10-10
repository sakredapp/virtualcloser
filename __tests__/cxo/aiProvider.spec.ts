/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const ENV_KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'PLATFORM_ASSISTANT_MODEL_ID', 'OPENROUTER_VISION_MODEL', 'OPENROUTER_REASONING']
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
  vi.resetModules()
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

const isBadForText = (m: string) => /haiku|sonnet|opus|claude/i.test(m)

// Model labels a call site may still pass; all are ignored for routing.
const CALLER_MODELS = ['claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4', 'us.anthropic.claude-sonnet-4-6']

describe('aiProvider routing', () => {
  it('sends every text-only call to GLM on OpenRouter when the key is set, whatever model the caller named', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    const { routeFor } = await import('@/lib/aiProvider')
    for (const model of CALLER_MODELS) {
      const r = routeFor({ model, messages: [{ role: 'user', content: 'hi' }] })
      expect(r.provider).toBe('openrouter')
      expect(r.model).toMatch(/glm/i)
      expect(isBadForText(r.model)).toBe(false)
    }
  })

  it('ignores a non-GLM PLATFORM_ASSISTANT_MODEL_ID (never Sonnet or Haiku for text)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    for (const bad of ['openrouter:anthropic/claude-haiku-4.5', 'openrouter:anthropic/claude-sonnet-4.6', 'us.anthropic.claude-haiku-4-5', 'claude-sonnet-4-6']) {
      process.env.PLATFORM_ASSISTANT_MODEL_ID = bad
      vi.resetModules()
      const { routeFor } = await import('@/lib/aiProvider')
      const r = routeFor({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'x' }] })
      expect(r.model).toBe('openrouter:z-ai/glm-5.3')
    }
    process.env.PLATFORM_ASSISTANT_MODEL_ID = 'openrouter:z-ai/glm-5.2'
    vi.resetModules()
    const { routeFor } = await import('@/lib/aiProvider')
    expect(routeFor({ model: 'x', messages: [{ role: 'user', content: 'x' }] }).model).toBe('openrouter:z-ai/glm-5.2')
  })

  it('refuses a raw PDF block: PDFs are turned into text on the server first', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    const { routeFor } = await import('@/lib/aiProvider')
    expect(() =>
      routeFor({
        messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AA==' } }, { type: 'text', text: 'read' }] as any }],
      }),
    ).toThrow(/Extract the text first/)
  })

  it('sends image blocks to the OpenRouter vision model (GLM-4.5V), never Anthropic', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    const { routeFor } = await import('@/lib/aiProvider')
    const r = routeFor({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }, { type: 'text', text: 'what is this' }] }] })
    expect(r).toEqual({ provider: 'openrouter', reason: 'vision', model: 'openrouter:z-ai/glm-4.5v' })
    expect(isBadForText(r.model)).toBe(false)
  })

  it('fails clearly when OpenRouter is not configured (no fallback to anything)', async () => {
    const { routeFor, AINotConfiguredError } = await import('@/lib/aiProvider')
    expect(() => routeFor({ messages: [{ role: 'user', content: 'hi' }] })).toThrow(AINotConfiguredError)
  })

  it('refuses Haiku and every Anthropic model id, including as a vision override', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    const { routeFor, assertModelAllowed } = await import('@/lib/aiProvider')
    for (const bad of ['claude-haiku-4-5', 'us.anthropic.claude-3-5-haiku', 'openrouter:anthropic/claude-sonnet-4.6', 'claude-opus-4', 'openrouter:anthropic/claude-haiku-4.5']) {
      expect(() => assertModelAllowed(bad)).toThrow(/ai-guard/)
    }
    expect(() => assertModelAllowed('openrouter:z-ai/glm-5.3')).not.toThrow()
    process.env.OPENROUTER_VISION_MODEL = 'openrouter:anthropic/claude-haiku-4.5'
    expect(() =>
      routeFor({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] }] }),
    ).toThrow(/ai-guard/)
  })
})

describe('getAI() end to end with a mocked OpenRouter', () => {
  it('runs a tool-calling turn on GLM with data_collection=deny and returns content blocks', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) })
      return new Response(JSON.stringify({
        id: 'gen-1',
        choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{"q":"premium"}' } }] } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }), { status: 200 })
    }))
    const { getAI } = await import('@/lib/ai')
    const msg = await getAI().messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: [{ type: 'text', text: 'You are Mira.', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Now: Friday' }],
      tools: [{ name: 'lookup', description: 'Look up', input_schema: { type: 'object', properties: { q: { type: 'string' } } }, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'auto' },
      messages: [
        { role: 'user', content: 'what is issued premium' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_0', name: 'lookup', input: { q: 'x' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_0', content: '' }] },
      ],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('openrouter.ai')
    const body = calls[0].body as Record<string, any>
    expect(body.model).toBe('z-ai/glm-5.3')
    expect(isBadForText(body.model)).toBe(false)
    expect(body.provider.data_collection).toBe('deny')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Mira.\nNow: Friday' })
    expect(body.messages[2].tool_calls[0]).toMatchObject({ id: 'call_0', function: { name: 'lookup', arguments: '{"q":"x"}' } })
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: '(the tool returned nothing)' })
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: { q: { type: 'string' } } } } })
    expect(msg.model).toBe('openrouter:z-ai/glm-5.3')
    expect(msg.stop_reason).toBe('tool_use')
    expect(msg.content[0]).toMatchObject({ type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'premium' } })
    expect(msg.usage.input_tokens).toBe(1000)
  })

  it('maps a forced tool_choice and streams text for stream:true callers', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello there' } }], usage: {} }), { status: 200 })
    }))
    const { getAI } = await import('@/lib/ai')
    await getAI().messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 10,
      tools: [{ name: 'record', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'record' },
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(bodies[0].tool_choice).toEqual({ type: 'function', function: { name: 'record' } })
    const stream = await getAI().messages.create({ model: 'claude-sonnet-4-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }], stream: true })
    let text = ''
    for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') text += ev.delta.text
    expect(text).toBe('Hello there')
  })
})

describe('pricing', () => {
  it('prices GLM-5 at $1.20/$3.20, GLM-5.3 at $1.40/$4.40 and Sonnet at $3/$15 per Mtok', async () => {
    const { estimateCostUsd } = await import('@/lib/aiProvider')
    expect(estimateCostUsd('zai.glm-5', 1_000_000, 1_000_000)).toBeCloseTo(4.4)
    expect(estimateCostUsd('openrouter:z-ai/glm-5.3', 1_000_000, 1_000_000)).toBeCloseTo(5.8)
    expect(estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(18)
  })
})

describe('source scan', () => {
  const root = path.resolve(__dirname, '../..')
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
    }
  }
  walk(path.join(root, 'lib'))
  walk(path.join(root, 'app'))

  it('names no haiku model anywhere in app code', () => {
    const hits = files.filter((f) => !f.endsWith('aiProvider.ts') && /(claude[\w.-]*haiku|haiku-\d)/i.test(fs.readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })

  it('has no Anthropic SDK and no direct Anthropic API call anywhere in app/ or lib/', () => {
    const hits = files.filter((f) => {
      const s = fs.readFileSync(f, 'utf8')
      return /@anthropic-ai\/sdk/.test(s) || /api\.anthropic\.com/.test(s) || /new Anthropic\(/.test(s)
    })
    expect(hits).toEqual([])
  })

  it('does not list @anthropic-ai/sdk as a dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect({ ...pkg.dependencies, ...pkg.devDependencies }['@anthropic-ai/sdk']).toBeUndefined()
  })
})
