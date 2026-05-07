import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'
import { listCrmLeads } from '@/lib/crmLeads'
import type { Disposition } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const p = req.nextUrl.searchParams
  const leads = await listCrmLeads(member.rep_id, {
    search: p.get('search') ?? undefined,
    source: p.get('source') ?? undefined,
    assignee: p.get('assignee') ?? undefined,
    disposition: (p.get('disposition') as Disposition) || undefined,
    productIntent: p.get('productIntent') ?? undefined,
  })
  return NextResponse.json(leads)
}

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const body = await req.json()
  const { data, error } = await supabase.from('leads').insert({
    rep_id: member.rep_id,
    name: body.name,
    email: body.email ?? null,
    phone: body.phone ?? null,
    company: body.company ?? null,
    source: body.source ?? null,
    disposition: body.disposition ?? 'new',
    product_intent: body.product_intent ?? null,
    notes: body.notes ?? null,
    owner_member_id: body.owner_member_id ?? null,
    lead_date: new Date().toISOString(),
    disposition_changed_at: new Date().toISOString(),
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
