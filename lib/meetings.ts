// Meetings: normalized appointment records used by the AI dialer.
// Hydrated from Google Calendar (and optionally Cal.com / GHL). Each row is
// one scheduled call/meeting that the confirm-appointments cron may dial
// 30–90 min before `scheduled_at`.

import { supabase } from './supabase'
import { listUpcomingEvents } from './google'
import { makeAgentCRMForRep } from './agentcrm'

export type MeetingStatus =
  | 'scheduled'
  | 'confirmed'
  | 'reschedule_requested'
  | 'rescheduled'
  | 'cancelled'
  | 'no_response'
  | 'completed'
  | 'noshow'

export type MeetingSource = 'google' | 'cal' | 'ghl' | 'manual'

export type Meeting = {
  id: string
  rep_id: string
  lead_id: string | null
  prospect_id: string | null
  source: MeetingSource
  source_event_id: string | null
  attendee_name: string | null
  attendee_email: string | null
  phone: string | null
  scheduled_at: string
  duration_min: number | null
  timezone: string | null
  title: string | null
  description: string | null
  meeting_url: string | null
  status: MeetingStatus
  confirmation_attempts: number
  last_call_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ── CRUD ────────────────────────────────────────────────────────────────

export async function getMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Meeting | null) ?? null
}

export async function listUpcomingMeetingsForRep(
  repId: string,
  opts: { fromIso?: string; toIso?: string; limit?: number } = {},
): Promise<Meeting[]> {
  const fromIso = opts.fromIso ?? new Date().toISOString()
  const toIso =
    opts.toIso ?? new Date(Date.now() + 7 * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('rep_id', repId)
    .gte('scheduled_at', fromIso)
    .lte('scheduled_at', toIso)
    .order('scheduled_at', { ascending: true })
    .limit(opts.limit ?? 100)
  if (error) throw error
  return (data ?? []) as Meeting[]
}

/** Find meetings the dialer should call now: 30–90 min out, scheduled, no calls yet. */
export async function listMeetingsToConfirm(opts: {
  windowStartMin: number
  windowEndMin: number
  limit?: number
}): Promise<Meeting[]> {
  const now = Date.now()
  const fromIso = new Date(now + opts.windowStartMin * 60_000).toISOString()
  const toIso = new Date(now + opts.windowEndMin * 60_000).toISOString()
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('status', 'scheduled')
    .eq('confirmation_attempts', 0)
    .not('phone', 'is', null)
    .gte('scheduled_at', fromIso)
    .lte('scheduled_at', toIso)
    .order('scheduled_at', { ascending: true })
    .limit(opts.limit ?? 100)
  if (error) throw error
  return (data ?? []) as Meeting[]
}

export async function updateMeetingStatus(
  id: string,
  patch: Partial<
    Pick<
      Meeting,
      'status' | 'confirmation_attempts' | 'last_call_id' | 'scheduled_at' | 'metadata'
    >
  >,
): Promise<void> {
  const { error } = await supabase.from('meetings').update(patch).eq('id', id)
  if (error) throw error
}

export async function incrementConfirmationAttempt(
  id: string,
  callId: string,
): Promise<void> {
  // Use raw RPC-style atomic increment via select-then-update — small enough
  // to be safe under the cron's per-row pacing.
  const { data } = await supabase
    .from('meetings')
    .select('confirmation_attempts')
    .eq('id', id)
    .maybeSingle()
  const next = (data?.confirmation_attempts ?? 0) + 1
  await supabase
    .from('meetings')
    .update({ confirmation_attempts: next, last_call_id: callId })
    .eq('id', id)
}

// ── Hydrator ────────────────────────────────────────────────────────────
// Pulls upcoming events from the rep's Google Calendar into meetings rows.
// Idempotent on (rep_id, source, source_event_id).

export type HydrateResult = {
  ok: boolean
  inserted: number
  updated: number
  skipped: number
  reason?: string
}

export async function hydrateMeetingsFromGoogle(
  repId: string,
  opts: { lookaheadHours?: number; timezone?: string } = {},
): Promise<HydrateResult> {
  const lookahead = opts.lookaheadHours ?? 36
  const fromIso = new Date().toISOString()
  const toIso = new Date(Date.now() + lookahead * 3600_000).toISOString()

  const events = await listUpcomingEvents(repId, {
    fromIso,
    toIso,
    maxResults: 100,
    timeZone: opts.timezone,
  })
  if (events === null) return { ok: false, inserted: 0, updated: 0, skipped: 0, reason: 'not_connected' }
  if (!events.length) return { ok: true, inserted: 0, updated: 0, skipped: 0 }

  // Pull existing rows for this rep keyed by source_event_id.
  const { data: existing } = await supabase
    .from('meetings')
    .select('id, source_event_id, scheduled_at, status')
    .eq('rep_id', repId)
    .eq('source', 'google')
    .in('source_event_id', events.map((e) => e.id))
  const existingMap = new Map<string, { id: string; scheduled_at: string; status: string }>()
  for (const row of existing ?? []) {
    if (row.source_event_id) existingMap.set(row.source_event_id, row)
  }

  // Get all leads for this rep so we can attempt attendee→lead matching.
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, email, phone')
    .eq('rep_id', repId)
  const leadByEmail = new Map<string, { id: string; phone: string | null; name: string }>()
  const leadByName = new Map<string, { id: string; phone: string | null; name: string }>()
  for (const l of leads ?? []) {
    if (l.email) leadByEmail.set(l.email.toLowerCase(), { id: l.id, phone: l.phone, name: l.name })
    if (l.name) leadByName.set(l.name.toLowerCase(), { id: l.id, phone: l.phone, name: l.name })
  }

  let inserted = 0
  let updated = 0
  let skipped = 0

  for (const ev of events) {
    if (!ev.start) {
      skipped++
      continue
    }
    // Skip all-day events (date-only, no dateTime) — those aren't calls.
    if (!/T\d/.test(ev.start)) {
      skipped++
      continue
    }
    // Skip past events (already started by the time we run).
    if (new Date(ev.start).getTime() < Date.now()) {
      skipped++
      continue
    }

    // Pick the first non-organizer attendee as the lead candidate.
    const attendee = ev.attendees?.find((a) => a.responseStatus !== 'declined')
    const attendeeEmail = attendee?.email?.toLowerCase()
    const attendeeName = attendee?.displayName ?? null

    let leadId: string | null = null
    let phone: string | null = null
    if (attendeeEmail && leadByEmail.has(attendeeEmail)) {
      const m = leadByEmail.get(attendeeEmail)!
      leadId = m.id
      phone = m.phone
    } else if (attendeeName && leadByName.has(attendeeName.toLowerCase())) {
      const m = leadByName.get(attendeeName.toLowerCase())!
      leadId = m.id
      phone = m.phone
    } else if (ev.summary) {
      // Try matching event title against lead names ("Call w/ Dana Smith").
      for (const [k, v] of leadByName) {
        if (ev.summary.toLowerCase().includes(k)) {
          leadId = v.id
          phone = v.phone
          break
        }
      }
    }

    // Try to extract a phone from event description if we don't have one.
    if (!phone && ev.summary) {
      const match = (ev.summary + ' ').match(/(\+?\d[\d\s\-().]{8,}\d)/)
      if (match) phone = match[1].replace(/[^\d+]/g, '')
    }

    const durationMin =
      ev.start && ev.end
        ? Math.max(
            5,
            Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60_000),
          )
        : 30

    const existingRow = existingMap.get(ev.id)
    if (existingRow) {
      // Only update if the time changed (event was rescheduled in Google).
      if (existingRow.scheduled_at !== ev.start) {
        await supabase
          .from('meetings')
          .update({
            scheduled_at: ev.start,
            duration_min: durationMin,
            title: ev.summary,
            attendee_email: attendeeEmail ?? null,
            attendee_name: attendeeName,
            // Reset to scheduled if it had been confirmed but the time moved —
            // we want to call again to re-confirm the new slot.
            status:
              existingRow.status === 'confirmed' ? 'scheduled' : (existingRow.status as MeetingStatus),
            confirmation_attempts: existingRow.status === 'confirmed' ? 0 : undefined,
          })
          .eq('id', existingRow.id)
        updated++
      } else {
        skipped++
      }
      continue
    }

    await supabase.from('meetings').insert({
      rep_id: repId,
      lead_id: leadId,
      source: 'google',
      source_event_id: ev.id,
      attendee_name: attendeeName,
      attendee_email: attendeeEmail ?? null,
      phone,
      scheduled_at: ev.start,
      duration_min: durationMin,
      timezone: opts.timezone ?? null,
      title: ev.summary,
      meeting_url: ev.htmlLink,
    })
    inserted++
  }

  return { ok: true, inserted, updated, skipped }
}

// ── GHL Calendar Hydrator ─────────────────────────────────────────────────
// Pulls upcoming appointments from each AI SDR's GHL calendar into meetings.
// Complements the Google hydrator — runs alongside it in the cron.
// Idempotent on (rep_id, source='ghl', source_event_id).

export async function hydrateMeetingsFromGHL(
  repId: string,
  opts: { lookaheadHours?: number } = {},
): Promise<HydrateResult> {
  const crm = await makeAgentCRMForRep(repId)
  if (!crm) return { ok: false, inserted: 0, updated: 0, skipped: 0, reason: 'not_connected' }

  // Collect all GHL calendar IDs from active AI SDRs for this tenant.
  const { data: setters } = await supabase
    .from('ai_salespeople')
    .select('id, calendar')
    .eq('rep_id', repId)
    .eq('status', 'active')
  const calendarIds = new Set<string>()
  for (const s of setters ?? []) {
    const cal = (s.calendar ?? {}) as { calendar_id?: string; provider?: string }
    if (cal.provider !== 'ghl' && cal.provider != null) continue
    if (cal.calendar_id) calendarIds.add(cal.calendar_id)
  }
  if (!calendarIds.size) return { ok: true, inserted: 0, updated: 0, skipped: 0 }

  const lookahead = opts.lookaheadHours ?? 36
  const now = Date.now()
  const endMs = now + lookahead * 3600_000

  let inserted = 0
  let updated = 0
  let skipped = 0

  for (const calendarId of calendarIds) {
    let appointments: Awaited<ReturnType<typeof crm.getAppointments>>
    try {
      appointments = await crm.getAppointments(calendarId, { startMs: now, endMs })
    } catch {
      skipped++
      continue
    }

    for (const appt of appointments) {
      const startTime = appt.startTime as string | undefined
      const sourceEventId = appt.id as string | undefined
      if (!startTime || !sourceEventId) { skipped++; continue }
      // Skip past appointments
      if (new Date(startTime).getTime() < Date.now()) { skipped++; continue }

      // Check if already in meetings table
      const { data: existing } = await supabase
        .from('meetings')
        .select('id, status')
        .eq('rep_id', repId)
        .eq('source', 'ghl')
        .eq('source_event_id', sourceEventId)
        .maybeSingle()

      const apptStatus = ((appt.status as string | undefined) ?? '').toLowerCase()
      const isCancelled = apptStatus === 'cancelled' || apptStatus === 'canceled'

      if (existing) {
        if (isCancelled && existing.status !== 'cancelled') {
          await supabase
            .from('meetings')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', existing.id)
          updated++
        } else {
          skipped++
        }
        continue
      }

      if (isCancelled) { skipped++; continue }

      // Resolve phone from contactId if possible
      let phone: string | null = null
      const contactId = appt.contactId as string | undefined
      if (contactId) {
        try {
          const contact = await crm.searchContacts(contactId)
          phone = (contact[0]?.phone as string | undefined) ?? null
        } catch { /* best-effort */ }
      }

      await supabase.from('meetings').insert({
        rep_id: repId,
        source: 'ghl',
        source_event_id: sourceEventId,
        attendee_name: (appt.title as string | undefined) ?? null,
        phone,
        scheduled_at: startTime,
        title: (appt.title as string | undefined) ?? null,
        status: 'scheduled',
      })
      inserted++
    }
  }

  return { ok: true, inserted, updated, skipped }
}
