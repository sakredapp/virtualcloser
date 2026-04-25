import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type Body = {
  name?: string
  email?: string
  company?: string
  notes?: string
  status?: 'hot' | 'warm' | 'cold' | 'dormant'
  source?: string
  external_id?: string
  last_contact?: string
}

/**
 * Inbound webhook for Zapier (or any external CRM). Team Builder tier and up.
 *
 * Auth: caller passes ?key=XXX, where XXX matches reps.integrations.zapier_key
 * (generated on the client's /dashboard/integrations page).
 *
 * POST body: { name, email, company, notes, status?, source?, external_id?, last_contact? }
 * Behaviour: upsert into leads (matched on rep_id + email when provided, else
 * external_id, else create new).
 */
export async function POST(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')?.trim()
  if (!key) return NextResponse.json({ error: 'missing key' }, { status: 401 })

  // Look up tenant by key stored in jsonb integrations column.
  const { data: rep, error: repErr } = await supabase
    .from('reps')
    .select('id, tier, is_active, integrations')
    .eq('integrations->>zapier_key', key)
    .maybeSingle()

  if (repErr) return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  if (!rep || !rep.is_active) {
    return NextResponse.json({ error: 'invalid key' }, { status: 401 })
  }
  if (rep.tier === 'salesperson') {
    return NextResponse.json(
      { error: 'integrations require Team Builder tier or higher' },
      { status: 403 },
    )
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase() || null
  if (!name && !email) {
    return NextResponse.json({ error: 'name or email required' }, { status: 400 })
  }

  const row = {
    rep_id: rep.id,
    name: name || email || 'Unknown',
    email,
    company: body.company?.trim() || null,
    notes: body.notes?.trim() || null,
    status: body.status ?? 'cold',
    source: body.source?.trim() || 'zapier',
    external_id: body.external_id?.trim() || null,
    last_contact: body.last_contact ?? null,
  }

  // Try to find an existing lead to update.
  let existingId: string | null = null
  if (email) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('rep_id', rep.id)
      .eq('email', email)
      .maybeSingle()
    existingId = (data as { id: string } | null)?.id ?? null
  }
  if (!existingId && row.external_id) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('rep_id', rep.id)
      .eq('external_id', row.external_id)
      .maybeSingle()
    existingId = (data as { id: string } | null)?.id ?? null
  }

  if (existingId) {
    const { error } = await supabase.from('leads').update(row).eq('id', existingId)
    if (error) return NextResponse.json({ error: 'update failed' }, { status: 500 })
    return NextResponse.json({ ok: true, id: existingId, action: 'updated' })
  }

  const { data: inserted, error } = await supabase
    .from('leads')
    .insert(row)
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: 'insert failed' }, { status: 500 })
  return NextResponse.json({ ok: true, id: inserted.id, action: 'created' })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'POST JSON to this endpoint with ?key=YOUR_KEY. Body: { name, email, company, notes, status?, source?, external_id?, last_contact? }.',
  })
}
