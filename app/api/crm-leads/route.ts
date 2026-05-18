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
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  // Required-field validation — name is non-null in the schema; failing here
  // gives the caller a clean 400 instead of a raw DB constraint error.
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Ownership check: a body-supplied owner_member_id must belong to the same
  // tenant as the authed member. Prevents assigning a lead to someone on
  // another tenant's team via crafted requests.
  const requestedOwnerId = typeof body.owner_member_id === 'string' ? body.owner_member_id : null
  let ownerMemberId: string | null = null
  if (requestedOwnerId) {
    const { data: ownerRow } = await supabase
      .from('members')
      .select('id')
      .eq('id', requestedOwnerId)
      .eq('rep_id', member.rep_id)
      .maybeSingle()
    if (!ownerRow) {
      return NextResponse.json({ error: 'owner_member_id not in this account' }, { status: 403 })
    }
    ownerMemberId = ownerRow.id as string
  }

  const { data, error } = await supabase.from('leads').insert({
    rep_id: member.rep_id,
    name,
    email: typeof body.email === 'string' ? body.email : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    company: typeof body.company === 'string' ? body.company : null,
    source: typeof body.source === 'string' ? body.source : null,
    disposition: typeof body.disposition === 'string' ? body.disposition : 'new',
    product_intent: typeof body.product_intent === 'string' ? body.product_intent : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
    owner_member_id: ownerMemberId,
    lead_date: new Date().toISOString(),
    disposition_changed_at: new Date().toISOString(),
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
