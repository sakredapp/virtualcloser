import { supabase } from './supabase'
import type { AIClient, MessageCreateParams, Message, MessageStreamEvent } from './aiTypes'
import { estimateCostUsd, messageAsStream, openRouterConfigured, openRouterCreate, routeFor, activeTextModel } from './aiProvider'

/**
 * The AI client every call site uses.
 *
 * Owner 2026-10-10: Suite CXO makes no direct Anthropic calls. Every request
 * goes to OpenRouter through lib/aiProvider.ts (GLM for text, GLM-4.5V for
 * images, data_collection=deny on every request). There is no per-tenant key
 * and no fallback: with OPENROUTER_API_KEY unset a call fails with a clear
 * AINotConfiguredError.
 */

async function create(params: MessageCreateParams): Promise<Message | AsyncIterable<MessageStreamEvent>> {
  const route = routeFor(params)
  const msg = await openRouterCreate(params, route.model)
  return params.stream ? messageAsStream(msg) : msg
}

const CLIENT = { messages: { create } } as unknown as AIClient

export function getAI(): AIClient {
  return CLIENT
}

/** True when the AI rail (OpenRouter) is configured. */
export function hasAIKey(): boolean {
  return openRouterConfigured()
}

export type AIUsageSummary = {
  requests: number
  inputTokens: number
  outputTokens: number
  /**
   * Rough cost estimate in USD, priced per row by the model that ran
   * (GLM-5.3 $1.40/$4.40, GLM-5 $1.20/$3.20 per Mtok; older rows at the
   * model they ran on). Approximate.
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
export async function getMonthlyAIUsage(repId: string): Promise<AIUsageSummary> {
  const now = new Date()
  const since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const { data } = await supabase
    .from('agent_usage')
    .select('*')
    .eq('rep_id', repId)
    .gte('day', since)

  const rows = (data ?? []) as Array<{ requests: number; input_tokens: number; output_tokens: number; model?: string | null }>
  const current = activeTextModel()
  const inputTokens = rows.reduce((s, r) => s + (r.input_tokens || 0), 0)
  const outputTokens = rows.reduce((s, r) => s + (r.output_tokens || 0), 0)
  const requests = rows.reduce((s, r) => s + (r.requests || 0), 0)
  const estCostUsd = rows.reduce(
    (s, r) => s + estimateCostUsd(r.model || current, r.input_tokens || 0, r.output_tokens || 0),
    0,
  )

  return { requests, inputTokens, outputTokens, estCostUsd, since }
}
