import { supabase, logCall } from './supabase'
import { pushLeadDispositionToFurnace } from './furnace'
import type { CrmLead, Disposition, LeadNote, LeadEvent, Activity, ActivityType } from '@/types'

export const DISPOSITION_ORDER: Disposition[] = [
  'new', 'no_answer', 'left_voicemail', 'callback', 'interested',
  'sent_info', 'appointment_set', 'application_sent', 'application_approved',
  'not_interested', 'do_not_contact', 'wrong_number', 'disconnected',
  'disqualified', 'reschedule', 'second_call_booked', 'third_call_booked',
  'aca', 'unresponsive',
]

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  new: 'New',
  no_answer: 'No Answer',
  left_voicemail: 'Left Voicemail',
  callback: 'Callback',
  interested: 'Interested',
  sent_info: 'Sent Info',
  appointment_set: 'Appt Set',
  application_sent: 'App Sent',
  application_approved: 'App Approved',
  not_interested: 'Not Interested',
  do_not_contact: 'Do Not Contact',
  wrong_number: 'Wrong Number',
  disconnected: 'Disconnected',
  disqualified: 'Disqualified',
  reschedule: 'Reschedule',
  second_call_booked: 'Second Call',
  third_call_booked: 'Third Call',
  aca: 'ACA',
  unresponsive: 'Unresponsive',
}

// Protected: can't be overwritten by low-signal outcomes
const PROTECTED: Set<Disposition> = new Set([
  'appointment_set', 'application_sent', 'application_approved', 'aca',
])

const LOW_SIGNAL: Set<Disposition> = new Set([
  'no_answer', 'left_voicemail', 'unresponsive',
])

export const DISPOSITION_COLOR: Record<Disposition, { bg: string; text: string; border: string }> = {
  new:                  { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
  no_answer:            { bg: '#fef9c3', text: '#713f12', border: '#fde047' },
  left_voicemail:       { bg: '#fef3c7', text: '#92400e', border: '#fbbf24' },
  callback:             { bg: '#eff6ff', text: '#1e40af', border: '#93c5fd' },
  interested:           { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7' },
  sent_info:            { bg: '#f0fdf4', text: '#166534', border: '#86efac' },
  appointment_set:      { bg: '#dbeafe', text: '#1e3a8a', border: '#3b82f6' },
  application_sent:     { bg: '#f5f3ff', text: '#5b21b6', border: '#c4b5fd' },
  application_approved: { bg: '#d1fae5', text: '#065f46', border: '#34d399' },
  not_interested:       { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' },
  do_not_contact:       { bg: '#fee2e2', text: '#7f1d1d', border: '#ef4444' },
  wrong_number:         { bg: '#f9fafb', text: '#6b7280', border: '#9ca3af' },
  disconnected:         { bg: '#f9fafb', text: '#6b7280', border: '#9ca3af' },
  disqualified:         { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' },
  reschedule:           { bg: '#fff7ed', text: '#9a3412', border: '#fb923c' },
  second_call_booked:   { bg: '#e0f2fe', text: '#0c4a6e', border: '#38bdf8' },
  third_call_booked:    { bg: '#e0f2fe', text: '#0c4a6e', border: '#38bdf8' },
  aca:                  { bg: '#d1fae5', text: '#065f46', border: '#34d399' },
  unresponsive:         { bg: '#f9fafb', text: '#6b7280', border: '#9ca3af' },
}

export const DISPOSITION_STATUS_MAP: Record<Disposition, string> = {
  new: 'attempted', no_answer: 'attempted', left_voicemail: 'attempted',
  unresponsive: 'attempted', callback: 'contacted', interested: 'contacted',
  sent_info: 'contacted', reschedule: 'contacted',
  appointment_set: 'meeting_set', second_call_booked: 'meeting_set',
  third_call_booked: 'meeting_set', application_sent: 'meeting_set',
  application_approved: 'converted', aca: 'converted',
  not_interested: 'disqualified', do_not_contact: 'disqualified',
  wrong_number: 'disqualified', disconnected: 'disqualified', disqualified: 'disqualified',
}

export type CrmFilter = {
  search?: string
  source?: string
  assignee?: string
  disposition?: Disposition | ''
  productIntent?: string
}

function escapeLike(s: string): string {
  // Escape ILIKE special chars; strip commas which break PostgREST .or() parsing
  return s.replace(/[%_\\]/g, '\\$&').replace(/,/g, '')
}

export async function listCrmLeads(repId: string, filter: CrmFilter = {}): Promise<CrmLead[]> {
  let q = supabase.from('leads').select('*').eq('rep_id', repId).order('created_at', { ascending: false })
  if (filter.search) {
    const safe = escapeLike(filter.search)
    q = q.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%,company.ilike.%${safe}%`)
  }
  if (filter.source) q = q.eq('source', filter.source)
  if (filter.assignee) q = q.eq('owner_member_id', filter.assignee)
  if (filter.disposition) q = q.eq('disposition', filter.disposition)
  if (filter.productIntent) q = q.eq('product_intent', filter.productIntent)
  const { data, error } = await q.limit(500)
  if (error) throw error
  return (data ?? []) as CrmLead[]
}

export async function getCrmLead(repId: string, id: string): Promise<CrmLead | null> {
  const { data } = await supabase.from('leads').select('*').eq('rep_id', repId).eq('id', id).maybeSingle()
  return (data as CrmLead | null) ?? null
}

export async function setDisposition(
  repId: string, leadId: string,
  newDisp: Disposition, memberId?: string
): Promise<void> {
  const { data: cur } = await supabase.from('leads').select('disposition').eq('id', leadId).maybeSingle()
  const old = (cur?.disposition as Disposition | null) ?? null
  // Protected guard
  if (old && PROTECTED.has(old) && LOW_SIGNAL.has(newDisp)) return
  await supabase.from('leads').update({
    disposition: newDisp,
    disposition_changed_at: new Date().toISOString(),
    last_contacted_at: new Date().toISOString(),
  }).eq('id', leadId).eq('rep_id', repId)
  // Log event
  await supabase.from('lead_events').insert({
    rep_id: repId, lead_id: leadId,
    event_label: `${old ?? 'new'} → ${newDisp}`,
    from_disposition: old, to_disposition: newDisp,
    member_id: memberId ?? null,
  })
  // Push to Furnace if this is a Furnace-originated lead
  void pushLeadDispositionToFurnace(repId, leadId, newDisp)
}

export async function getLeadNotes(repId: string, leadId: string): Promise<LeadNote[]> {
  const { data } = await supabase.from('lead_notes').select('*, author:members(display_name)').eq('rep_id', repId).eq('lead_id', leadId).order('created_at', { ascending: false })
  return (data ?? []) as LeadNote[]
}

export async function addLeadNote(repId: string, leadId: string, content: string, authorId?: string): Promise<void> {
  await supabase.from('lead_notes').insert({ rep_id: repId, lead_id: leadId, content, author_id: authorId ?? null })
}

export async function getLeadEvents(repId: string, leadId: string): Promise<LeadEvent[]> {
  const { data } = await supabase.from('lead_events').select('*').eq('rep_id', repId).eq('lead_id', leadId).order('created_at', { ascending: false })
  return (data ?? []) as LeadEvent[]
}

export async function getLeadCallLogs(repId: string, leadId: string) {
  const [{ data: manual }, { data: ai }, leadRow] = await Promise.all([
    supabase
      .from('call_logs')
      .select('*')
      .eq('rep_id', repId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    supabase
      .from('voice_calls')
      .select('id, rep_id, lead_id, outcome, summary, transcript, recording_url, duration_sec, dialer_mode, to_number, created_at, started_at')
      .eq('rep_id', repId)
      .eq('lead_id', leadId)
      .not('status', 'in', '("queued","ringing","blocked_cap")')
      .order('created_at', { ascending: false }),
    supabase
      .from('leads')
      .select('name')
      .eq('id', leadId)
      .maybeSingle(),
  ])

  const leadName = (leadRow?.data as { name: string } | null)?.name ?? null

  const manualRows = (manual ?? []).map(r => ({ ...r, source: 'manual' as const }))
  const aiRows = (ai ?? []).map(r => ({
    id: r.id,
    rep_id: r.rep_id,
    lead_id: r.lead_id,
    contact_name: leadName,
    summary: (r.summary ?? null) as string | null,
    outcome: (r.outcome ?? null) as string | null,
    next_step: null as string | null,
    duration_minutes: r.duration_sec ? Math.round(r.duration_sec / 60) : null,
    occurred_at: (r.started_at ?? r.created_at) as string,
    created_at: r.created_at as string,
    source: 'ai' as const,
    recording_url: (r.recording_url ?? null) as string | null,
    transcript: (r.transcript ?? null) as string | null,
    dialer_mode: (r.dialer_mode ?? null) as string | null,
    to_number: (r.to_number ?? null) as string | null,
  }))

  return [...manualRows, ...aiRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export async function getLeadTasks(repId: string, leadId: string) {
  const { data } = await supabase.from('brain_items').select('*').eq('rep_id', repId).eq('lead_id', leadId).order('created_at', { ascending: false })
  return data ?? []
}

export type SmsMessage = {
  id: string
  lead_id: string | null
  direction: 'inbound' | 'outbound'
  body: string
  from_phone: string
  to_phone: string
  status: string
  is_ai_reply: boolean
  created_at: string
}

export async function getLeadSmsMessages(repId: string, leadId: string): Promise<SmsMessage[]> {
  const { data } = await supabase
    .from('sms_messages')
    .select('id, lead_id, direction, body, from_phone, to_phone, status, is_ai_reply, created_at')
    .eq('rep_id', repId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(200)
  return (data ?? []) as SmsMessage[]
}

export type SmsConversation = {
  lead_id: string
  lead_name: string
  lead_phone: string | null
  lead_disposition: string | null
  last_body: string
  last_direction: 'inbound' | 'outbound'
  last_at: string
  session_state: string | null
  ai_paused: boolean
}

export async function listSmsConversations(repId: string): Promise<SmsConversation[]> {
  const { data: recentMessages } = await supabase
    .from('sms_messages')
    .select('id, lead_id, body, direction, created_at')
    .eq('rep_id', repId)
    .not('lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (!recentMessages?.length) return []

  // Deduplicate: first occurrence per lead_id = most recent message
  const convMap = new Map<string, { lead_id: string; body: string; direction: string; created_at: string }>()
  for (const m of recentMessages) {
    if (m.lead_id && !convMap.has(m.lead_id)) convMap.set(m.lead_id, m)
  }
  const leadIds = Array.from(convMap.keys())

  const [leadsRes, sessionsRes] = await Promise.all([
    supabase.from('leads').select('id, name, phone, disposition').in('id', leadIds),
    supabase.from('sms_ai_sessions').select('lead_id, state, ai_paused').eq('rep_id', repId).in('lead_id', leadIds),
  ])

  const leadById = new Map((leadsRes.data ?? []).map(l => [l.id, l]))
  const sessionByLead = new Map((sessionsRes.data ?? []).map(s => [s.lead_id, s]))

  return leadIds
    .map(leadId => {
      const msg = convMap.get(leadId)!
      const lead = leadById.get(leadId)
      const session = sessionByLead.get(leadId)
      if (!lead) return null
      return {
        lead_id: leadId,
        lead_name: (lead.name as string) ?? 'Unknown',
        lead_phone: (lead.phone as string | null) ?? null,
        lead_disposition: (lead.disposition as string | null) ?? null,
        last_body: msg.body as string,
        last_direction: msg.direction as 'inbound' | 'outbound',
        last_at: msg.created_at as string,
        session_state: session ? (session.state as string) : null,
        ai_paused: session ? Boolean(session.ai_paused) : false,
      }
    })
    .filter(Boolean) as SmsConversation[]
}

// ── Unified activity model ─────────────────────────────────────────────────────
// One normalized timeline read across every source, and one routed writer. This
// is the reusable "prospect activity" puzzle-piece: consumers (and future client
// builds) deal with a single Activity[] shape and a single logActivity() entry.
//
// Read sources, normalized into Activity:
//   lead_activities (note/email/visit/meeting/task/other) — the open-ended store
//   call_logs (manual call) + voice_calls (ai call)       — kept for commissions
//   sms_messages (sms) · lead_events (disposition)        — owned by other systems
// Write routing in logActivity():
//   call  → call_logs (feeds commission/reporting)
//   email/visit/meeting/note/task/other → lead_activities

export async function getLeadActivities(repId: string, leadId: string): Promise<Activity[]> {
  const [extraRes, notes, calls, sms, events, tasks] = await Promise.all([
    supabase
      .from('lead_activities')
      .select('*, author:members(display_name)')
      .eq('rep_id', repId)
      .eq('lead_id', leadId)
      .order('occurred_at', { ascending: false }),
    getLeadNotes(repId, leadId),
    getLeadCallLogs(repId, leadId),
    getLeadSmsMessages(repId, leadId),
    getLeadEvents(repId, leadId),
    getLeadTasks(repId, leadId),
  ])

  const out: Activity[] = []

  for (const n of notes) {
    out.push({
      id: n.id,
      type: 'note',
      body: n.content,
      occurred_at: n.created_at,
      author_name: n.author?.display_name ?? null,
      source: 'manual',
      payload: {},
    })
  }

  for (const t of tasks as Array<Record<string, unknown>>) {
    out.push({
      id: t.id as string,
      type: 'task',
      body: (t.content as string | null) ?? null,
      occurred_at: t.created_at as string,
      author_name: null,
      source: 'manual',
      payload: {
        item_type: (t.item_type as string | null) ?? null,
        priority: (t.priority as string | null) ?? null,
        status: (t.status as string | null) ?? null,
        due_date: (t.due_date as string | null) ?? null,
      },
    })
  }

  for (const r of (extraRes.data ?? []) as Array<Record<string, unknown> & { author?: { display_name?: string } | null }>) {
    out.push({
      id: r.id as string,
      type: r.type as ActivityType,
      body: (r.body as string | null) ?? null,
      occurred_at: (r.occurred_at as string) ?? (r.created_at as string),
      author_name: r.author?.display_name ?? null,
      source: (r.source as 'manual' | 'ai' | 'sync') ?? 'manual',
      payload: (r.payload as Activity['payload']) ?? {},
    })
  }

  for (const c of calls) {
    const isAi = (c as { source?: string }).source === 'ai'
    out.push({
      id: c.id,
      type: 'call',
      body: c.summary ?? null,
      occurred_at: c.created_at,
      author_name: null,
      source: isAi ? 'ai' : 'manual',
      payload: {
        outcome: c.outcome ?? null,
        duration_minutes: c.duration_minutes ?? null,
        next_step: c.next_step ?? null,
        recording_url: (c as { recording_url?: string | null }).recording_url ?? null,
        transcript: (c as { transcript?: string | null }).transcript ?? null,
        dialer_mode: (c as { dialer_mode?: string | null }).dialer_mode ?? null,
      },
    })
  }

  for (const m of sms) {
    out.push({
      id: m.id,
      type: 'sms',
      body: m.body,
      occurred_at: m.created_at,
      author_name: m.is_ai_reply ? 'AI' : null,
      source: m.is_ai_reply ? 'ai' : (m.direction === 'outbound' ? 'manual' : 'sync'),
      payload: { direction: m.direction },
    })
  }

  for (const ev of events) {
    out.push({
      id: ev.id,
      type: 'disposition',
      body: ev.event_label,
      occurred_at: ev.created_at,
      author_name: null,
      source: 'manual',
      payload: { from_disposition: ev.from_disposition, to_disposition: ev.to_disposition },
    })
  }

  return out.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
}

export type LogActivityInput = {
  type: ActivityType
  body?: string | null
  occurredAt?: string
  authorMemberId?: string | null
  contactName?: string | null   // for call routing into call_logs
  payload?: Activity['payload']
}

export async function logActivity(repId: string, leadId: string, input: LogActivityInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date().toISOString()

  // Calls keep feeding call_logs so commission/reporting stays intact.
  if (input.type === 'call') {
    const p = input.payload ?? {}
    await logCall({
      repId,
      leadId,
      contactName: input.contactName ?? 'Unknown',
      summary: input.body ?? '',
      outcome: (p.outcome as never) ?? null,
      nextStep: (p.next_step as string | null) ?? null,
      durationMinutes: (p.duration_minutes as number | null) ?? null,
      occurredAt,
      ownerMemberId: input.authorMemberId ?? null,
    })
  } else if (input.type === 'note') {
    // Notes keep their dedicated table (existing /notes endpoint + history).
    await addLeadNote(repId, leadId, input.body ?? '', input.authorMemberId ?? undefined)
  } else {
    await supabase.from('lead_activities').insert({
      rep_id: repId,
      lead_id: leadId,
      type: input.type,
      body: input.body ?? null,
      occurred_at: occurredAt,
      author_member_id: input.authorMemberId ?? null,
      payload: input.payload ?? {},
      source: 'manual',
    })
  }

  // Any manual log counts as contact.
  await supabase.from('leads')
    .update({ last_contacted_at: occurredAt })
    .eq('id', leadId).eq('rep_id', repId)
}
