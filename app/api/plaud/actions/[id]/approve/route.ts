// Approve and execute a pending Plaud action.
//
// Used by the dashboard for the people-touching action kinds (send_email,
// create_calendar_event) that the auto-executor refuses to run unattended.
// Also handles re-running a failed auto-action after the user fixes its
// payload via /edit.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { executeAction, loadActionContext } from '@/lib/plaud/agentTick'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  // loadActionContext enforces rep_id = tenant.id at query time so
  // cross-tenant uuid guessing can't load another tenant's action.
  const ctx = await loadActionContext(id, tenant.id)
  if (!ctx) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  // Cannot approve an unresolved recipient — UI should force /edit first.
  if (ctx.action.recipient_unresolved) {
    return NextResponse.json(
      { ok: false, error: 'recipient unresolved — edit first' },
      { status: 400 },
    )
  }

  // Atomic claim: flip status pending|failed → approved in a single update
  // filtered by status. Concurrent double-clicks lose the race (rowcount 0)
  // and see a clean 409 instead of double-sending an email / double-booking
  // a calendar event.
  const claimAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from('plaud_actions')
    .update({
      status: 'approved',
      approved_at: claimAt,
      updated_at: claimAt,
      error: null,
    })
    .eq('id', id)
    .in('status', ['pending', 'failed'])
    .select('id')
  if (claimErr) {
    return NextResponse.json({ ok: false, error: claimErr.message }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    // Either already approved/executed/dismissed or rowcount lost. Re-read
    // to return an accurate status code to the UI.
    const { data: now } = await supabase
      .from('plaud_actions')
      .select('status')
      .eq('id', id)
      .maybeSingle()
    const nowStatus = (now as { status: string } | null)?.status ?? 'unknown'
    if (nowStatus === 'executed') {
      return NextResponse.json({ ok: false, error: 'already executed' }, { status: 409 })
    }
    if (nowStatus === 'dismissed') {
      return NextResponse.json({ ok: false, error: 'dismissed' }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: `cannot approve in status=${nowStatus}` }, { status: 409 })
  }

  const ok = await executeAction(id, ctx.action, ctx.note, ctx.rep)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'execution failed — see action.error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
