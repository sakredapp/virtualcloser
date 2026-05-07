// Bulk lead import for the Appointment Setter.
//
// POST flow:
//   1. Resolve target AI Salesperson
//   2. Normalize + validate phones
//   3. Full dedup:
//      a. Same-setter pending queue (silent drop — true duplicates)
//      b. Other-setter queue conflicts (preview/confirm gate)
//   4. Create import_batches record
//   5. Upsert leads rows (reuse existing lead if phone already in leads table)
//   6. If start_immediately=true (default), insert dialer_queue rows + set batch active
//   7. Return counts + completion estimate
//
// GET: queue counts summary

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { makeAgentCRMForRep } from '@/lib/agentcrm'
import {
  getOrCreateDefaultSalesperson,
  getSalespersonForRep,
  checkLeadConflicts,
  checkSameSetterDuplicates,
  getExistingLeadsByPhone,
} from '@/lib/ai-salesperson'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LeadRow = {
  phone: string
  first_name?: string
  last_name?: string
  name?: string
  email?: string
  company?: string
  notes?: string
  scheduled_for?: string | null
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? raw.trim() : `+${digits}`
}

function isValidPhone(normalized: string): boolean {
  return normalized.replace(/\D/g, '').length >= 7
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const role = ctx.member.role as string
  if (!['owner', 'admin', 'manager', 'rep'].includes(role) && ctx.tenant.tier !== 'individual') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let body: {
    leads: LeadRow[]
    workflow_rule_id?: string | null
    ai_salesperson_id?: string | null
    confirm_conflicts?: boolean
    start_immediately?: boolean
    file_name?: string | null
    vendor_name?: string | null
    cost_per_lead?: number | null
    compliance?: { opt_in?: boolean; california_ai_disclosure?: boolean }
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const leads = body.leads
  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_leads' }, { status: 400 })
  }
  if (leads.length > 5000) {
    return NextResponse.json({ ok: false, error: 'max_5000_leads_per_batch' }, { status: 400 })
  }

  // Default start_immediately=true preserves backward-compat with existing UI.
  const startImmediately = body.start_immediately !== false

  // ── Resolve target salesperson ────────────────────────────────────────────
  let setter: Awaited<ReturnType<typeof getSalespersonForRep>>
  try {
    if (body.ai_salesperson_id) {
      const found = await getSalespersonForRep(ctx.tenant.id, body.ai_salesperson_id)
      if (!found) return NextResponse.json({ ok: false, error: 'setter_not_found' }, { status: 404 })
      setter = found
    } else {
      setter = await getOrCreateDefaultSalesperson(ctx.tenant.id)
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `setter_resolve_failed: ${(e as Error).message}` }, { status: 500 })
  }

  // ── Normalize + validate ──────────────────────────────────────────────────
  type Validated = {
    phone: string
    first_name: string | null
    last_name: string | null
    name: string | null
    email: string | null
    company: string | null
    notes: string | null
    scheduled_for: string | null
    original_index: number
  }

  const validated: Validated[] = []
  const invalidIndexes: number[] = []

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i]
    if (!l.phone || typeof l.phone !== 'string') { invalidIndexes.push(i); continue }
    const phone = normalizePhone(l.phone)
    if (!isValidPhone(phone)) { invalidIndexes.push(i); continue }
    const displayName = (l.name ?? [l.first_name, l.last_name].filter(Boolean).join(' ')) || null
    validated.push({
      phone,
      first_name: l.first_name ?? null,
      last_name: l.last_name ?? null,
      name: displayName,
      email: l.email ?? null,
      company: l.company ?? null,
      notes: l.notes ?? null,
      scheduled_for: l.scheduled_for ?? null,
      original_index: i,
    })
  }

  if (validated.length === 0) {
    return NextResponse.json({ ok: false, error: 'all_leads_invalid', skipped: invalidIndexes.length }, { status: 400 })
  }

  const allPhones = validated.map((v) => v.phone)
  const uniquePhones = Array.from(new Set(allPhones))

  // ── Dedup pass 1: same-setter pending queue (silent drop) ─────────────────
  let sameSetterDupes: Set<string>
  try {
    sameSetterDupes = await checkSameSetterDuplicates(ctx.tenant.id, uniquePhones, setter.id)
  } catch (e) {
    return NextResponse.json({ ok: false, error: `dedup_failed: ${(e as Error).message}` }, { status: 500 })
  }

  // ── Dedup pass 2: other-setter conflicts (preview/confirm gate) ───────────
  const otherSetterPhones = uniquePhones.filter((p) => !sameSetterDupes.has(p))
  let conflictPhones = new Set<string>()
  try {
    const conflicts = await checkLeadConflicts(ctx.tenant.id, otherSetterPhones, setter.id)
    if (conflicts.length > 0 && !body.confirm_conflicts) {
      return NextResponse.json({
        ok: true,
        preview: true,
        conflicts,
        message: `${conflicts.length} lead${conflicts.length === 1 ? '' : 's'} already assigned to another AI setter. Confirm to skip and import the rest.`,
      })
    }
    if (conflicts.length > 0) {
      conflictPhones = new Set(conflicts.map((c) => c.phone))
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `dedup_failed: ${(e as Error).message}` }, { status: 500 })
  }

  // Rows that will actually be imported (no same-setter dupe, no other-setter conflict)
  const toImport = validated.filter(
    (v) => !sameSetterDupes.has(v.phone) && !conflictPhones.has(v.phone),
  )

  const duplicateCount = sameSetterDupes.size + conflictPhones.size

  if (toImport.length === 0) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: invalidIndexes.length,
      duplicate_count: duplicateCount,
      message: 'All leads were duplicates or already assigned; nothing imported.',
    })
  }

  // ── Create import_batches record ──────────────────────────────────────────
  const { data: batchRow, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      rep_id: ctx.tenant.id,
      member_id: ctx.member.id,
      ai_salesperson_id: setter.id,
      file_name: body.file_name ?? null,
      source: 'csv',
      vendor_name: body.vendor_name ?? null,
      cost_per_lead: body.cost_per_lead ?? null,
      total_count: leads.length,
      inserted_count: 0,
      duplicate_count: duplicateCount,
      failed_count: invalidIndexes.length,
      enrolled_count: 0,
      status: startImmediately ? 'active' : 'pending',
    })
    .select('id')
    .single()

  if (batchErr || !batchRow) {
    return NextResponse.json({ ok: false, error: `batch_create_failed: ${batchErr?.message ?? 'unknown'}` }, { status: 500 })
  }
  const batchId = batchRow.id as string

  // ── Upsert leads rows ─────────────────────────────────────────────────────
  // Reuse existing lead records (matched by phone) so pipeline tracking works
  // correctly when the same contact is re-imported later.
  let existingByPhone: Map<string, string>
  try {
    existingByPhone = await getExistingLeadsByPhone(
      ctx.tenant.id,
      toImport.map((v) => v.phone),
    )
  } catch (e) {
    return NextResponse.json({ ok: false, error: `lead_lookup_failed: ${(e as Error).message}` }, { status: 500 })
  }

  // Leads that need new rows created
  const toCreate = toImport.filter((v) => !existingByPhone.has(v.phone))

  // phone → lead_id map (existing + newly created)
  const phoneToLeadId = new Map<string, string>(existingByPhone)

  // Block re-dialing of existing leads that are already converted, opted out,
  // or flagged DNC. These phones re-use an existing lead_id so they'd be
  // re-queued without this guard — leading to contacts getting called again
  // after booking or requesting removal.
  const PROTECTED_DISPOSITIONS = new Set([
    'appointment_set', 'application_sent', 'application_approved', 'aca',
    'do_not_contact', 'disqualified',
  ])
  const existingLeadIds = Array.from(existingByPhone.values())
  const dncExistingPhones = new Set<string>()
  if (existingLeadIds.length > 0) {
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('id, phone, disposition, do_not_call')
      .in('id', existingLeadIds)
    for (const lead of existingLeads ?? []) {
      const isProtected =
        (lead.do_not_call === true) ||
        (lead.disposition && PROTECTED_DISPOSITIONS.has(lead.disposition as string))
      if (isProtected && lead.phone) dncExistingPhones.add(lead.phone as string)
    }
  }

  // Insert new lead rows in chunks of 100
  let insertedLeads = 0
  for (let i = 0; i < toCreate.length; i += 100) {
    const chunk = toCreate.slice(i, i + 100)
    const { data: created, error: createErr } = await supabase
      .from('leads')
      .insert(
        chunk.map((v) => ({
          rep_id: ctx.tenant.id,
          owner_member_id: ctx.member.id,
          name: v.name || v.phone,
          email: v.email ?? null,
          company: v.company ?? null,
          notes: v.notes ?? null,
          phone: v.phone,
          status: 'cold',
          disposition: 'new',
          lead_date: new Date().toISOString(),
          source: 'csv_import',
          import_batch_id: batchId,
        })),
      )
      .select('id, phone')

    if (createErr) {
      // Non-fatal: log and continue — we still have the batch record
      console.error('[import] lead insert failed', createErr.message)
      continue
    }
    for (const row of created ?? []) {
      if (row.id && row.phone) phoneToLeadId.set(row.phone as string, row.id as string)
    }
    insertedLeads += (created ?? []).length
  }

  // ── Enroll into dialer_queue (if start_immediately) ───────────────────────
  let enrolledCount = 0
  if (startImmediately) {
    const queueRows = toImport.filter((v) => !dncExistingPhones.has(v.phone)).map((v) => ({
      rep_id: ctx.tenant.id,
      owner_member_id: ctx.member.id,
      workflow_rule_id: body.workflow_rule_id ?? null,
      ai_salesperson_id: setter.id,
      lead_id: phoneToLeadId.get(v.phone) ?? null,
      import_batch_id: batchId,
      dialer_mode: 'appointment_setter',
      status: 'pending',
      phone: v.phone,
      attempt_count: 0,
      max_attempts: 3,
      scheduled_for: v.scheduled_for ?? null,
      source_kind: 'csv',
      context: {
        first_name: v.first_name,
        last_name: v.last_name,
        name: v.name,
        email: v.email,
        company: v.company,
        notes: v.notes,
        import_batch_id: batchId,
        original_index: v.original_index,
      },
    }))

    for (let i = 0; i < queueRows.length; i += 100) {
      const chunk = queueRows.slice(i, i + 100)
      const { error } = await supabase.from('dialer_queue').insert(chunk)
      if (error) {
        console.error('[import] queue insert failed', error.message)
        continue
      }
      enrolledCount += chunk.length
    }
  }

  // Update batch with final counts
  await supabase
    .from('import_batches')
    .update({
      inserted_count: toImport.length,
      enrolled_count: enrolledCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  // ── Completion estimate ───────────────────────────────────────────────────
  const leadsPerDay = setter.schedule?.leads_per_day ?? setter.schedule?.max_calls_per_day ?? 120
  const estimatedDays = Math.ceil(enrolledCount / leadsPerDay)
  const estimatedCompletionDate = new Date(Date.now() + estimatedDays * 86_400_000)
    .toISOString()
    .slice(0, 10)

  // ── Fire-and-forget: GHL contact upsert for new leads ────────────────────
  void (async () => {
    try {
      const crm = await makeAgentCRMForRep(ctx.tenant.id)
      if (!crm) return
      for (const v of toCreate) {
        if (!v.phone && !v.email) continue
        const [fn, ...rest] = (v.name ?? '').split(' ')
        try {
          await crm.upsertContact({
            firstName: fn ?? '',
            lastName: rest.join(' ') || undefined,
            email: v.email ?? undefined,
            phone: v.phone,
            companyName: v.company ?? undefined,
            tags: ['vc-appointment-setter'],
          })
        } catch {
          // individual contact failure never blocks import
        }
      }
    } catch {
      // GHL sync failure never blocks import
    }
  })()

  return NextResponse.json({
    ok: true,
    inserted: toImport.length,
    skipped: invalidIndexes.length,
    duplicate_count: duplicateCount,
    enrolled: enrolledCount,
    start_immediately: startImmediately,
    batch_id: batchId,
    ai_salesperson_id: setter.id,
    estimate: startImmediately
      ? {
          leads_per_day: leadsPerDay,
          estimated_days: estimatedDays,
          estimated_completion_date: estimatedCompletionDate,
        }
      : null,
  })
}

// GET: queue counts + pending batches summary
export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const [{ data: rows }, { data: batches }] = await Promise.all([
    supabase
      .from('dialer_queue')
      .select('status, attempt_count, last_outcome')
      .eq('rep_id', ctx.tenant.id)
      .eq('dialer_mode', 'appointment_setter'),
    supabase
      .from('import_batches')
      .select('id, file_name, status, inserted_count, enrolled_count, duplicate_count, created_at, ai_salesperson_id')
      .eq('rep_id', ctx.tenant.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const counts = {
    pending:          (rows ?? []).filter((r) => r.status === 'pending').length,
    in_progress:      (rows ?? []).filter((r) => r.status === 'in_progress').length,
    completed:        (rows ?? []).filter((r) => r.status === 'completed').length,
    failed:           (rows ?? []).filter((r) => r.status === 'failed').length,
    cancelled:        (rows ?? []).filter((r) => r.status === 'cancelled').length,
    appointments_set: (rows ?? []).filter((r) => r.last_outcome === 'confirmed').length,
  }

  return NextResponse.json({ ok: true, counts, batches: batches ?? [] })
}
