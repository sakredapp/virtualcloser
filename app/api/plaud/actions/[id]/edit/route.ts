// Edit a pending Plaud action's payload and (optionally) its resolved
// recipient. The dashboard posts a partial payload patch + the recipient
// the user picked from the directory autocomplete.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EditBody = {
  payload_patch?: Record<string, unknown>
  target_member_id?: string | null
  target_contact_id?: string | null
  target_email?: string | null
  recipient_resolved?: boolean // pass true when user picked from directory
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as EditBody

  // Load existing row to verify tenant + grab current payload for merge.
  const { data: row } = await supabase
    .from('plaud_actions')
    .select('id, rep_id, payload, status')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const r = row as { id: string; rep_id: string; payload: Record<string, unknown>; status: string }
  if (r.rep_id !== tenant.id) {
    return NextResponse.json({ ok: false, error: 'wrong tenant' }, { status: 403 })
  }
  if (r.status === 'executed') {
    return NextResponse.json({ ok: false, error: 'already executed' }, { status: 409 })
  }

  const mergedPayload: Record<string, unknown> = { ...r.payload, ...(body.payload_patch ?? {}) }
  // Clear the unresolved flag when the caller says they resolved the recipient.
  if (body.recipient_resolved) {
    delete mergedPayload.recipient_unresolved
  }

  const update: Record<string, unknown> = {
    payload: mergedPayload,
    updated_at: new Date().toISOString(),
    error: null,
  }
  if (body.target_member_id !== undefined) update.target_member_id = body.target_member_id
  if (body.target_contact_id !== undefined) update.target_contact_id = body.target_contact_id
  if (body.target_email !== undefined) update.target_email = body.target_email
  // If the action was failed, return it to pending so /approve can re-run it.
  if (r.status === 'failed') update.status = 'pending'

  const { error } = await supabase.from('plaud_actions').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
