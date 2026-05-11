// POST /api/admin/dispatch-queue-now
//
// Admin-only manual trigger that runs one pass of the dialer-queue dispatch
// loop. Same logic as /api/cron/dialer-queue but auth'd via the platform
// admin cookie instead of CRON_SECRET, so smoke tests don't have to wait for
// the */5-minute cron tick.
//
// Body: { repId?: string }   // optional — restrict to a single rep
// Response: { ok, dispatched, skipped, errors }

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { dispatchQueueCall, type QueueRow } from '@/lib/voice/queueDispatch'
import { getSalespersonForRep, getOrCreateDefaultSalesperson } from '@/lib/ai-salesperson'
import type { AiSalesperson } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { repId?: string }

  let q = supabase
    .from('dialer_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50)

  if (body.repId) q = q.eq('rep_id', body.repId)

  const { data: rows, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const setterCache = new Map<string, AiSalesperson | null>()
  let dispatched = 0
  let skipped = 0
  let errors = 0
  const details: Array<{ id: string; status: string; reason?: string }> = []

  for (const row of (rows ?? []) as QueueRow[]) {
    try {
      const setterKey = `${row.rep_id}:${row.ai_salesperson_id ?? 'default'}`
      let setter = setterCache.get(setterKey) ?? null
      if (!setterCache.has(setterKey)) {
        setter = row.ai_salesperson_id
          ? await getSalespersonForRep(row.rep_id, row.ai_salesperson_id).catch(() => null)
          : await getOrCreateDefaultSalesperson(row.rep_id).catch(() => null)
        setterCache.set(setterKey, setter)
      }

      const result = await dispatchQueueCall(row, { setter })
      if (result.ok) {
        dispatched++
        details.push({ id: row.id, status: 'dispatched' })
      } else {
        skipped++
        details.push({ id: row.id, status: 'skipped', reason: result.reason })
      }
    } catch (err) {
      errors++
      details.push({ id: row.id, status: 'error', reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, dispatched, skipped, errors, details })
}
