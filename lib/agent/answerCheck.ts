/**
 * The Ciao answer check (owner 2026-10-19): a second, short pass over every
 * Ciao answer before the person sees it, so suitecxo.com's "Every answer is
 * checked before your team sees it." is true.
 *
 * runAgent drafts the answer; this pass gets the person's question, the data
 * Ciao read for it (tool results this turn plus the last few chat turns) and
 * the draft, and returns JSON { ok, issues, revised? }. It looks for:
 *   - a number, date, name or status the data contradicts
 *   - a specific company figure stated with nothing in the data behind it
 *   - a refusal or hedge when the data holds the answer
 *   - an AI model / model maker / provider name (Ciao speaks only as itself)
 *   - for an employee login: another person's private data
 *
 * When it is not ok and gives a revision, the revision is shown; otherwise
 * the draft is. It never blocks the person: a timeout, an error or bad JSON
 * all fall back to the draft and log one line. A deterministic scrub then
 * drops any sentence that still names a model or provider.
 *
 * The call goes through lib/aiProvider (openRouterCreate), so it uses the
 * same AI address (OPENROUTER_CHAT_URL) and model as the answer itself: it
 * also works when a client's Private Server box serves Ciao.
 *
 * Flag: CIAO_ANSWER_CHECK (on unless "0", "off" or "false").
 * Timeout: CIAO_ANSWER_CHECK_TIMEOUT_MS (default 6000).
 * Pure helpers are exported for tests; `create` is injectable.
 */
import type * as AI from '@/lib/aiTypes'
import { openRouterCreate, textModelId, TOOL_CALL_MARKUP_RE, type OpenRouterCallOptions } from '@/lib/aiProvider'

export type AnswerCheckMeta = {
  /** The check ran and its verdict was used (false: off, skipped, timeout, error, bad JSON). */
  checked: boolean
  /** The person saw a revised answer (the checker's or the model-name scrub's). */
  revised: boolean
  /** Why it did not run or was not used. */
  reason?: 'off' | 'skipped' | 'timeout' | 'error' | 'bad_json' | 'bad_revision'
  issues?: string[]
  ms?: number
}

export type AnswerCheckResult = {
  text: string
  meta: AnswerCheckMeta
  usage?: { input_tokens: number; output_tokens: number; model: string }
}

export type CreateFn = (params: AI.MessageCreateParams, modelId: string, opts: OpenRouterCallOptions) => Promise<AI.Message>

export const DEFAULT_CHECK_TIMEOUT_MS = 6_000
/** Context sent to the checker is capped (cost and latency). */
export const CONTEXT_CHAR_CAP = 14_000
const PER_RESULT_CAP = 4_000

export function answerCheckEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.CIAO_ANSWER_CHECK ?? '').trim().toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no')
}

export function checkTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CIAO_ANSWER_CHECK_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20_000) : DEFAULT_CHECK_TIMEOUT_MS
}

// ---------------------------------------------------------------------------
// Model / provider names never reach the person.

/**
 * An AI model, model maker or AI host named in an answer. Kept to names that
 * are not ordinary words or people's first names.
 */
export const MODEL_LEAK_RE =
  /\b(?:glm[-\s]?\d(?:\.\d+)?v?|z\.ai|z-ai|zhipu(?:\s*ai)?|openrouter|chatgpt|gpt-?(?:3|4|5|4o|o\d)[\w.-]*|openai|anthropic|claude[-\s](?:opus|sonnet|haiku|\d)[\w.-]*|llama[-\s]?\d[\w.-]*|qwen[\w.-]*|deepseek|mixtral|ollama|vllm|(?:large\s+)?language\s+model|llm)\b/i

/** Leak terms in the answer that the question or the data did not bring up themselves (e.g. an OpenAI invoice). */
export function modelLeaks(answer: string, allowedSource = ''): string[] {
  const re = new RegExp(MODEL_LEAK_RE.source, 'gi')
  const hits = new Set<string>()
  for (const m of answer.matchAll(re)) {
    const term = m[0]
    if (allowedSource && new RegExp(`\\b${escapeRe(term)}\\b`, 'i').test(allowedSource)) continue
    hits.add(term)
  }
  return [...hits]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Drops every sentence that names a model or provider (unless the question or data did). Never returns empty. */
export function scrubModelLeaks(text: string, assistantName: string, allowedSource = ''): { text: string; scrubbed: boolean } {
  if (!modelLeaks(text, allowedSource).length) return { text, scrubbed: false }
  const lines = text.split('\n').map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/)
    const kept = sentences.filter((s) => !modelLeaks(s, allowedSource).length)
    return kept.length === sentences.length ? line : kept.join(' ')
  })
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text: out || `I'm ${assistantName}, your company's assistant. What can I help with?`, scrubbed: true }
}

// ---------------------------------------------------------------------------
// Context: what Ciao read for this answer.

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: string }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * The tool results of this run (messages from `runStart` on), each labelled
 * with its tool, newest kept when over the cap.
 */
export function collectToolContext(messages: AI.MessageParam[], runStart = 0): string {
  const names = new Map<string, string>()
  const parts: string[] = []
  for (const m of messages.slice(runStart)) {
    if (!Array.isArray(m.content)) continue
    for (const b of m.content as unknown as Array<Record<string, unknown>>) {
      if (b.type === 'tool_use') names.set(String(b.id), String(b.name))
      if (b.type === 'tool_result') {
        const body = textOfContent(b.content).trim()
        if (!body) continue
        const name = names.get(String(b.tool_use_id)) ?? 'tool'
        const clipped = body.length > PER_RESULT_CAP ? `${body.slice(0, PER_RESULT_CAP)} …(cut)` : body
        parts.push(`[${name}${b.is_error ? ' (error)' : ''}]\n${clipped}`)
      }
    }
  }
  let out = parts.join('\n\n')
  if (out.length > CONTEXT_CHAR_CAP) out = out.slice(out.length - CONTEXT_CHAR_CAP)
  return out
}

// ---------------------------------------------------------------------------
// The checker call.

export function checkerSystemPrompt(assistantName: string, employee: boolean): string {
  return [
    `You check an answer before ${assistantName} sends it. ${assistantName} is the company assistant inside Suite CXO.`,
    'You get the person\'s QUESTION, the DATA (what the assistant read for this answer: tool results and the last chat turns) and the DRAFT.',
    'Reply with JSON only, no other text: {"ok": true|false, "issues": ["short note", ...], "revised": "the fixed answer"}.',
    'Look for:',
    '1. wrong_fact: a number, date, name, amount or status in the DRAFT that the DATA contradicts.',
    '2. unsupported: a specific company figure (number, amount, date, person) stated as fact when the DATA covers that topic and does not contain it. If the DATA is empty or silent on a topic, do not flag it: the assistant also has background notes you cannot see.',
    '3. needless_refusal: the DRAFT refuses, hedges or says it cannot find something when the DATA holds the answer.',
    `4. model_leak: the DRAFT names an AI model, a model maker or an AI provider, or calls itself a language model. It must speak only as ${assistantName}.`,
    employee
      ? '5. scope_leak: this person is an employee and may only see their own records. Flag any other person\'s pay, commission, performance or personal details.'
      : '5. scope_leak: not applicable for this person.',
    'If there is nothing to fix, reply {"ok": true, "issues": []}.',
    'If there is, set "ok": false and write "revised": the DRAFT with the smallest changes that fix it. Keep its voice, format, length and language. Use the DATA for corrections. Never add new claims or guesses; remove an unsupported figure rather than invent one. Never mention this check.',
  ].join('\n')
}

export type CheckVerdict = { ok: boolean; issues: string[]; revised?: string }

/** Lenient JSON read: code fences and text around the object are tolerated. Null when it is not a verdict. */
export function parseVerdict(raw: string): CheckVerdict | null {
  if (!raw) return null
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  s = s.slice(a, b + 1)
  let j: unknown
  try {
    j = JSON.parse(s)
  } catch {
    return null
  }
  if (!j || typeof j !== 'object') return null
  const o = j as { ok?: unknown; issues?: unknown; revised?: unknown }
  if (typeof o.ok !== 'boolean') return null
  const issues = Array.isArray(o.issues) ? o.issues.map((x) => String(x)).filter(Boolean).slice(0, 10) : []
  const revised = typeof o.revised === 'string' && o.revised.trim() ? o.revised.trim() : undefined
  return { ok: o.ok, issues, ...(revised ? { revised } : {}) }
}

/** A revision we will show: not empty, not runaway, no tool-call markup, no model name. */
function usableRevision(revised: string, draft: string, allowed: string): boolean {
  if (!revised.trim()) return false
  if (revised.length > Math.max(draft.length * 2 + 400, 800)) return false
  if (TOOL_CALL_MARKUP_RE.test(revised)) return false
  if (modelLeaks(revised, allowed).length) return false
  return true
}

const defaultCreate: CreateFn = (params, modelId, opts) => openRouterCreate(params, modelId, opts)

export async function checkAnswer(input: {
  question: string
  draft: string
  /** Tool results this turn (collectToolContext). */
  toolContext: string
  /** The last chat turns, oldest first. */
  recentTurns?: Array<{ role: 'user' | 'assistant'; content: string }>
  assistantName: string
  employee: boolean
  timeoutMs?: number
  create?: CreateFn
  model?: string
  log?: (line: string) => void
}): Promise<AnswerCheckResult> {
  const started = Date.now()
  const log = input.log ?? ((line: string) => console.warn(line))
  const draft = input.draft
  const recent = (input.recentTurns ?? [])
    .slice(-4)
    .map((t) => `${t.role === 'user' ? 'Person' : input.assistantName}: ${t.content.slice(0, 1200)}`)
    .join('\n')
  const data = [input.toolContext.trim(), recent ? `[recent chat]\n${recent}` : ''].filter(Boolean).join('\n\n')
  // Words the person or the data used themselves may appear in the answer (an OpenAI bill, say).
  const allowed = `${input.question}\n${data}`

  const finish = (text: string, meta: AnswerCheckMeta, usage?: AnswerCheckResult['usage']): AnswerCheckResult => {
    const scrub = scrubModelLeaks(text, input.assistantName, allowed)
    const out: AnswerCheckMeta = { ...meta, revised: meta.revised || scrub.scrubbed, ms: Date.now() - started }
    if (scrub.scrubbed) out.issues = [...(out.issues ?? []), 'model_leak scrubbed']
    return { text: scrub.text, meta: out, ...(usage ? { usage } : {}) }
  }

  if (!draft.trim()) return finish(draft, { checked: false, revised: false, reason: 'skipped' })

  const model = input.model ?? textModelId()
  const ctrl = new AbortController()
  const timeoutMs = input.timeoutMs ?? checkTimeoutMs()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  const params: AI.MessageCreateParams = {
    model,
    max_tokens: Math.min(2048, Math.ceil(draft.length / 3) + 300),
    temperature: 0,
    system: checkerSystemPrompt(input.assistantName, input.employee),
    messages: [
      {
        role: 'user',
        content: `QUESTION:\n${input.question.slice(0, 4000)}\n\nDATA:\n${data || '(none: the assistant read no data for this answer)'}\n\nDRAFT:\n${draft}`,
      },
    ],
  }
  try {
    const call = (input.create ?? defaultCreate)(params, model, { signal: ctrl.signal })
    const res = await Promise.race([call, deadline])
    if (res === 'timeout') {
      call.catch(() => {})
      log(`[ciao-check] timeout after ${timeoutMs}ms; draft shown`)
      return finish(draft, { checked: false, revised: false, reason: 'timeout' })
    }
    const usage = { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, model: res.model || model }
    const raw = res.content
      .filter((b): b is AI.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    const verdict = res.stop_reason === 'max_tokens' ? null : parseVerdict(raw)
    if (!verdict) {
      log('[ciao-check] unreadable verdict; draft shown')
      return finish(draft, { checked: false, revised: false, reason: 'bad_json' }, usage)
    }
    if (verdict.ok) return finish(draft, { checked: true, revised: false, issues: verdict.issues }, usage)
    if (verdict.revised && verdict.revised.trim() !== draft.trim()) {
      if (usableRevision(verdict.revised, draft, allowed)) {
        log(`[ciao-check] revised: ${verdict.issues.join('; ').slice(0, 300)}`)
        return finish(verdict.revised, { checked: true, revised: true, issues: verdict.issues }, usage)
      }
      log('[ciao-check] revision refused; draft shown')
      return finish(draft, { checked: true, revised: false, reason: 'bad_revision', issues: verdict.issues }, usage)
    }
    log(`[ciao-check] issues without a revision; draft shown: ${verdict.issues.join('; ').slice(0, 300)}`)
    return finish(draft, { checked: true, revised: false, issues: verdict.issues }, usage)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`[ciao-check] failed (${msg.slice(0, 200)}); draft shown`)
    return finish(draft, { checked: false, revised: false, reason: ctrl.signal.aborted ? 'timeout' : 'error' })
  } finally {
    if (timer) clearTimeout(timer)
  }
}
