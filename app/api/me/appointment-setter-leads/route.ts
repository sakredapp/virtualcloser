// Bulk lead import for the Appointment Setter.
// POST: accepts an array of leads and inserts them into dialer_queue as
// appointment_setter mode items. Also fire-and-forget upserts each lead
// as a GHL contact when the tenant has GHL configured.
//
// Expects JSON body: { leads: LeadRow[] }
// Each LeadRow must have `phone` + at least one name/email field.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { makeAgentCRMForRep } from '@/lib/agentcrm'

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
  // optional scheduling override
  scheduled_for?: string | null
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? raw.trim() : `+${digits}`
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

  let body: { leads: LeadRow[]; workflow_rule_id?: string | null }
  try {
    body = (await req.json()) as { leads: LeadRow[]; workflow_rule_id?: string | null }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const leads = body.leads
  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_leads' }, { status: 400 })
  }
  if (leads.length > 500) {
    return NextResponse.json({ ok: false, error: 'max_500_leads_per_import' }, { status: 400 })
  }

  const rows: Record<string, unknown>[] = []
  const skipped: number[] = []

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i]
    if (!l.phone || typeof l.phone !== 'string') {
      skipped.push(i)
      continue
    }
    const phone = normalizePhone(l.phone)
    if (phone.replace(/\D/g, '').length < 7) {
      skipped.push(i)
      continue
    }

    const displayName = l.name ?? [l.first_name, l.last_name].filter(Boolean).join(' ') ?? null

    rows.push({
      rep_id: ctx.tenant.id,
      owner_member_id: ctx.member.id,
      workflow_rule_id: body.workflow_rule_id ?? null,
      dialer_mode: 'appointment_setter',
      status: 'pending',
      phone,
      attempt_count: 0,
      max_attempts: 3,
      scheduled_for: l.scheduled_for ?? null,
      context: {
        first_name: l.first_name ?? null,
        last_name: l.last_name ?? null,
        name: displayName,
        email: l.email ?? null,
        company: l.company ?? null,
        notes: l.notes ?? null,
        import_index: i,
      },
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'all_leads_invalid',
      skipped: skipped.length,
    }, { status: 400 })
  }

  // Insert in batches of 100 to avoid Supabase payload limits
  let inserted = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const { error } = await supabase.from('dialer_queue').insert(batch)
    if (error) {
      return NextResponse.json({
        ok: false,
        error: `db_insert_failed: ${error.message}`,
        inserted,
        skipped: skipped.length,
      }, { status: 500 })
    }
    inserted += batch.length
  }

  // Write a single import event on the first inserted row for audit trail
  // (we don't have a dedicated import table yet, so log to queue_events)
  const { data: firstRow } = await supabase
    .from('dialer_queue')
    .select('id')
    .eq('rep_id', ctx.tenant.id)
    .eq('dialer_mode', 'appointment_setter')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (firstRow) {
    await supabase.from('dialer_queue_events').insert({
      rep_id: ctx.tenant.id,
      queue_id: firstRow.id,
      event_type: 'bulk_import',
      payload: { count: inserted, skipped: skipped.length, imported_by: ctx.member.id },
    })
  }

  // Fire-and-forget: upsert leads as GHL contacts
  void (async () => {
    try {
      const crm = await makeAgentCRMForRep(ctx.tenant.id)
      if (!crm) return
      for (const lead of leads) {
        if (!lead.phone && !lead.email) continue
        const name = lead.name ?? [lead.first_name, lead.last_name].filter(Boolean).join(' ') ?? ''
        const [fn, ...rest] = name.split(' ')
        try {
          await crm.upsertContact({
            firstName: fn ?? '',
            lastName: rest.join(' ') || undefined,
            email: lead.email,
            phone: normalizePhone(lead.phone),
            companyName: lead.company,
            tags: ['vc-appointment-setter'],
          })
        } catch {
          // individual contact failure doesn't block the import
        }
      }
    } catch {
      // GHL sync failure never blocks lead import
    }
  })()

  return NextResponse.json({ ok: true, inserted, skipped: skipped.length })
}

// GET: returns summary counts for appointment_setter queue
export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: rows } = await supabase
    .from('dialer_queue')
    .select('status, attempt_count, last_outcome')
    .eq('rep_id', ctx.tenant.id)
    .eq('dialer_mode', 'appointment_setter')

  const counts = {
    pending:    (rows ?? []).filter((r) => r.status === 'pending').length,
    in_progress:(rows ?? []).filter((r) => r.status === 'in_progress').length,
    completed:  (rows ?? []).filter((r) => r.status === 'completed').length,
    failed:     (rows ?? []).filter((r) => r.status === 'failed').length,
    cancelled:  (rows ?? []).filter((r) => r.status === 'cancelled').length,
    appointments_set: (rows ?? []).filter((r) => r.last_outcome === 'confirmed').length,
  }

  return NextResponse.json({ ok: true, counts })
}
