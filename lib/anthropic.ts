import Anthropic from '@anthropic-ai/sdk'
import { AsyncLocalStorage } from 'node:async_hooks'
import { supabase } from './supabase'
import {
  estimateCostUsd,
  logFallbackOnce,
  messageAsStream,
  openRouterConfigured,
  openRouterCreate,
  routeFor,
  activeTextModel,
} from './aiProvider'

/**
 * Per-tenant Anthropic client resolver (BYOK).
 *
 * Tenants can bring their own Anthropic API key (reps.claude_api_key) so
 * their AI usage bills to *their* Anthropic account, not the platform's.
 * We propagate that key via AsyncLocalStorage so the dozens of deep Claude
 * call sites (lib/claude.ts, runAgent, plaud, email triage) don't each need
 * the key threaded through their signatures.
 *
 * Resolution order for getAnthropic():
 *   1. ALS tenant key  (set by runWithClaudeKey at a request/tick entry)
 *   2. Platform key     (process.env.ANTHROPIC_API_KEY)
 *
 * Safety: when no ALS frame is active (cron jobs, build-time, anything not
 * wrapped), getAnthropic() falls back to the platform key — identical to the
 * pre-BYOK behavior. Wrapping is purely additive.
 *
 * ALS caveat (same as lib/telegram-context): the context only survives across
 * `await`. Anything fired-and-forgotten (after(), waitUntil, void async)
 * escapes the frame and falls back to the platform key. Wrap entry points
 * whose work is fully awaited.
 */

const PLATFORM_KEY = process.env.ANTHROPIC_API_KEY

const als = new AsyncLocalStorage<{ apiKey: string }>()

// Cache one client per distinct key so we don't reconstruct on every call.
// Keys are already held in env/DB, so caching them in-process is no new
// exposure. Bounded in practice by the number of BYOK tenants.
const clientCache = new Map<string, Anthropic>()

function clientForKey(apiKey: string): Anthropic {
  let c = clientCache.get(apiKey)
  if (!c) {
    c = new Anthropic({ apiKey })
    clientCache.set(apiKey, c)
  }
  return c
}

/**
 * Run `fn` with `key` (a tenant's BYOK Anthropic key) active for every
 * getAnthropic() call inside. Falls back to the platform key when `key` is
 * empty, so callers can pass `tenant.claude_api_key` unconditionally.
 */
export function runWithClaudeKey<T>(
  key: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const apiKey = (key && key.trim()) || PLATFORM_KEY
  if (!apiKey) return fn() // no key anywhere — getAnthropic() will throw where used
  return als.run({ apiKey }, fn)
}

function rawAnthropic(): Anthropic {
  const apiKey = als.getStore()?.apiKey || PLATFORM_KEY
  if (!apiKey) {
    throw new Error('No Anthropic API key configured (tenant BYOK or ANTHROPIC_API_KEY)')
  }
  return clientForKey(apiKey)
}

/**
 * Routed messages.create (see lib/aiProvider.ts). Text-only requests go to GLM
 * on OpenRouter; PDF/image requests (the vision exception) and the
 * no-OpenRouter fallback go to Anthropic.
 */
async function routedCreate(params: Anthropic.MessageCreateParams): Promise<unknown> {
  const route = routeFor(params)
  if (route.provider === 'openrouter') {
    try {
      const msg = await openRouterCreate(params, route.model)
      return params.stream ? messageAsStream(msg) : msg
    } catch (err) {
      // Transport failure: keep the answer coming on the old path when a key
      // exists, and say so. Never silent.
      if (!(als.getStore()?.apiKey || PLATFORM_KEY)) throw err
      console.error('[ai] OpenRouter call failed, retrying once on Anthropic:', err instanceof Error ? err.message : err)
    }
  } else if (route.reason === 'fallback_no_openrouter') {
    logFallbackOnce()
  }
  const model = route.provider === 'anthropic' ? route.model : params.model
  return rawAnthropic().messages.create({ ...params, model } as Anthropic.MessageCreateParams)
}

const routedCache = new WeakMap<Anthropic, Anthropic>()
const ROUTED_NO_KEY = { messages: { create: routedCreate } } as unknown as Anthropic

/**
 * The AI client every call site uses. Looks like the Anthropic SDK; only
 * messages.create is routed. Throws only when no rail is configured at all.
 */
export function getAnthropic(): Anthropic {
  const apiKey = als.getStore()?.apiKey || PLATFORM_KEY
  if (!apiKey) {
    if (openRouterConfigured()) return ROUTED_NO_KEY
    throw new Error('No AI key configured (OPENROUTER_API_KEY, tenant BYOK or ANTHROPIC_API_KEY)')
  }
  const base = clientForKey(apiKey)
  let routed = routedCache.get(base)
  if (!routed) {
    routed = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'messages') {
          return new Proxy(target.messages, {
            get(m, p, r) {
              if (p === 'create') return routedCreate
              return Reflect.get(m, p, r)
            },
          })
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    routedCache.set(base, routed)
  }
  return routed
}

/** True if any AI rail is usable (OpenRouter, tenant key or platform key). */
export function hasAnthropicKey(): boolean {
  return openRouterConfigured() || Boolean(als.getStore()?.apiKey || PLATFORM_KEY)
}

export type ClaudeUsageSummary = {
  requests: number
  inputTokens: number
  outputTokens: number
  /**
   * Rough cost estimate in USD, priced per row by the model that ran
   * (GLM-5.3 $1.40/$4.40, GLM-5 $1.20/$3.20, Sonnet $3/$15 per Mtok).
   * Approximate.
   */
  estCostUsd: number
  /** First day of the window (YYYY-MM-DD). */
  since: string
}

/**
 * Sum a tenant's AI agent usage for the current calendar month from the
 * agent_usage table. Each row is priced by its `model` column
 * (supabase/agent_usage_model_migration.sql); rows without one are priced
 * at the model text calls run on now.
 */
export async function getMonthlyClaudeUsage(repId: string): Promise<ClaudeUsageSummary> {
  const now = new Date()
  const since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const { data } = await supabase
    .from('agent_usage')
    .select('*')
    .eq('rep_id', repId)
    .gte('day', since)

  const rows = (data ?? []) as Array<{ requests: number; input_tokens: number; output_tokens: number; model?: string | null }>
  const current = activeTextModel(process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5')
  const inputTokens = rows.reduce((s, r) => s + (r.input_tokens || 0), 0)
  const outputTokens = rows.reduce((s, r) => s + (r.output_tokens || 0), 0)
  const requests = rows.reduce((s, r) => s + (r.requests || 0), 0)
  const estCostUsd = rows.reduce(
    (s, r) => s + estimateCostUsd(r.model || current, r.input_tokens || 0, r.output_tokens || 0),
    0,
  )

  return { requests, inputTokens, outputTokens, estCostUsd, since }
}

/**
 * Validate a candidate BYOK key with a tiny live call. Returns ok/err so the
 * settings UI can reject a bad key on save instead of failing silently later.
 */
export async function validateAnthropicKey(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey || !apiKey.trim()) return { ok: false, error: 'empty key' }
  try {
    const probe = new Anthropic({ apiKey: apiKey.trim() })
    await probe.messages.create({
      model: process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5',
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'validation failed'
    return { ok: false, error: message }
  }
}
