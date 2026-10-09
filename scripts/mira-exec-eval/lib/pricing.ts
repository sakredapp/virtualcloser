/**
 * USD per million tokens. Sonnet is the agent model (lib/agent/runAgent.ts);
 * Haiku is listed only so an accidental Haiku run is priced, never chosen.
 * Rates as of 2026-10 — update if Anthropic changes them.
 */
const RATES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /opus/i, input: 15, output: 75 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku/i, input: 0.8, output: 4 },
]

/**
 * Prompt-cache multipliers (Anthropic): cache reads bill at 10% of the input rate,
 * cache writes (5-minute TTL) at 125%. Cached tokens are NOT part of inputTokens.
 */
const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const r = RATES.find((x) => x.match.test(model)) ?? RATES[1]
  return (
    (inputTokens / 1_000_000) * r.input +
    (cacheReadTokens / 1_000_000) * r.input * CACHE_READ_MULT +
    (cacheWriteTokens / 1_000_000) * r.input * CACHE_WRITE_MULT +
    (outputTokens / 1_000_000) * r.output
  )
}

export function agentModel(): string {
  return process.env.ANTHROPIC_MODEL_AGENT || process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'
}

/** Grader model: Sonnet by default. Haiku is refused outright (owner rule: no Haiku anywhere). */
export function graderModel(): string {
  const m = process.env.MIRA_EVAL_GRADER_MODEL || 'claude-sonnet-4-5'
  if (/haiku/i.test(m)) throw new Error(`Grader model "${m}" is Haiku — not allowed. Use a Sonnet model.`)
  return m
}

export const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
