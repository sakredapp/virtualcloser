// Fix-requests data layer — the "needs a human code fix" feedback store.
//
// Captures product feedback that the AI can't act on itself (bugs, "make it
// work this way") from the explicit request box and from auto-routed feedback.
// The daily digest cron (app/api/cron/fix-digest) reads `new` rows, emails the
// full breakdown to the developer, and marks them sent.

import { supabase } from '@/lib/supabase'

export type FixRequestSource = 'manual' | 'dismiss' | 'plan' | 'auto'
export type FixRequestSeverity = 'low' | 'normal' | 'high'

export type FixRequest = {
  id: string
  rep_id: string | null
  member_id: string | null
  source: FixRequestSource
  area: string | null
  body: string
  severity: FixRequestSeverity
  status: 'new' | 'sent' | 'resolved' | 'dismissed'
  created_by: string | null
  digest_sent_at: string | null
  created_at: string
  updated_at: string
}

export type LogFixRequestInput = {
  repId?: string | null
  memberId?: string | null
  source: FixRequestSource
  body: string
  area?: string | null
  severity?: FixRequestSeverity
  createdBy?: string | null
}

export async function logFixRequest(input: LogFixRequestInput): Promise<FixRequest | null> {
  const body = input.body.trim()
  if (!body) return null
  const { data, error } = await supabase
    .from('fix_requests')
    .insert({
      rep_id: input.repId ?? null,
      member_id: input.memberId ?? null,
      source: input.source,
      body: body.slice(0, 8000),
      area: input.area?.trim()?.slice(0, 80) || null,
      severity: input.severity ?? 'normal',
      created_by: input.createdBy?.trim()?.slice(0, 120) || null,
    })
    .select('*')
    .maybeSingle()
  if (error) {
    console.warn('[fix-requests] insert failed', error.message)
    return null
  }
  return data as FixRequest
}

/** All `new` (un-digested) requests, oldest first so the email reads in order. */
export async function listNewFixRequests(limit = 500): Promise<FixRequest[]> {
  const { data, error } = await supabase
    .from('fix_requests')
    .select('*')
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.warn('[fix-requests] list failed', error.message)
    return []
  }
  return (data ?? []) as FixRequest[]
}

export async function markFixRequestsSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('fix_requests')
    .update({ status: 'sent', digest_sent_at: now, updated_at: now })
    .in('id', ids)
  if (error) console.warn('[fix-requests] mark sent failed', error.message)
}
