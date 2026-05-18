// Per-rep HIPAA mode flag.
//
// When a rep is in HIPAA mode, the dialer pipeline:
//   - Redacts lead names from Telegram alerts (only "lead" + appt time)
//   - Skips GHL CRM push entirely (no BAA with GHL)
//   - Skips GHL booking sync entirely
//   - Other PII surfaces should also check this flag before exposing data
//     to non-BAA-covered destinations
//
// Source of truth: reps.hipaa_mode column.
// Cached in-process for 5 minutes — flag changes take effect on the next
// tick after TTL. Acceptable for a security gate; updates are rare.

import { supabase } from '@/lib/supabase'

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { value: boolean; expiresAt: number }>()

export async function isHipaaMode(repId: string): Promise<boolean> {
  const cached = cache.get(repId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const { data } = await supabase
    .from('reps')
    .select('hipaa_mode')
    .eq('id', repId)
    .maybeSingle<{ hipaa_mode: boolean | null }>()
  const value = Boolean(data?.hipaa_mode)
  cache.set(repId, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

/** Test/admin helper — force-invalidate the cache for a rep. */
export function invalidateHipaaModeCache(repId?: string): void {
  if (repId) cache.delete(repId)
  else cache.clear()
}
