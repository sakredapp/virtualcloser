/**
 * Suite CXO "Book a call" requests (prospects.source = 'cxo_request_access')
 * for the Accounts board's Lead stage. Additive to the onboarding board
 * answer as `requests`; Accounts (crmbuilds shared/accounts-onboarding.ts)
 * shows each one as a lead that is not a client yet. Open requests from the
 * last 90 days only; won, lost and canceled ones drop off.
 */
import { supabase } from '@/lib/supabase'

export type CxoCallRequest = {
  id: string
  name: string | null
  company: string | null
  email: string | null
  interest: string | null
  status: string | null
  created_at: string | null
  /** The call time they booked (ISO), or null when they have not picked one. */
  call_at: string | null
}

export async function loadCxoCallRequests(now = new Date()): Promise<CxoCallRequest[] | null> {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('prospects')
    .select('id, name, company, email, status, created_at, interest:payload->>interest, call_at:payload->booking->>start')
    .eq('source', 'cxo_request_access')
    .gte('created_at', since)
    .not('status', 'in', '(won,lost,canceled)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    console.error('[ops/onboarding] cxo call requests', error.message)
    return null
  }
  return (data ?? []) as unknown as CxoCallRequest[]
}
