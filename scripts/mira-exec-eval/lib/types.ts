/** Shared shapes for the Mira executive eval (question bank, run rows, graded rows). */
import type { BreakdownDim } from '@/lib/pinnacle/rollup'
import type { LineFilter, WindowInput } from '@/lib/mcp/data'

export type { BreakdownDim, LineFilter, WindowInput }

export const CATEGORIES = [
  'headline_numbers',
  'rankings_movers',
  'funnel_status',
  'pace_projection',
  'comparisons',
  'why_anomaly',
  'data_freshness_definitions',
  'calendar_actions',
  'ambiguous_trick',
  'casual_exec',
] as const
export type Category = (typeof CATEGORIES)[number]

export type ExpectedKind = 'number' | 'ranking' | 'list' | 'explanation' | 'refusal_no_data' | 'action'

export type PeriodMetric = 'premium' | 'policies' | 'avg_premium' | 'funded_premium'
export type FunnelMetric =
  | 'placement_pct'
  | 'paid'
  | 'declined'
  | 'lapsed'
  | 'submitted'
  | 'applications'
  | 'decline_pct'
  | 'lapse_pct'

/**
 * A ground-truth spec names the data function (lib/mcp/data.ts) + args the
 * grader calls at grade time. Resolved against the same DB Mira read, on the
 * same day, so numbers reconcile with the dashboard.
 */
export type GroundTruth =
  | { fn: 'period'; window: WindowInput; line: LineFilter; metric: PeriodMetric }
  | { fn: 'breakdown'; dim: BreakdownDim; window: WindowInput; line: LineFilter; top_n: number; order?: 'top' | 'bottom' }
  | { fn: 'funnel'; window: WindowInput; line: LineFilter; metric: FunnelMetric }
  | { fn: 'compare'; a: WindowInput; b: WindowInput; line: LineFilter; metric: 'premium' | 'placement_pct' | 'policies' }
  | { fn: 'line_compare'; window: WindowInput; lines: [LineFilter, LineFilter]; metric: 'premium' | 'policies' }
  | { fn: 'trend'; window: WindowInput; line: LineFilter }
  | { fn: 'entity'; dim: 'agent' | 'carrier' | 'team' | 'state'; name: string; window: WindowInput; exists: boolean | 'unknown' }
  | { fn: 'movers'; dim: BreakdownDim; window: WindowInput; line: LineFilter; direction: 'up' | 'down' }
  | { fn: 'pace'; line: LineFilter; horizon: 'month' | 'year' }
  | { fn: 'freshness' }
  | { fn: 'none'; reason: string }

export type Question = {
  id: string
  category: Category
  text: string
  expected_kind: ExpectedKind
  ground_truth?: GroundTruth
  meta: {
    source: 'generated' | 'handwritten'
    /** Template family, for clustering failures. */
    family?: string
    /** Plain-English period the question names (grader checks the answer names the same one). */
    period_label?: string
    /** Entity the question names, if any. */
    entity?: string
    /** For invented entities / missing data: what the correct answer must say. */
    must_say?: string
    /** Casual-style transform applied, if any. */
    style?: string
    /** Intent kinds an action answer should delegate (any one of). */
    expects_intents?: string[]
    /** Tools a good answer should have called (any one of). */
    expects_tools?: string[]
  }
}

export type RunRow = {
  id: string
  pass: number
  category: Category
  expected_kind: ExpectedKind
  text: string
  answer: string
  error: string | null
  intents: Array<Record<string, unknown>>
  tools_used: string[]
  turns: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  ms: number
  model: string
  mock: boolean
  ts: string
}

export type FailureTag =
  | 'wrong_number'
  | 'no_number'
  | 'wrong_ranking'
  | 'hallucinated_compare'
  | 'invented_entity'
  | 'invented_data'
  | 'missing_no_data_statement'
  | 'too_long'
  | 'evasive'
  | 'wrong_period'
  | 'tool_error'
  | 'no_action'
  | 'claimed_unsent_action'
  | 'wrong_tool'
  | 'bad_tone'
  | 'no_next_step'
  | 'gt_unavailable'
  | 'grader_error'

export type GradedRow = RunRow & {
  pass_grade: boolean
  tags: FailureTag[]
  checks: Record<string, unknown>
  ground_truth_value?: unknown
  llm?: { pass: boolean; tags: string[]; note: string; cost_usd: number } | null
}
