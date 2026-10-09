// One lease for every Pinnacle Airtable pull: the Vercel cron, the Hetzner
// tick and a member's Refresh button all claim pinnacle_sync_state.sync_lock_until
// before calling syncPinnacleAirtable, so two pulls never run at once.
//
// The claim is a single conditional UPDATE (free, expired, or a bogus lease
// more than 30 min ahead), so only one caller can win it. A lease left by a
// killed process simply expires.

import { supabase } from '@/lib/supabase'

const MAX_LEASE_MS = 30 * 60_000

/** Claim the sync lease for `ms`. Returns the lease token, or null if held. */
export async function acquireSyncLease(ms: number): Promise<string | null> {
  const now = Date.now()
  const until = new Date(now + Math.min(ms, MAX_LEASE_MS)).toISOString()
  const { data, error } = await supabase
    .from('pinnacle_sync_state')
    .update({ sync_lock_until: until })
    .eq('id', 1)
    .or(
      `sync_lock_until.is.null,sync_lock_until.lt.${new Date(now).toISOString()},sync_lock_until.gt.${new Date(now + MAX_LEASE_MS).toISOString()}`,
    )
    .select('id')
  if (error) throw new Error(`pinnacle sync lease: ${error.message}`)
  return data?.length ? until : null
}

/** Release a lease this caller holds (no-op if it expired and was taken over). */
export async function releaseSyncLease(token: string): Promise<void> {
  await supabase
    .from('pinnacle_sync_state')
    .update({ sync_lock_until: null })
    .eq('id', 1)
    .eq('sync_lock_until', token)
}
