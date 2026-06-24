// Structured error log. Replaces blind console.error in webhooks, cron,
// reconciler, and dispatch loops with a queryable Supabase row + optional
// console mirror for local dev. Queried from /admin/errors.
//
// Designed to NEVER throw — logging a failure must not cascade into the
// caller's failure path. All DB writes are best-effort with a console
// fallback.
//
// Usage:
//
//   import { logError } from '@/lib/errors'
//   try {
//     await doRiskyThing()
//   } catch (err) {
//     await logError({
//       source: 'webhook/sakredcrm/lead',
//       errorType: 'startCampaign_failed',
//       message: err instanceof Error ? err.message : String(err),
//       stack: err instanceof Error ? err.stack : undefined,
//       repId: 'rep_sakredcrm',
//       context: { your_crm_lead_id: body.your_crm_lead_id },
//     })
//     // ... continue handling
//   }

import { supabase } from '@/lib/supabase'
import { alertOperator } from '@/lib/alerts'

export type LogErrorInput = {
  /** Short stable identifier for where the error came from, e.g. "webhook/revring", "cron/dialer-queue". */
  source: string
  /** Stable short code for the kind of error, e.g. "sakredcrm_push_401". */
  errorType: string
  /** Human-readable one-line message. */
  message: string
  /** Optional severity. Defaults to 'error'. */
  severity?: 'warn' | 'error' | 'fatal'
  /** Optional stack trace (Error.stack). Truncated to 8KB. */
  stack?: string
  /** Optional rep/member scope for filtering on the admin page. */
  repId?: string | null
  memberId?: string | null
  /** Free-form structured context — IDs, status codes, partial payloads. */
  context?: Record<string, unknown>
}

const MAX_STACK_LEN = 8000

export async function logError(input: LogErrorInput): Promise<void> {
  // Always emit a console line so the local dev / Vercel function log is
  // never empty even if the DB insert fails.
  const consoleTag = `[${input.severity ?? 'error'}][${input.source}]`
  console.error(consoleTag, input.errorType, input.message, input.context ?? {})

  try {
    const row = {
      severity: input.severity ?? 'error',
      source: input.source,
      rep_id: input.repId ?? null,
      member_id: input.memberId ?? null,
      error_type: input.errorType,
      message: input.message.slice(0, 2000),
      stack: input.stack ? input.stack.slice(0, MAX_STACK_LEN) : null,
      context: input.context ?? {},
    }
    const { error } = await supabase.from('app_errors').insert(row)
    if (error) {
      console.error('[errors] DB insert failed — error stays in console only', error.message)
    }
  } catch (err) {
    console.error('[errors] threw while writing — swallowed', err instanceof Error ? err.message : String(err))
  }

  // Fatal errors page the operator immediately — these can't wait for the daily
  // digest. alertOperator never throws and self-throttles per key.
  if ((input.severity ?? 'error') === 'fatal') {
    await alertOperator({
      key: `fatal:${input.source}:${input.errorType}`,
      severity: 'fatal',
      title: `${input.source} — ${input.errorType}`,
      body: input.message,
      context: { repId: input.repId ?? undefined, ...(input.context ?? {}) },
    })
  }
}
