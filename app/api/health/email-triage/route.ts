// Operational health endpoint for the Email Triage feature.
//
// Returns per-rep counts of threads in each status, the most recent sync
// time, the most recent triage time, and whether the cursor is fresh.
// Used by the dashboard and for ad-hoc curl checks ("is the worker stuck?").
//
// Guarded by isAdminAuthed() — service health is admin-only data.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isAdminAuthed } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STALE_SYNC_MINUTES = 10 // worker should sync each enabled rep every ~2min

type RepHealth = {
  rep_id: string
  email: string | null
  thread_counts: Record<string, number>
  pending_drafts: number
  last_sync_at: string | null
  last_sync_age_minutes: number | null
  last_sync_error: string | null
  cursor_seeded: boolean
  status: 'ok' | 'stale' | 'error' | 'never_synced' | 'no_scope'
}

export async function GET(_req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Reps eligible for triage: anyone with a google_tokens row whose scope
  // includes gmail.readonly. Same filter the sync worker uses.
  const { data: tokens } = await supabase
    .from('google_tokens')
    .select('rep_id, email, scope')
    .not('scope', 'is', null)
  const eligible = ((tokens ?? []) as Array<{
    rep_id: string
    email: string | null
    scope: string | null
  }>).filter((t) => t.scope?.includes('gmail.readonly'))

  if (eligible.length === 0) {
    return NextResponse.json({
      ok: true,
      eligible_reps: 0,
      note: 'no reps have granted gmail.readonly yet',
      reps: [],
    })
  }

  const repIds = Array.from(new Set(eligible.map((t) => t.rep_id)))

  // Pull counts and sync state in parallel.
  const [threadsRes, draftsRes, cursorRes] = await Promise.all([
    supabase
      .from('email_threads')
      .select('rep_id, status', { count: 'exact', head: false })
      .in('rep_id', repIds),
    supabase
      .from('email_drafts')
      .select('rep_id', { count: 'exact', head: false })
      .in('rep_id', repIds)
      .eq('status', 'pending'),
    supabase
      .from('gmail_sync_state')
      .select('rep_id, last_synced_at, last_error, last_history_id')
      .in('rep_id', repIds),
  ])

  const threadCounts = new Map<string, Record<string, number>>()
  for (const row of (threadsRes.data ?? []) as Array<{ rep_id: string; status: string }>) {
    if (!threadCounts.has(row.rep_id)) threadCounts.set(row.rep_id, {})
    const m = threadCounts.get(row.rep_id)!
    m[row.status] = (m[row.status] ?? 0) + 1
  }

  const draftCounts = new Map<string, number>()
  for (const row of (draftsRes.data ?? []) as Array<{ rep_id: string }>) {
    draftCounts.set(row.rep_id, (draftCounts.get(row.rep_id) ?? 0) + 1)
  }

  const cursors = new Map<string, {
    last_synced_at: string | null
    last_error: string | null
    last_history_id: string | null
  }>()
  for (const row of (cursorRes.data ?? []) as Array<{
    rep_id: string
    last_synced_at: string | null
    last_error: string | null
    last_history_id: string | null
  }>) {
    cursors.set(row.rep_id, {
      last_synced_at: row.last_synced_at,
      last_error: row.last_error,
      last_history_id: row.last_history_id,
    })
  }

  const reps: RepHealth[] = eligible.map((t) => {
    const cursor = cursors.get(t.rep_id)
    const counts = threadCounts.get(t.rep_id) ?? {}
    const pending = draftCounts.get(t.rep_id) ?? 0

    let status: RepHealth['status']
    let ageMin: number | null = null

    if (!t.scope?.includes('gmail.readonly')) {
      status = 'no_scope'
    } else if (!cursor || !cursor.last_synced_at) {
      status = 'never_synced'
    } else {
      const ageMs = Date.now() - new Date(cursor.last_synced_at).getTime()
      ageMin = Math.round(ageMs / 60_000)
      if (cursor.last_error) status = 'error'
      else if (ageMin > STALE_SYNC_MINUTES) status = 'stale'
      else status = 'ok'
    }

    return {
      rep_id: t.rep_id,
      email: t.email,
      thread_counts: counts,
      pending_drafts: pending,
      last_sync_at: cursor?.last_synced_at ?? null,
      last_sync_age_minutes: ageMin,
      last_sync_error: cursor?.last_error ?? null,
      cursor_seeded: Boolean(cursor?.last_history_id),
      status,
    }
  })

  const overall: 'ok' | 'degraded' = reps.some(
    (r) => r.status === 'error' || r.status === 'stale',
  )
    ? 'degraded'
    : 'ok'

  return NextResponse.json({
    ok: true,
    overall,
    eligible_reps: eligible.length,
    reps,
  })
}
