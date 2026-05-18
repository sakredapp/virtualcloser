// Per-key fixed-window rate limiter backed by the rate_limit_buckets
// Postgres table + enforce_rate_limit() function. Atomic per-key
// check-and-increment so concurrent requests can't both squeak under.
//
// Usage in a route handler:
//
//   import { enforceRateLimit, rateLimitResponse } from '@/lib/rateLimit'
//   const limit = await enforceRateLimit(`sms:send:${ctx.member.id}`, 30, 60)
//   if (!limit.allowed) return rateLimitResponse(limit)
//
// Returns { allowed, retryAfterSec } so the route can either proceed or
// emit a clean 429 + Retry-After header. Fail-OPEN on DB error — a broken
// rate-limit table should never take down a request path; the alternative
// is locking out legit users when Supabase hiccups.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export type RateLimitResult = {
  allowed: boolean
  key: string
  limit: number
  windowSec: number
  retryAfterSec: number
}

/**
 * Enforce a sliding-bucket rate limit for `key`.
 * @param key Stable identifier for the bucket. Convention: `<route>:<member_id>` or `<route>:<rep_id>`.
 * @param limit Max requests permitted within the window.
 * @param windowSec Window length in seconds.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc('enforce_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSec,
    })
    if (error) {
      console.error('[rateLimit] DB error — failing open', { key, error: error.message })
      return { allowed: true, key, limit, windowSec, retryAfterSec: 0 }
    }
    const allowed = data === true
    return {
      allowed,
      key,
      limit,
      windowSec,
      retryAfterSec: allowed ? 0 : windowSec,
    }
  } catch (err) {
    console.error('[rateLimit] threw — failing open', { key, err: err instanceof Error ? err.message : String(err) })
    return { allowed: true, key, limit, windowSec, retryAfterSec: 0 }
  }
}

/** Build a clean 429 response from a denied rate limit result. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: 'rate_limited',
      retry_after_sec: result.retryAfterSec,
      limit: result.limit,
      window_sec: result.windowSec,
    },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSec) },
    },
  )
}
