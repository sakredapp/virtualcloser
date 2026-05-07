import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'
import { setDisposition } from '@/lib/crmLeads'
import type { Disposition } from '@/types'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const { id } = await params
  const body = await req.json()

  // Disposition gets special treatment (protected stages, event log)
  if ('disposition' in body) {
    await setDisposition(member.rep_id, id, body.disposition as Disposition, member.id)
    const rest = { ...body }
    delete rest.disposition
    if (Object.keys(rest).length > 0) {
      await supabase.from('leads').update(rest).eq('id', id).eq('rep_id', member.rep_id)
    }
  } else {
    const { error } = await supabase.from('leads').update(body).eq('id', id).eq('rep_id', member.rep_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const { id } = await params
  await supabase.from('leads').delete().eq('id', id).eq('rep_id', member.rep_id)
  return NextResponse.json({ ok: true })
}
