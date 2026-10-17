/**
 * Server-side lookup for the inbox gate (lib/cxoFeatures.ts inboxAllowed) when
 * all a caller has is a tenant id: API routes, Ciao's tools, MCP, the Hetzner
 * Gmail ticks. Fails closed for a tenant that cannot be read.
 */
import { supabase } from '@/lib/supabase'
import { inboxAllowed } from '@/lib/cxoFeatures'

export async function inboxAllowedForRep(repId: string | null | undefined): Promise<boolean> {
  if (!repId) return false
  const { data } = await supabase.from('reps').select('id, brand').eq('id', repId).maybeSingle()
  return inboxAllowed(data as { id?: string | null; brand?: string | null } | null)
}

/** Suite CXO tenants without the inbox: background Gmail work skips them. */
export async function inboxBlockedRepIds(): Promise<string[]> {
  const { data } = await supabase.from('reps').select('id, brand').eq('brand', 'cxo')
  return ((data ?? []) as Array<{ id: string; brand: string | null }>).filter((r) => !inboxAllowed(r)).map((r) => r.id)
}
