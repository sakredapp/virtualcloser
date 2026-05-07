// lib/ai-salesperson.ts
//
// CRUD + helpers for the multi-setter "AI Salesperson" model.
// See spec: BLUEPRINT.md (or developer handoff) and supabase/ai_salesperson_migration.sql.
//
// Back-compat: when a rep has no salesperson rows yet, the legacy
// `client_integrations.appointment_setter_config` JSONB row is migrated
// lazily into a single "Default Salesperson" via getOrCreateDefaultSalesperson().

import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { DEFAULT_APPT_SETTER_CONFIG } from '@/lib/appointment-setter-config'
import type {
  AiSalesperson,
  AiSalespersonInput,
  AiSalespersonLeadConflict,
  AppointmentSetterConfig,
} from '@/types'

// ── Shape helpers ─────────────────────────────────────────────────────────

function emptySalespersonShape(name: string): Omit<AiSalesperson, 'id' | 'rep_id' | 'created_at' | 'updated_at'> {
  return {
    name,
    status: 'draft',
    product_category: null,
    assigned_member_id: null,
    appointment_type: 'phone',
    appointment_duration_min: 30,
    product_intent: {},
    voice_persona: {},
    call_script: {},
    sms_scripts: {},
    email_templates: {},
    objection_responses: [],
    schedule: {},
    calendar: {},
    crm_push: { provider: 'ghl' },
    phone_number: null,
    phone_provider: null,
    sms_ai_enabled: false,
    sms_daily_cap: 50,
    created_by_member_id: null,
    archived_at: null,
  }
}

function rowToSalesperson(row: Record<string, unknown>): AiSalesperson {
  return {
    id: String(row.id),
    rep_id: String(row.rep_id),
    name: String(row.name ?? ''),
    status: (row.status as AiSalesperson['status']) ?? 'draft',
    product_category: (row.product_category as string | null) ?? null,
    assigned_member_id: (row.assigned_member_id as string | null) ?? null,
    appointment_type: (row.appointment_type as string | null) ?? 'phone',
    appointment_duration_min: (row.appointment_duration_min as number | null) ?? 30,
    product_intent: (row.product_intent as AiSalesperson['product_intent']) ?? {},
    voice_persona: (row.voice_persona as AiSalesperson['voice_persona']) ?? {},
    call_script: (row.call_script as AiSalesperson['call_script']) ?? {},
    sms_scripts: (row.sms_scripts as AiSalesperson['sms_scripts']) ?? {},
    email_templates: (row.email_templates as AiSalesperson['email_templates']) ?? {},
    objection_responses: (row.objection_responses as AiSalesperson['objection_responses']) ?? [],
    schedule: (row.schedule as AiSalesperson['schedule']) ?? {},
    calendar: (row.calendar as AiSalesperson['calendar']) ?? {},
    crm_push: (row.crm_push as AiSalesperson['crm_push']) ?? {},
    phone_number: (row.phone_number as string | null) ?? null,
    phone_provider: (row.phone_provider as AiSalesperson['phone_provider']) ?? null,
    sms_ai_enabled: (row.sms_ai_enabled as boolean) ?? false,
    sms_daily_cap: (row.sms_daily_cap as number) ?? 50,
    created_by_member_id: (row.created_by_member_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    archived_at: (row.archived_at as string | null) ?? null,
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function listSalespeople(repId: string, opts?: { includeArchived?: boolean; memberIds?: string[] | null }): Promise<AiSalesperson[]> {
  let q = supabase.from('ai_salespeople').select('*').eq('rep_id', repId)
  if (!opts?.includeArchived) q = q.is('archived_at', null)
  if (opts?.memberIds != null) q = q.in('assigned_member_id', opts.memberIds)
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToSalesperson)
}

export async function getSalesperson(id: string): Promise<AiSalesperson | null> {
  const { data, error } = await supabase.from('ai_salespeople').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? rowToSalesperson(data) : null
}

export async function getSalespersonForRep(repId: string, id: string): Promise<AiSalesperson | null> {
  const { data, error } = await supabase
    .from('ai_salespeople')
    .select('*')
    .eq('rep_id', repId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? rowToSalesperson(data) : null
}

export async function createSalesperson(
  repId: string,
  input: AiSalespersonInput,
  createdByMemberId?: string | null,
): Promise<AiSalesperson> {
  const base = emptySalespersonShape(input.name)
  const merged = { ...base, ...input, name: input.name }
  const insert = {
    rep_id: repId,
    name: merged.name,
    status: merged.status ?? 'draft',
    product_category: merged.product_category ?? null,
    assigned_member_id: merged.assigned_member_id ?? null,
    appointment_type: merged.appointment_type ?? 'phone',
    appointment_duration_min: merged.appointment_duration_min ?? 30,
    product_intent: merged.product_intent ?? {},
    voice_persona: merged.voice_persona ?? {},
    call_script: merged.call_script ?? {},
    sms_scripts: merged.sms_scripts ?? {},
    email_templates: merged.email_templates ?? {},
    objection_responses: merged.objection_responses ?? [],
    schedule: merged.schedule ?? {},
    calendar: merged.calendar ?? {},
    crm_push: merged.crm_push ?? { provider: 'ghl' },
    phone_number: merged.phone_number ?? null,
    phone_provider: merged.phone_provider ?? null,
    sms_ai_enabled: merged.sms_ai_enabled ?? false,
    sms_daily_cap: merged.sms_daily_cap ?? 50,
    created_by_member_id: createdByMemberId ?? null,
  }
  const { data, error } = await supabase.from('ai_salespeople').insert(insert).select('*').single()
  if (error) throw error
  return rowToSalesperson(data)
}

export async function updateSalesperson(
  repId: string,
  id: string,
  patch: Partial<AiSalespersonInput>,
): Promise<AiSalesperson> {
  // Strip immutable / derived fields
  const allowed: Record<string, unknown> = {}
  const fields: (keyof AiSalespersonInput)[] = [
    'name', 'status', 'product_category', 'assigned_member_id', 'appointment_type',
    'appointment_duration_min', 'product_intent', 'voice_persona', 'call_script',
    'sms_scripts', 'email_templates', 'objection_responses', 'schedule', 'calendar',
    'crm_push', 'phone_number', 'phone_provider', 'sms_ai_enabled', 'sms_daily_cap',
  ]
  for (const f of fields) {
    if (f in patch) allowed[f as string] = patch[f]
  }
  const { data, error } = await supabase
    .from('ai_salespeople')
    .update(allowed)
    .eq('id', id)
    .eq('rep_id', repId)
    .select('*')
    .single()
  if (error) throw error
  return rowToSalesperson(data)
}

export async function archiveSalesperson(repId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('ai_salespeople')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('rep_id', repId)
  if (error) throw error
}

export async function setStatus(repId: string, id: string, status: AiSalesperson['status']): Promise<AiSalesperson> {
  const patch: Record<string, unknown> = { status }
  if (status === 'archived') patch.archived_at = new Date().toISOString()
  if (status !== 'archived') patch.archived_at = null
  const { data, error } = await supabase
    .from('ai_salespeople')
    .update(patch)
    .eq('id', id)
    .eq('rep_id', repId)
    .select('*')
    .single()
  if (error) throw error
  return rowToSalesperson(data)
}

export async function duplicateSalesperson(repId: string, id: string): Promise<AiSalesperson> {
  const src = await getSalespersonForRep(repId, id)
  if (!src) throw new Error('not_found')
  const copy: AiSalespersonInput = {
    name: `${src.name} (Copy)`,
    status: 'draft',
    product_category: src.product_category,
    assigned_member_id: src.assigned_member_id,
    appointment_type: src.appointment_type,
    appointment_duration_min: src.appointment_duration_min,
    product_intent: src.product_intent,
    voice_persona: src.voice_persona,
    call_script: src.call_script,
    sms_scripts: src.sms_scripts,
    email_templates: src.email_templates,
    objection_responses: src.objection_responses,
    schedule: src.schedule,
    calendar: src.calendar,
    crm_push: src.crm_push,
    phone_number: src.phone_number,
    phone_provider: src.phone_provider,
  }
  return createSalesperson(repId, copy)
}

// ── Default-setter shim (legacy migration) ────────────────────────────────
// Reads the rep's old `client_integrations.appointment_setter_config` row and
// inserts it as the rep's first salesperson. Subsequent calls return the
// existing default. Idempotent.

const DEFAULT_NAME = 'Default Salesperson'

export async function getOrCreateDefaultSalesperson(repId: string): Promise<AiSalesperson> {
  const existing = await listSalespeople(repId)
  if (existing.length > 0) return existing[0]

  const legacy = (await getIntegrationConfig(repId, 'appointment_setter_config')) as Partial<AppointmentSetterConfig> | null
  const cfg: AppointmentSetterConfig = { ...DEFAULT_APPT_SETTER_CONFIG, ...(legacy ?? {}) }

  const input: AiSalespersonInput = {
    name: cfg.ai_name ? `${cfg.ai_name}` : DEFAULT_NAME,
    status: cfg.enabled ? 'active' : 'draft',
    product_category: null,
    voice_persona: {
      ai_name: cfg.ai_name,
      role_title: cfg.role_title,
      opener: cfg.opener,
    },
    call_script: {
      opening: cfg.opener,
      qualifying: cfg.qualification_questions
        ? cfg.qualification_questions.split('\n').map((s) => s.trim()).filter(Boolean)
        : [],
      escalation_rules: cfg.disqualify_rules,
    },
    objection_responses: cfg.objections
      ? cfg.objections
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((line) => {
            const [trigger, ...rest] = line.split('=>')
            return { trigger: (trigger ?? '').trim(), response: rest.join('=>').trim() }
          })
          .filter((o) => o.trigger || o.response)
      : [],
    schedule: {
      active_days: cfg.active_days,
      start_hour: cfg.start_hour,
      end_hour: cfg.end_hour,
      timezone: cfg.timezone,
      max_calls_per_day: cfg.max_daily_dials,
      leads_per_hour: cfg.leads_per_hour,
      leads_per_day: cfg.leads_per_day,
      max_daily_hours: cfg.max_daily_hours,
    },
    calendar: {
      provider: cfg.ghl_calendar_id ? 'ghl' : (cfg.booking_calendar_url ? 'manual' : undefined),
      calendar_id: cfg.ghl_calendar_id || undefined,
      calendar_url: cfg.booking_calendar_url || undefined,
    },
    crm_push: { provider: 'ghl' },
  }

  return createSalesperson(repId, input)
}

// ── Outbound number resolver (locked decision #2) ─────────────────────────
// Same number is used for SMS and voice. Provider-agnostic: setter override →
// rep RevRing → rep Twilio → null. Final RevRing wiring deferred but signature
// is stable.

export type OutboundNumberResolution = {
  number: string | null
  provider: 'revring' | 'twilio' | null
  source: 'setter_override' | 'rep_revring' | 'rep_twilio' | 'none'
}

export async function resolveOutboundNumber(setter: AiSalesperson | null, repId: string): Promise<OutboundNumberResolution> {
  if (setter?.phone_number) {
    return { number: setter.phone_number, provider: setter.phone_provider ?? null, source: 'setter_override' }
  }
  // Rep-level RevRing
  const rev = (await getIntegrationConfig(repId, 'revring')) as Record<string, unknown> | null
  const revPhone = typeof rev?.phone_number === 'string' ? (rev.phone_number as string) : null
  if (revPhone) return { number: revPhone, provider: 'revring', source: 'rep_revring' }
  // Rep-level Twilio
  const tw = (await getIntegrationConfig(repId, 'twilio')) as Record<string, unknown> | null
  const twPhone = typeof tw?.phone_number === 'string' ? (tw.phone_number as string) : null
  if (twPhone) return { number: twPhone, provider: 'twilio', source: 'rep_twilio' }
  return { number: null, provider: null, source: 'none' }
}

// ── Lead dedup (locked decision #3) ───────────────────────────────────────
// Returns conflicts: phones already claimed by ANOTHER setter under the same
// rep_id. Caller decides whether to skip, abort, or override.

export async function checkLeadConflicts(
  repId: string,
  phones: string[],
  excludeSetterId?: string | null,
): Promise<AiSalespersonLeadConflict[]> {
  if (phones.length === 0) return []
  // Only active queue rows constitute a real conflict. Completed/failed/cancelled
  // rows from prior campaigns should not block re-import to a new setter.
  const { data, error } = await supabase
    .from('dialer_queue')
    .select('phone, ai_salesperson_id, lead_id')
    .eq('rep_id', repId)
    .in('phone', phones)
    .in('status', ['pending', 'in_progress'])
    .not('ai_salesperson_id', 'is', null)
  if (error) throw error
  const rows = (data ?? []) as Array<{ phone: string; ai_salesperson_id: string; lead_id: string | null }>
  const filtered = excludeSetterId
    ? rows.filter((r) => r.ai_salesperson_id !== excludeSetterId)
    : rows

  if (filtered.length === 0) return []

  // Lookup setter names
  const setterIds = Array.from(new Set(filtered.map((r) => r.ai_salesperson_id)))
  const { data: setters } = await supabase
    .from('ai_salespeople')
    .select('id, name')
    .in('id', setterIds)
  const nameById = new Map<string, string>((setters ?? []).map((s: { id: string; name: string }) => [s.id, s.name]))

  // One conflict per phone (first match wins)
  const seen = new Set<string>()
  const out: AiSalespersonLeadConflict[] = []
  for (const r of filtered) {
    if (seen.has(r.phone)) continue
    seen.add(r.phone)
    out.push({
      phone: r.phone,
      existing_setter_id: r.ai_salesperson_id,
      existing_setter_name: nameById.get(r.ai_salesperson_id) ?? 'Unknown',
      existing_lead_id: r.lead_id,
    })
  }
  return out
}

// Returns phones that already have a pending/in_progress queue row for this
// specific setter — true duplicates the caller should silently drop.
export async function checkSameSetterDuplicates(
  repId: string,
  phones: string[],
  setterId: string,
): Promise<Set<string>> {
  if (phones.length === 0) return new Set()
  const { data } = await supabase
    .from('dialer_queue')
    .select('phone')
    .eq('rep_id', repId)
    .eq('ai_salesperson_id', setterId)
    .in('status', ['pending', 'in_progress'])
    .in('phone', phones)
  const dupes = new Set<string>()
  for (const r of data ?? []) {
    if (r.phone) dupes.add(r.phone as string)
  }
  return dupes
}

// Returns phones that already have a lead record for this rep.
// Used by bulk import to upsert rather than double-create.
// Returns a map of phone → lead_id for reuse.
export async function getExistingLeadsByPhone(
  repId: string,
  phones: string[],
): Promise<Map<string, string>> {
  if (phones.length === 0) return new Map()
  const { data } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('rep_id', repId)
    .in('phone', phones)
    .not('phone', 'is', null)
  const map = new Map<string, string>()
  for (const r of data ?? []) {
    if (r.phone && r.id) map.set(r.phone as string, r.id as string)
  }
  return map
}
