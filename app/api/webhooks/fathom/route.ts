import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getTenantBySlug } from '@/lib/tenant'
import { upsertLead, logCall, supabase } from '@/lib/supabase'
import { getMemberByEmail, getOwnerMember } from '@/lib/members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Fathom (or any compatible call-intel) webhook.
 *
 *   POST /api/webhooks/fathom?rep=<slug>&token=<FATHOM_WEBHOOK_SECRET>
 *
 * Or pass the token via the `X-Fathom-Token` header instead of the query.
 *
 * The handler is defensive about payload shape — Fathom AI fields shift
 * between integrations. We pull what we can from common keys and fall back
 * gracefully.
 *
 * What it does:
 *   1. Resolves the tenant by `?rep=<slug>` (required).
 *   2. Verifies the shared secret (FATHOM_WEBHOOK_SECRET).
 *   3. Picks the first external attendee email, uses that to find/create
 *      the lead, then attributes the call to the matching member if any
 *      (otherwise to the account owner).
 *   4. Logs a call_logs row with the meeting summary + recording URL.
 *   5. Creates brain_items (item_type='task') for every action item.
 */

type FathomAttendee = {
  email?: string | null
  name?: string | null
  is_external?: boolean | null
  external?: boolean | null
  is_user?: boolean | null
}

type FathomPayload = {
  // Common shapes across versions
  meeting_title?: string | null
  title?: string | null
  recording_url?: string | null
  share_url?: string | null
  recording_share_url?: string | null
  url?: string | null
  summary?: string | null
  ai_summary?: string | null
  notes?: string | null
  duration_seconds?: number | null
  duration?: number | null
  duration_minutes?: number | null
  meeting_started_at?: string | null
  started_at?: string | null
  occurred_at?: string | null
  attendees?: FathomAttendee[] | null
  participants?: FathomAttendee[] | null
  action_items?: Array<string | { text?: string; description?: string }> | null
  actionItems?: Array<string | { text?: string; description?: string }> | null
  // Free-form passthrough
  [key: string]: unknown
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

function pickString(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function pickNumber(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function pickAttendees(p: FathomPayload): FathomAttendee[] {
  if (Array.isArray(p.attendees)) return p.attendees
  if (Array.isArray(p.participants)) return p.participants
  return []
}

function pickFirstExternalEmail(
  attendees: FathomAttendee[],
  ownerEmail: string | null,
): { email: string | null; name: string | null } {
  // Prefer attendees explicitly marked external; otherwise anyone whose email
  // is not the owner's.
  const ownerLower = ownerEmail?.toLowerCase() ?? null
  const flagged = attendees.find(
    (a) => (a.is_external ?? a.external) === true && a.email,
  )
  if (flagged?.email) return { email: flagged.email, name: flagged.name ?? null }

  for (const a of attendees) {
    const e = a.email?.toLowerCase()
    if (e && e !== ownerLower && !(a.is_user === true)) {
      return { email: a.email!, name: a.name ?? null }
    }
  }
  return { email: null, name: null }
}

function pickActionItems(p: FathomPayload): string[] {
  const raw = p.action_items ?? p.actionItems ?? []
  if (!Array.isArray(raw)) return []
  return raw
    .map((it) => {
      if (typeof it === 'string') return it
      if (it && typeof it === 'object') return it.text ?? it.description ?? ''
      return ''
    })
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const repSlug = url.searchParams.get('rep')
  if (!repSlug) {
    return NextResponse.json({ ok: false, error: 'missing ?rep=<slug>' }, { status: 400 })
  }

  // Auth: shared secret via query (?token=) or header.
  const expected = process.env.FATHOM_WEBHOOK_SECRET
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'webhook not configured' }, { status: 503 })
  }
  const provided = url.searchParams.get('token') ?? req.headers.get('x-fathom-token') ?? ''
  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let payload: FathomPayload
  try {
    payload = (await req.json()) as FathomPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const tenant = await getTenantBySlug(repSlug)
  if (!tenant) {
    return NextResponse.json({ ok: false, error: 'tenant not found' }, { status: 404 })
  }

  const owner = await getOwnerMember(tenant.id)
  const attendees = pickAttendees(payload)
  const { email: leadEmail, name: leadName } = pickFirstExternalEmail(
    attendees,
    tenant.email ?? owner?.email ?? null,
  )

  const title = pickString(payload.meeting_title, payload.title) ?? 'Sales call'
  const summary = pickString(payload.summary, payload.ai_summary, payload.notes) ?? title
  const recordingUrl = pickString(
    payload.recording_url,
    payload.recording_share_url,
    payload.share_url,
    payload.url,
  )
  const occurredAt =
    pickString(payload.occurred_at, payload.meeting_started_at, payload.started_at) ??
    new Date().toISOString()

  const durationSec = pickNumber(payload.duration_seconds, payload.duration)
  const durationMin =
    pickNumber(payload.duration_minutes) ??
    (durationSec != null ? Math.max(1, Math.round(durationSec / 60)) : null)

  // Resolve owner_member_id: try to match a Fathom user attendee to a member.
  let ownerMemberId: string | null = owner?.id ?? null
  for (const a of attendees) {
    if (!a.email) continue
    if (a.is_external || a.external) continue
    const m = await getMemberByEmail(tenant.id, a.email)
    if (m) {
      ownerMemberId = m.id
      break
    }
  }

  // Find or create the lead.
  let leadId: string | null = null
  let contactName = leadName ?? leadEmail ?? title
  if (leadEmail) {
    // Try to match an existing lead by email first.
    const { data: byEmail } = await supabase
      .from('leads')
      .select('*')
      .eq('rep_id', tenant.id)
      .ilike('email', leadEmail)
      .limit(1)
      .maybeSingle()
    if (byEmail?.id) {
      leadId = byEmail.id
      contactName = byEmail.name || contactName
    } else {
      const lead = await upsertLead({
        repId: tenant.id,
        name: leadName ?? leadEmail,
        email: leadEmail,
        source: 'fathom',
        notes: `Auto-created from Fathom call: ${title}`,
        ownerMemberId,
        touchContact: true,
      })
      leadId = lead.id
      contactName = lead.name
    }
  }

  // Build the call_logs summary (include recording URL inline).
  const callSummary = [
    summary,
    recordingUrl ? `Recording: ${recordingUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  await logCall({
    repId: tenant.id,
    leadId,
    contactName,
    summary: callSummary,
    outcome: 'positive',
    durationMinutes: durationMin,
    occurredAt,
    ownerMemberId,
  })

  // Touch lead.last_contact for freshness if we found one.
  if (leadId) {
    await supabase
      .from('leads')
      .update({ last_contact: occurredAt })
      .eq('id', leadId)
      .eq('rep_id', tenant.id)
  }

  // Action items → brain_items (tasks).
  const actionItems = pickActionItems(payload)
  let tasksCreated = 0
  if (actionItems.length > 0) {
    const rows = actionItems.slice(0, 20).map((content) => ({
      rep_id: tenant.id,
      owner_member_id: ownerMemberId,
      item_type: 'task' as const,
      content,
      priority: 'normal' as const,
      horizon: 'week' as const,
      status: 'open' as const,
    }))
    const { error } = await supabase.from('brain_items').insert(rows)
    if (!error) tasksCreated = rows.length
  }

  return NextResponse.json({
    ok: true,
    tenant: tenant.slug,
    lead_id: leadId,
    tasks_created: tasksCreated,
    recording_url: recordingUrl,
  })
}

// Fathom often pings the URL with GET on save to verify reachability.
export async function GET() {
  return NextResponse.json({ ok: true, service: 'virtualcloser/fathom' })
}
