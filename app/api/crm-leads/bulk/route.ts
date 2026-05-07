import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'
import { setDisposition } from '@/lib/crmLeads'
import type { Disposition } from '@/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx
  const { ids, action, value } = await req.json() as { ids: string[]; action: 'disposition' | 'assign'; value: string }
  if (!ids?.length) return NextResponse.json({ error: 'no ids' }, { status: 400 })
  if (action === 'disposition') {
    await Promise.all(ids.map(id => setDisposition(member.rep_id, id, value as Disposition, member.id)))
  } else if (action === 'assign') {
    await supabase.from('leads').update({ owner_member_id: value || null }).in('id', ids).eq('rep_id', member.rep_id)
  }
  return NextResponse.json({ ok: true, count: ids.length })
}
