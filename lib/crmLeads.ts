import { supabase } from './supabase'
import { pushLeadDispositionToFurnace } from './furnace'
import type { CrmLead, Disposition, LeadNote, LeadEvent } from '@/types'

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
  const [{ data: manual }, { data: ai }] = await Promise.all([
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
  ])

  const manualRows = (manual ?? []).map(r => ({ ...r, source: 'manual' as const }))
  const aiRows = (ai ?? []).map(r => ({
    id: r.id,
    rep_id: r.rep_id,
    lead_id: r.lead_id,
    contact_name: null as string | null,
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
