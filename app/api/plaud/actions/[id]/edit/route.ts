// Edit a pending Plaud action's payload and (optionally) its resolved
// recipient. The dashboard posts a partial payload patch + the recipient
// the user picked from the directory autocomplete.
//
// SECURITY: For people-touching kinds (send_email, create_calendar_event),
// the recipient is locked once it has been resolved from the directory.
// This prevents a user from approving an email "to Lauren" after editing
// the destination to point somewhere arbitrary. To change the recipient
// of a resolved action, the user must dismiss + re-create from the
// transcript — surfacing the change explicitly.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { PEOPLE_TOUCHING_KINDS, type PlaudActionKind } from '@/lib/plaud/agentTools'
import { learnFromFeedback } from '@/lib/plaud/guidance'
import { describeAction } from '@/lib/plaud/actionContext'

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EditBody = {
  payload_patch?: Record<string, unknown>
  target_member_id?: string | null
  target_contact_id?: string | null
  target_email?: string | null
  recipient_resolved?: boolean // pass true when user picked from directory
}

// Keys in the payload that name the destination of a people-touching action.
// These are immutable post-resolution for send_email / create_calendar_event.
const RECIPIENT_KEYS_BY_KIND: Record<string, ReadonlySet<string>> = {
  send_email: new Set(['recipient', 'to']),
  create_calendar_event: new Set(['attendees']),
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
    .select('id, rep_id, kind, payload, status, target_email, target_member_id, target_contact_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const r = row as {
    id: string
    rep_id: string
    kind: PlaudActionKind
    payload: Record<string, unknown>
    status: string
    target_email: string | null
    target_member_id: string | null
    target_contact_id: string | null
  }
  if (r.rep_id !== tenant.id) {
    return NextResponse.json({ ok: false, error: 'wrong tenant' }, { status: 403 })
  }
  if (r.status === 'executed') {
    return NextResponse.json({ ok: false, error: 'already executed' }, { status: 409 })
  }
  if (r.status === 'dismissed') {
    return NextResponse.json({ ok: false, error: 'dismissed' }, { status: 409 })
  }

  const isPeopleTouching = PEOPLE_TOUCHING_KINDS.has(r.kind)
  const alreadyResolved =
    Boolean(r.target_email || r.target_member_id || r.target_contact_id) &&
    !Boolean(r.payload?.recipient_unresolved)

  // Lock recipient mutations for already-resolved people-touching actions.
  // The recipient was vetted (auto-resolved from directory or explicitly
  // confirmed by the user); changing it now would let an approver send to
  // a different address than the one shown in the UI when they clicked
  // "approve."
  if (isPeopleTouching && alreadyResolved) {
    const recipientKeys = RECIPIENT_KEYS_BY_KIND[r.kind] ?? new Set<string>()
    const patchKeys = Object.keys(body.payload_patch ?? {})
    const touchesRecipient =
      patchKeys.some((k) => recipientKeys.has(k)) ||
      body.target_email !== undefined ||
      body.target_member_id !== undefined ||
      body.target_contact_id !== undefined
    if (touchesRecipient) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'recipient_locked: dismiss this action and propose a new one to change the destination',
        },
        { status: 403 },
      )
    }
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

  // Self-learning: when the user resolves a recipient the agent didn't know
  // (it proposed an action with an unresolved name and the user supplied the
  // email), capture that as a durable fact so the agent resolves it next time.
  let learned: string | null = null
  const unresolvedName = str(r.payload?.recipient_unresolved) || str(r.payload?.recipient)
  const newEmail = str(body.target_email)
  if (body.recipient_resolved && newEmail && unresolvedName) {
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
        scope: 'both',
        signal: 'correction',
        context: describeAction(r.kind, r.payload, r.target_email),
        reason: `Recipient "${unresolvedName}" was unknown to the directory; their correct email is ${newEmail}.`,
        sourceKind: r.kind,
        sourceRef: id,
      })
      learned = rule?.rule ?? null
    } catch (err) {
      console.warn('[plaud-edit] learn failed', String(err).slice(0, 160))
    }
  }

  return NextResponse.json({ ok: true, learned })
}
