// Act on / dismiss a proactive recommendation. Dismiss-with-reason feeds the
// same learning loop as everything else: it becomes a planner guidance rule
// (so the overseer stops suggesting it) and, if it's really a software issue,
// auto-routes into the daily fix digest.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string }
  const action = body.action === 'act' || body.action === 'dismiss' ? body.action : null
  if (!action) return NextResponse.json({ ok: false, error: 'action must be act|dismiss' }, { status: 400 })
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''

  const { data: row } = await supabase
    .from('recommendations')
    .select('id, rep_id, status, title, kind')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const r = row as { id: string; rep_id: string; status: string; title: string; kind: string }
  if (r.rep_id !== tenant.id) {
    return NextResponse.json({ ok: false, error: 'wrong tenant' }, { status: 403 })
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('recommendations')
    .update({
      status: action === 'act' ? 'acted' : 'dismissed',
      dismissed_reason: action === 'dismiss' ? reason || null : null,
      updated_at: now,
    })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Learn from a dismissal-with-reason (best-effort; never blocks the result).
  let learned: string | null = null
  if (action === 'dismiss' && reason) {
    try {
      const { learnFromFeedback } = await import('@/lib/plaud/guidance')
      const { data: repRow } = await supabase
        .from('reps')
        .select('claude_api_key')
        .eq('id', tenant.id)
        .maybeSingle()
      const rule = await learnFromFeedback({
        repId: tenant.id,
        claudeKey: (repRow as { claude_api_key?: string | null } | null)?.claude_api_key,
        source: 'manual',
        scope: 'planner',
        signal: 'avoid',
        context: `Proactive recommendation: ${r.title}`,
        reason,
        sourceKind: r.kind,
        sourceRef: id,
      })
      learned = rule?.rule ?? null
    } catch (err) {
      console.warn('[recommendations] learn failed', String(err).slice(0, 160))
    }
  }

  return NextResponse.json({ ok: true, learned })
}
