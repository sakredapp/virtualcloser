import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getFurnaceConfig } from '@/lib/furnace'
import { listSalespeople } from '@/lib/ai-salesperson'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type FurnaceLeadPayload = {
  furnace_lead_id: string
  client_id?: string
  full_name?: string
  email?: string
  phone?: string
  source?: string
  campaign_id?: string
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params

  // Verify shared secret. Use timing-safe compare to prevent timing attacks.
  const incomingSecret = req.headers.get('x-furnace-secret') ?? ''
  const expectedSecret = process.env.FURNACE_INBOUND_SECRET ?? ''
  if (!expectedSecret || !incomingSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const a = Buffer.from(incomingSecret)
    const b = Buffer.from(expectedSecret)
    // timingSafeEqual requires same length — if lengths differ the secret is wrong
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Verify this rep is tagged as a Furnace client
  const furnaceConfig = await getFurnaceConfig(repId)
  if (!furnaceConfig) {
    return NextResponse.json({ error: 'not_a_furnace_client' }, { status: 403 })
  }

  let body: FurnaceLeadPayload
  try {
    body = (await req.json()) as FurnaceLeadPayload
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  if (!body.furnace_lead_id || !body.phone) {
    return NextResponse.json({ error: 'furnace_lead_id and phone are required' }, { status: 400 })
  }

  const phone = normalizePhone(body.phone)
  const name = body.full_name ?? phone

  // Upsert lead — dedup by phone for this rep
  const { data: existing } = await supabase
    .from('leads')
    .select('id, external_id, source')
    .eq('rep_id', repId)
    .eq('phone', phone)
    .maybeSingle()

  let leadId: string

  if (existing) {
    // Stamp furnace_lead_id if not already set
    if (!existing.external_id || existing.source !== 'furnace') {
      await supabase
        .from('leads')
        .update({ external_id: body.furnace_lead_id, source: 'furnace' })
        .eq('id', existing.id)
    }
    leadId = existing.id as string
  } else {
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        rep_id: repId,
        name,
        email: body.email ?? null,
        phone,
        source: 'furnace',
        external_id: body.furnace_lead_id,
        status: 'cold',
        disposition: 'new',
        lead_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single()

    if (error || !newLead) {
      console.error('[furnace] lead insert failed', error)
      return NextResponse.json({ error: 'lead_insert_failed' }, { status: 500 })
    }
    leadId = newLead.id as string
  }

  // Auto-queue for the active AI SDR if one is configured — fire and forget
  void (async () => {
    try {
      const salespeople = await listSalespeople(repId, { includeArchived: false })
      const activeSetter = salespeople.find((s) => s.status === 'active')
      if (!activeSetter) return

      // Don't queue if already pending/in-progress for this lead
      const { count } = await supabase
        .from('dialer_queue')
        .select('id', { count: 'exact', head: true })
        .eq('rep_id', repId)
        .eq('lead_id', leadId)
        .in('status', ['pending', 'in_progress'])

      if ((count ?? 0) > 0) return

      await supabase.from('dialer_queue').insert({
        rep_id: repId,
        lead_id: leadId,
        phone,
        dialer_mode: 'appointment_setter',
        ai_salesperson_id: activeSetter.id,
        status: 'pending',
        attempt_count: 0,
        max_attempts: activeSetter.schedule?.max_attempts_per_lead ?? 3,
        context: {
          name,
          email: body.email ?? null,
          source: 'furnace',
          campaign_id: body.campaign_id ?? null,
          furnace_lead_id: body.furnace_lead_id,
        },
      })
    } catch (err) {
      console.error('[furnace] auto-queue failed', err)
    }
  })()

  return NextResponse.json({ ok: true, lead_id: leadId })
}
