import type * as AI from './aiTypes'

/**
 * ONE provider layer for every AI call in Suite CXO.
 *
 * Owner 2026-10-10: every AI call goes through OpenRouter. No Anthropic API,
 * no Anthropic SDK, no Claude models, no Haiku, and no fallback rail.
 * Text work goes to GLM on OpenRouter, the same model and env names the
 * crmbuilds platform uses for Mira's brain (`openrouter:z-ai/glm-5.3`,
 * OPENROUTER_API_KEY, OPENROUTER_PROVIDER_ORDER, ...). Mirrors
 * crmbuilds api/_lib/openai-converse.ts (request body, reasoning default,
 * tool-call markup guard) and api/_lib/bedrock-model-guard.ts (Haiku ban).
 *
 * Call sites speak content blocks (lib/aiTypes.ts): getAI().messages.create()
 * takes block-shaped messages/tools and returns a block-shaped Message.
 * routeFor() decides the model:
 *
 *   - text only            -> GLM-5.3 on OpenRouter (any model the caller
 *                             named is ignored)
 *   - an image block       -> GLM-4.5V on OpenRouter (vision). PDFs never
 *                             reach a model: their text is extracted on the
 *                             server first (lib/extractText.ts).
 *   - OPENROUTER_API_KEY missing -> a clear error. There is no fallback.
 *
 * Privacy: every OpenRouter request carries provider.data_collection='deny',
 * so Pinnacle data only reaches hosts that neither store nor train on it.
 */

// ---------------------------------------------------------------------------
// Models + guard

/** Mira's brain on crmbuilds (platform-assistant-llm.ts DEFAULT_TEST_TRAFFIC_MODEL). */
export const DEFAULT_TEXT_MODEL = 'openrouter:z-ai/glm-5.3'

/**
 * Vision model, for a request that carries an image. Z.ai's GLM-4.5V on
 * OpenRouter: same model family as the text brain, not Anthropic, not Haiku.
 */
export const VISION_MODEL_DEFAULT = 'openrouter:z-ai/glm-4.5v'

/**
 * Owner rulings: Haiku is banned platform-wide (2026-10-08), and Suite CXO
 * never calls an Anthropic model (2026-10-10).
 */
export const OWNER_BANNED_MODEL_FRAGMENTS: readonly string[] = ['haiku', 'claude', 'anthropic', 'sonnet', 'opus']

export function checkModelAllowed(modelId: string | undefined | null): { ok: boolean; reason?: string } {
  const id = String(modelId ?? '').trim().toLowerCase()
  if (!id) return { ok: false, reason: 'model id is empty' }
  for (const frag of OWNER_BANNED_MODEL_FRAGMENTS) {
    if (id.includes(frag)) {
      return {
        ok: false,
        reason: `model "${modelId}" matches "${frag}": Anthropic models (and Haiku above all) are banned in Suite CXO (owner rulings 2026-10-08 and 2026-10-10). All AI runs on OpenRouter: GLM for text, GLM-4.5V for images.`,
      }
    }
  }
  if (!id.startsWith('openrouter:')) {
    return { ok: false, reason: `model "${modelId}" is not an OpenRouter model id (openrouter:...). All AI runs on OpenRouter.` }
  }
  return { ok: true }
}

export function assertModelAllowed(modelId: string | undefined | null): void {
  const r = checkModelAllowed(modelId)
  if (!r.ok) throw new Error(`[ai-guard] ${r.reason}`)
}

/** True when the OpenRouter rail is configured (names only, never values). */
export function openRouterConfigured(): boolean {
  return Boolean((process.env.OPENROUTER_API_KEY || '').trim())
}

/** Thrown when an AI call is made with no OPENROUTER_API_KEY. Never a silent fallback. */
export class AINotConfiguredError extends Error {
  constructor() {
    super('AI is not configured: OPENROUTER_API_KEY is not set. Suite CXO runs all AI on OpenRouter and has no fallback.')
    this.name = 'AINotConfiguredError'
  }
}

/**
 * The text model. PLATFORM_ASSISTANT_MODEL_ID is the crmbuilds name for Mira's
 * brain; honoured only when it is an OpenRouter GLM id, else the GLM default.
 */
let textOverrideWarned = false
export function textModelId(): string {
  const env = (process.env.PLATFORM_ASSISTANT_MODEL_ID || '').trim()
  // Only a GLM id on OpenRouter is honoured: anything else here would quietly
  // put text work on an expensive or banned model.
  const ok = /^openrouter:.*glm/i.test(env) && checkModelAllowed(env).ok
  if (env && !ok && !textOverrideWarned) {
    textOverrideWarned = true
    console.warn(`[ai] PLATFORM_ASSISTANT_MODEL_ID is not an OpenRouter GLM id; using ${DEFAULT_TEXT_MODEL}.`)
  }
  return ok ? env : DEFAULT_TEXT_MODEL
}

/** The vision model. OPENROUTER_VISION_MODEL may override it with another allowed OpenRouter id. */
export function visionModelId(): string {
  const id = (process.env.OPENROUTER_VISION_MODEL || '').trim() || VISION_MODEL_DEFAULT
  assertModelAllowed(id)
  return id
}

/** "openrouter:z-ai/glm-5.3" -> "z-ai/glm-5.3" (the id OpenRouter expects). */
export function openRouterWireModel(id: string): string {
  return id.replace(/^openrouter:/i, '')
}

// ---------------------------------------------------------------------------
// Routing

type CreateParams = AI.MessageCreateParams

function blockType(b: unknown): string | undefined {
  return b && typeof b === 'object' ? (b as { type?: string }).type : undefined
}

function someBlock(params: Pick<CreateParams, 'messages'>, pred: (t: string | undefined) => boolean): boolean {
  const hit = (b: unknown): boolean => {
    if (pred(blockType(b))) return true
    if (blockType(b) === 'tool_result') {
      const c = (b as { content?: unknown }).content
      return Array.isArray(c) && c.some(hit)
    }
    return false
  }
  return (params.messages || []).some((m) => Array.isArray(m.content) && (m.content as unknown[]).some(hit))
}

/** Does the request carry an image block anywhere (messages or tool results)? */
export function hasVisionBlocks(params: Pick<CreateParams, 'messages'>): boolean {
  return someBlock(params, (t) => t === 'image')
}

export type Route = { provider: 'openrouter'; model: string; reason: 'text' | 'vision' }

export function routeFor(params: Pick<CreateParams, 'messages' | 'model'>): Route {
  // A raw PDF never goes to a model: extract its text on the server first.
  if (someBlock(params, (t) => t === 'document')) {
    throw new Error('[ai] PDF blocks are not sent to a model. Extract the text first (lib/extractText.ts) and send that.')
  }
  if (!openRouterConfigured()) throw new AINotConfiguredError()
  if (hasVisionBlocks(params)) return { provider: 'openrouter', model: visionModelId(), reason: 'vision' }
  return { provider: 'openrouter', model: textModelId(), reason: 'text' }
}

// ---------------------------------------------------------------------------
// Content blocks -> OpenAI (OpenRouter) request

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAiUserPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
type OpenAiToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type OpenAiUserPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

/** An image block as an OpenAI image_url part (a data: URL for base64). */
function imagePart(b: Record<string, unknown>): OpenAiUserPart | null {
  const src = b.source as { type?: string; media_type?: string; data?: string; url?: string } | undefined
  if (!src) return null
  if (src.type === 'url' && src.url) return { type: 'image_url', image_url: { url: src.url } }
  if (src.type === 'base64' && src.data) return { type: 'image_url', image_url: { url: `data:${src.media_type || 'image/png'};base64,${src.data}` } }
  return null
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: string }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/** Never an empty tool result: an empty block is a hard 400 on most hosts. */
function nonEmpty(s: string, fallback: string): string {
  return s && s.trim() ? s : fallback
}

export function toOpenAiMessages(system: CreateParams['system'], messages: CreateParams['messages']): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  const sys = textOf(system as unknown)
  if (sys.trim()) out.push({ role: 'system', content: sys })
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content })
      else out.push({ role: 'user', content: m.content })
      continue
    }
    const blocks = m.content as unknown as Array<Record<string, unknown>>
    if (m.role === 'assistant') {
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''))
        .join('\n')
        .trim()
      const calls: OpenAiToolCall[] = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: String(b.id),
          type: 'function',
          function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push(calls.length ? { role: 'assistant', content: text || null, tool_calls: calls } : { role: 'assistant', content: text || '(no content)' })
      continue
    }
    // user turn: tool results become `tool` messages (they must follow the
    // assistant tool_calls directly), then any plain text.
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue
      const body = nonEmpty(textOf(b.content), '(the tool returned nothing)')
      out.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: b.is_error ? `Error: ${body}` : body })
    }
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('\n')
      .trim()
    // Images (the vision route) ride in the same user turn as image_url parts,
    // including any an earlier tool result carried.
    const images = blocks
      .flatMap((b) => (b.type === 'image' ? [b] : b.type === 'tool_result' && Array.isArray(b.content) ? (b.content as Array<Record<string, unknown>>).filter((c) => c.type === 'image') : []))
      .map(imagePart)
      .filter((x): x is OpenAiUserPart => Boolean(x))
    if (images.length) out.push({ role: 'user', content: [...(text ? [{ type: 'text' as const, text }] : []), ...images] })
    else if (text) out.push({ role: 'user', content: text })
  }
  return out
}

export function toOpenAiTools(tools: CreateParams['tools']): unknown[] | undefined {
  if (!tools?.length) return undefined
  return tools
    .filter((t) => 'input_schema' in t)
    .map((t) => {
      const tool = t as AI.Tool
      return {
        type: 'function',
        function: { name: tool.name, description: tool.description ?? '', parameters: tool.input_schema },
      }
    })
}

function toOpenAiToolChoice(tc: CreateParams['tool_choice']): unknown {
  if (!tc) return undefined
  if (tc.type === 'auto') return 'auto'
  if (tc.type === 'any') return 'required'
  if (tc.type === 'tool') return { type: 'function', function: { name: tc.name } }
  return 'none'
}

const GLM_FAMILY_RE = /glm/i

export function buildOpenRouterBody(params: CreateParams, modelId: string): Record<string, unknown> {
  const model = openRouterWireModel(modelId)
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(params.system, params.messages),
    max_tokens: params.max_tokens,
  }
  if (params.temperature !== undefined) body.temperature = params.temperature
  if (params.stop_sequences?.length) body.stop = params.stop_sequences
  const tools = toOpenAiTools(params.tools)
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = toOpenAiToolChoice(params.tool_choice) ?? 'auto'
  }
  // Same provider block as crmbuilds openai-converse.ts. data_collection=deny
  // and zdr on EVERY request: only hosts that neither train on nor retain
  // prompts (zero data retention). Client data never sits on an AI host.
  // Host order + quantization pins are tuned for the GLM text model only.
  const glm = GLM_FAMILY_RE.test(model) && modelId === textModelId()
  const split = (v: string | undefined) => (v || '').split(',').map((x) => x.trim()).filter(Boolean)
  const order = glm ? split(process.env.OPENROUTER_PROVIDER_ORDER) : []
  const quant = glm ? split(process.env.OPENROUTER_QUANTIZATIONS || 'bf16,fp8') : []
  body.provider = {
    ...(order.length ? { order } : {}),
    allow_fallbacks: (process.env.OPENROUTER_ALLOW_FALLBACKS || '1') === '1',
    ...(quant.length ? { quantizations: quant } : {}),
    data_collection: 'deny',
    zdr: true,
  }
  body.usage = { include: true }
  // GLM thinks by default on OpenRouter and can spend the whole budget on it.
  // OFF unless OPENROUTER_REASONING says otherwise (crmbuilds default).
  const rz = (process.env.OPENROUTER_REASONING || 'off').trim().toLowerCase()
  if (rz === 'off') body.reasoning = { enabled: false }
  else if (rz !== 'on') body.reasoning = { effort: rz }
  return body
}

// ---------------------------------------------------------------------------
// OpenAI (OpenRouter) response -> Message

/** GLM tool-call markup leaking into text is never a reply (crmbuilds TOOL_CALL_MARKUP_RE). */
export const TOOL_CALL_MARKUP_RE = /<\/?tool_call>|<\|tool_call\|>|<\|tool_calls_begin\|>/i

type OpenAiResponse = {
  id?: string
  model?: string
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | Array<{ text?: string }> | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    cost?: number
  }
}

export function fromOpenAiResponse(json: OpenAiResponse, modelId: string): AI.Message {
  const choice = json.choices?.[0] ?? {}
  const msg = choice.message ?? {}
  const text =
    typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c) => c.text || '').join('')
        : ''
  if (text && TOOL_CALL_MARKUP_RE.test(text) && !(msg.tool_calls || []).length) {
    throw new Error(`glm_toolcall_markup_in_text: ${modelId} returned unparsed tool-call markup as text`)
  }
  const content: AI.ContentBlock[] = []
  if (text && text.trim()) content.push({ type: 'text', text: text.trim(), citations: null } as AI.TextBlock)
  ;(msg.tool_calls || []).forEach((tc, i) => {
    let input: unknown = {}
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
    } catch {
      input = { _raw: tc.function?.arguments }
    }
    content.push({
      type: 'tool_use',
      id: tc.id || `toolu_or_${Date.now().toString(36)}_${i}`,
      name: String(tc.function?.name ?? ''),
      input,
    } as AI.ToolUseBlock)
  })
  const fr = choice.finish_reason
  const hasToolUse = content.some((b) => b.type === 'tool_use')
  const stop_reason: AI.Message['stop_reason'] =
    fr === 'tool_calls' || fr === 'function_call' || hasToolUse ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end_turn'
  const u = json.usage ?? {}
  return {
    id: json.id || `msg_or_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    // Our id ("openrouter:z-ai/glm-5.3"), so usage logs and cost estimates
    // can tell which rail ran.
    model: modelId,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      cache_creation_input_tokens: 0,
    },
  } as AI.Message
}

// ---------------------------------------------------------------------------
// Transport

const KEY_SHAPED_RE = /(sk-[A-Za-z0-9_-]{6,}|Bearer\s+\S+)/g
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function openRouterCreate(params: CreateParams, modelId: string): Promise<AI.Message> {
  assertModelAllowed(modelId)
  const key = (process.env.OPENROUTER_API_KEY || '').trim()
  if (!key) throw new AINotConfiguredError()
  const endpoint = process.env.OPENROUTER_CHAT_URL || 'https://openrouter.ai/api/v1/chat/completions'
  const body = buildOpenRouterBody(params, modelId)
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
    'HTTP-Referer': 'https://suitecxo.com',
    'X-Title': 'Suite CXO',
  }
  let adjusted = 0
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
    const raw = await res.text()
    let json: (OpenAiResponse & { error?: { message?: string } }) | null = null
    try {
      json = JSON.parse(raw)
    } catch {
      /* not JSON */
    }
    if (res.ok && json && !json.error) return fromOpenAiResponse(json, modelId)
    const errMsg = String(json?.error?.message || raw || '')
    // "Reasoning is mandatory for this endpoint" -> low effort, once (crmbuilds).
    if (res.status === 400 && /reasoning is mandatory/i.test(errMsg) && adjusted < 2) {
      body.reasoning = { effort: 'low' }
      adjusted++
      continue
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const ra = Number(res.headers.get('retry-after')) || 0
      await sleep(ra ? ra * 1000 : 800 * 2 ** attempt)
      continue
    }
    const detail = errMsg.slice(0, 300).replace(KEY_SHAPED_RE, '[redacted]')
    const e = new Error(`openrouter ${openRouterWireModel(modelId)} HTTP ${res.status}: ${detail}`) as Error & { status?: number }
    e.status = res.status
    throw e
  }
}

/** Minimal stream shape for callers that pass stream: true (one text delta). */
export async function* messageAsStream(msg: AI.Message): AsyncGenerator<AI.MessageStreamEvent> {
  yield { type: 'message_start', message: { ...msg, content: [] } } as AI.MessageStreamEvent
  let i = 0
  for (const b of msg.content) {
    if (b.type === 'text') {
      yield { type: 'content_block_start', index: i, content_block: { type: 'text', text: '', citations: null } } as AI.MessageStreamEvent
      yield { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } } as AI.MessageStreamEvent
      yield { type: 'content_block_stop', index: i } as AI.MessageStreamEvent
      i++
    }
  }
  yield { type: 'message_delta', delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: msg.usage.output_tokens } } as AI.MessageStreamEvent
  yield { type: 'message_stop' } as AI.MessageStreamEvent
}

// ---------------------------------------------------------------------------
// Pricing ($ per million tokens). Same cards as crmbuilds bedrock-tracker.ts.

const PRICES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /glm-5\.[23]/i, input: 1.4, output: 4.4 },
  { match: /glm-5/i, input: 1.2, output: 3.2 },
  { match: /glm-4\.5v/i, input: 0.6, output: 1.8 },
  { match: /opus/i, input: 15, output: 75 },
  { match: /sonnet/i, input: 3, output: 15 },
]

/** $/Mtok for a model id. Opus/Sonnet cards stay only to price old usage rows. Unknown ids price at the conservative pre-GLM rate. */
export function pricesFor(modelId: string | null | undefined): { input: number; output: number } {
  const id = String(modelId ?? '')
  const p = PRICES.find((x) => x.match.test(id))
  return p ? { input: p.input, output: p.output } : { input: 3, output: 15 }
}

export function estimateCostUsd(modelId: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const p = pricesFor(modelId)
  return ((inputTokens || 0) * p.input + (outputTokens || 0) * p.output) / 1_000_000
}

/** The model a text-only call runs on right now (for logs that never saw a response). */
export function activeTextModel(): string {
  return textModelId()
}
