import Anthropic from '@anthropic-ai/sdk'
import { AsyncLocalStorage } from 'node:async_hooks'

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

/** Active Anthropic client: ALS tenant key → platform key. Throws if neither. */
export function getAnthropic(): Anthropic {
  const apiKey = als.getStore()?.apiKey || PLATFORM_KEY
  if (!apiKey) {
    throw new Error('No Anthropic API key configured (tenant BYOK or ANTHROPIC_API_KEY)')
  }
  return clientForKey(apiKey)
}

/** True if a usable key exists (tenant or platform) — for graceful guards. */
export function hasAnthropicKey(): boolean {
  return Boolean(als.getStore()?.apiKey || PLATFORM_KEY)
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'validation failed'
    return { ok: false, error: message }
  }
}
