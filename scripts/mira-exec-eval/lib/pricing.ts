import { DEFAULT_TEXT_MODEL, assertModelAllowed, estimateCostUsd, textModelId } from '@/lib/aiProvider'

/**
 * USD for one run, priced by lib/aiProvider.ts (GLM on OpenRouter; no
 * Anthropic models, no Haiku). OpenRouter bills cached prompt tokens as
 * ordinary input here, so cache reads/writes are priced at the input rate.
 */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  return estimateCostUsd(model, inputTokens + cacheReadTokens + cacheWriteTokens, outputTokens)
}

/** The model Mira's agent runs on (lib/agent/runAgent.ts). */
export function agentModel(): string {
  return textModelId()
}

/** Grader model: GLM on OpenRouter by default. Anthropic models and Haiku are refused. */
export function graderModel(): string {
  const m = process.env.MIRA_EVAL_GRADER_MODEL || DEFAULT_TEXT_MODEL
  assertModelAllowed(m)
  return m
}

export const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
