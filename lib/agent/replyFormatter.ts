/**
 * THE FORMATTING STEP for Ciao (Nick 2026-10-26): after an answer is written
 * and checked (lib/agent/answerCheck), before it is returned and stored.
 * Contract, menu and the figure check: lib/agent/replyFormatShared.ts.
 *
 * A model picks the layout from the menu, picks which code-built cards
 * (dataCards, from this turn's tool results) to draw, may draw a small visual
 * from figures the answer already says, and rewrites the words as one or two
 * conversational sentences plus an optional takeaway line. Its output is used
 * only when acceptFormatter passes it (every figure already in the answer or
 * the data, corrections kept, JSON, words, no model or provider names);
 * otherwise the answer is shown exactly as written. It never decides what is
 * said, and the answer as written is always stored and kept behind
 * "Full answer" in the chat.
 *
 * Scope: it sees only what the answer step saw for this person this turn (the
 * draft and the tool results already returned to them under their role and
 * employee scope). It never reads anything new.
 *
 * Same AI address and model as the answer (lib/aiProvider openRouterCreate +
 * textModelId), so no new data leaves; it also works on a Private Server box.
 * Its tokens are added to the turn's usage like the answer check's.
 *
 * Runs only on dense answers (wantsModelFormat: 4+ figures, 320+ characters,
 * or data cards with 2+ figures), only in the app (never Slack, never a
 * spoken / voice answer). Flag CIAO_REPLY_FORMATTER (on unless "0" / "off" /
 * "false" / "no"). Capped at FORMATTER_TIMEOUT_MS; a timeout or error falls
 * back to the answer as written.
 */
import type * as AI from '@/lib/aiTypes'
import { openRouterCreate, textModelId, type OpenRouterCallOptions } from '@/lib/aiProvider'
import { modelLeaks } from './answerCheck'
import {
  acceptFormatter, dataCards, formatterSystemPrompt, formatterUserMessage, wantsModelFormat,
  type CodeCard, type ReadResult, type ReplyFormat, type ReplyFormatPayload,
} from './replyFormatShared'

export const FORMATTER_TIMEOUT_MS = 9_000

export type CreateFn = (params: AI.MessageCreateParams, modelId: string, opts: OpenRouterCallOptions) => Promise<AI.Message>

/** What is stored with the answer (agent_history.reply_format) and logged. */
export type ReplyFormatMeta = {
  /** 'model' = the layout was accepted; 'none' = the answer is shown as written. */
  via: 'model' | 'none'
  format: ReplyFormat | 'as_written'
  /** Why it did not run, or why the model's layout was refused. */
  reason?: 'off' | 'skipped' | 'not_dense' | 'timeout' | 'error' | string
  ms?: number
}

export type FormatReplyResult = {
  /** The layout to draw, or null: draw the answer as written. */
  payload: ReplyFormatPayload | null
  meta: ReplyFormatMeta
  usage?: { input_tokens: number; output_tokens: number; model: string }
}

export function replyFormatterEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.CIAO_REPLY_FORMATTER ?? '').trim().toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no')
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: string }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * The tool results of this run (messages from `runStart` on), parsed: JSON
 * where it is JSON, the text otherwise. Errors are left out (nothing to draw).
 */
export function collectReads(messages: AI.MessageParam[], runStart = 0): ReadResult[] {
  const names = new Map<string, string>()
  const out: ReadResult[] = []
  for (const m of messages.slice(runStart)) {
    if (!Array.isArray(m.content)) continue
    for (const b of m.content as unknown as Array<Record<string, unknown>>) {
      if (b.type === 'tool_use') names.set(String(b.id), String(b.name))
      if (b.type === 'tool_result' && !b.is_error) {
        const body = textOfContent(b.content).trim()
        if (!body) continue
        let data: unknown = body
        if (/^[[{]/.test(body)) {
          try { data = JSON.parse(body) } catch { data = body }
        }
        out.push({ tool: names.get(String(b.tool_use_id)) ?? 'tool', data })
      }
    }
  }
  return out
}

const defaultCreate: CreateFn = (params, modelId, opts) => openRouterCreate(params, modelId, opts)

export async function formatReply(input: {
  question: string
  /** The checked answer, exactly as the person would see it. */
  answer: string
  /** This turn's tool results (collectReads). */
  reads: ReadResult[]
  assistantName: string
  /** Spoken / voice answers are never laid out. */
  voice?: boolean
  timeoutMs?: number
  create?: CreateFn
  model?: string
  env?: Record<string, string | undefined>
  log?: (line: string) => void
}): Promise<FormatReplyResult> {
  const started = Date.now()
  const log = input.log ?? ((line: string) => console.warn(line))
  const none = (reason: ReplyFormatMeta['reason'], usage?: FormatReplyResult['usage']): FormatReplyResult => ({
    payload: null,
    meta: { via: 'none', format: 'as_written', reason, ms: Date.now() - started },
    ...(usage ? { usage } : {}),
  })
  if (!replyFormatterEnabled(input.env)) return none('off')
  if (input.voice || !input.answer.trim()) return none('skipped')

  const cards: CodeCard[] = dataCards(input.reads)
  if (!wantsModelFormat(input.answer, cards)) return none('not_dense')

  const datas = input.reads.map((r) => r.data)
  // Words the person or the data used themselves may appear (an OpenAI invoice, say).
  const allowedNames = `${input.question}\n${input.answer}\n${input.reads.map((r) => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data))).join('\n')}`
  const model = input.model ?? textModelId()
  const ctrl = new AbortController()
  const timeoutMs = input.timeoutMs ?? FORMATTER_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  const params: AI.MessageCreateParams = {
    model,
    max_tokens: 900,
    temperature: 0,
    system: formatterSystemPrompt(input.assistantName),
    messages: [{ role: 'user', content: formatterUserMessage({ question: input.question, answer: input.answer, cards }) }],
  }
  try {
    const call = (input.create ?? defaultCreate)(params, model, { signal: ctrl.signal })
    const res = await Promise.race([call, deadline])
    if (res === 'timeout') {
      call.catch(() => {})
      log(`[ciao-format] timeout after ${timeoutMs}ms; answer shown as written`)
      return none('timeout')
    }
    const usage = { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, model: res.model || model }
    const raw = res.content
      .filter((b): b is AI.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    if (res.stop_reason === 'max_tokens') {
      log('[ciao-format] refused: cut off; answer shown as written')
      return none('cut_off', usage)
    }
    const acc = acceptFormatter(raw, { answer: input.answer, cards, datas, nameLeaks: (t) => modelLeaks(t, allowedNames) })
    if (!acc.ok) {
      log(`[ciao-format] refused: ${acc.reason}; answer shown as written`)
      return none(acc.reason, usage)
    }
    const { cardsUsed: _used, ...payload } = acc.result
    return { payload, meta: { via: 'model', format: payload.format, ms: Date.now() - started }, usage }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`[ciao-format] failed (${msg.slice(0, 200)}); answer shown as written`)
    return none(ctrl.signal.aborted ? 'timeout' : 'error')
  } finally {
    if (timer) clearTimeout(timer)
  }
}
