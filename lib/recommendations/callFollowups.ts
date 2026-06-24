// Aging call follow-ups — the "you said you'd follow up and haven't" signal.
//
// The Plaud agent turns commitments from recordings into plaud_actions. Ones
// still pending/failed after a couple of days are the follow-ups that quietly
// slip. This surfaces the oldest, with the recording it came from, so the
// overseer can say "from your call X days ago, this still hasn't gone out."

import { supabase } from '@/lib/supabase'
import { describeAction } from '@/lib/plaud/actionContext'

const AGING_DAYS = 2

export type AgingFollowups = {
  count: number
  topAction: string | null
  topRecording: string | null
  topDays: number | null
}

const EMPTY: AgingFollowups = { count: 0, topAction: null, topRecording: null, topDays: null }

export async function loadAgingFollowups(repId: string): Promise<AgingFollowups> {
  const cutoff = new Date(Date.now() - AGING_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('plaud_actions')
    .select('kind, payload, target_email, note_id, created_at, status')
    .eq('rep_id', repId)
    .in('status', ['pending', 'failed'])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(20)
  const rows = (data ?? []) as Array<{
    kind: string
    payload: Record<string, unknown>
    target_email: string | null
    note_id: string | null
    created_at: string
  }>
  if (rows.length === 0) return EMPTY

  const top = rows[0]
  let recording: string | null = null
  if (top.note_id) {
    const { data: n } = await supabase
      .from('plaud_notes')
      .select('title')
      .eq('id', top.note_id)
      .maybeSingle()
    recording = (n as { title?: string } | null)?.title ?? null
  }
  const days = Math.floor((Date.now() - Date.parse(top.created_at)) / 86_400_000)
  return {
    count: rows.length,
    topAction: describeAction(top.kind, top.payload, top.target_email),
    topRecording: recording,
    topDays: Number.isFinite(days) ? days : null,
  }
}
