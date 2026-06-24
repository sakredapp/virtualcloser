// Mark a Plaud action as dismissed (won't be executed, hidden from default
// queue views). Soft action — the row stays for audit history.
//
// Self-learning: if the user gives a reason for dismissing, we distill it into
// a durable rule (plaud_agent_guidance) so the per-note agent stops proposing
// the same kind of action. A reasonless dismissal is too weak a signal to learn
// from, so we only learn when there are words.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { learnFromFeedback } from '@/lib/plaud/guidance'
import { describeAction } from '@/lib/plaud/actionContext'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { reason?: string }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''

  const { data: row } = await supabase
    .from('plaud_actions')
    .select('rep_id, status, kind, payload, target_email')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const r = row as {
    rep_id: string
    status: string
    kind: string
    payload: Record<string, unknown>
    target_email: string | null
  }
  if (r.rep_id !== tenant.id) {
    return NextResponse.json({ ok: false, error: 'wrong tenant' }, { status: 403 })
  }
  if (r.status === 'executed') {
    return NextResponse.json({ ok: false, error: 'already executed' }, { status: 409 })
  }

  const { error } = await supabase
    .from('plaud_actions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Learn from the dismissal (best-effort — never blocks the dismiss result).
  let learned: string | null = null
  if (reason) {
    try {
      const { data: repRow } = await supabase
        .from('reps')
        .select('claude_api_key')
        .eq('id', tenant.id)
        .maybeSingle()
      const rule = await learnFromFeedback({
        repId: tenant.id,
        claudeKey: (repRow as { claude_api_key?: string | null } | null)?.claude_api_key,
        source: 'action',
        scope: 'note_agent',
        signal: 'avoid',
        context: describeAction(r.kind, r.payload, r.target_email),
        reason,
        sourceKind: r.kind,
        sourceRef: id,
      })
      learned = rule?.rule ?? null
    } catch (err) {
      console.warn('[plaud-dismiss] learn failed', String(err).slice(0, 160))
    }
  }

  return NextResponse.json({ ok: true, learned })
}
