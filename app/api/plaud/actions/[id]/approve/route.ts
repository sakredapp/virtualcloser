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

  const ctx = await loadActionContext(id)
  if (!ctx) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  if (ctx.rep.id !== tenant.id) {
    return NextResponse.json({ ok: false, error: 'wrong tenant' }, { status: 403 })
  }

  // Refuse if already executed — avoid double-sends.
  const { data: existing } = await supabase
    .from('plaud_actions')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  const status = (existing as { status: string } | null)?.status
  if (status === 'executed') {
    return NextResponse.json({ ok: false, error: 'already executed' }, { status: 409 })
  }
  if (status === 'dismissed') {
    return NextResponse.json({ ok: false, error: 'dismissed' }, { status: 409 })
  }

  // Cannot approve an unresolved recipient — UI should force /edit first.
  if (ctx.action.recipient_unresolved) {
    return NextResponse.json(
      { ok: false, error: 'recipient unresolved — edit first' },
      { status: 400 },
    )
  }

  await supabase
    .from('plaud_actions')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', id)

  const ok = await executeAction(id, ctx.action, ctx.note, ctx.rep)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'execution failed — see action.error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
