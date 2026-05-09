import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx

  const leadId = req.nextUrl.searchParams.get('leadId')
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  // Verify lead belongs to this rep
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, phone')
    .eq('id', leadId)
    .eq('rep_id', member.rep_id)
    .maybeSingle()

  if (!lead) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: messages } = await supabase
    .from('sms_messages')
    .select('id, direction, body, from_phone, to_phone, status, is_ai_reply, created_at')
    .eq('rep_id', member.rep_id)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(300)

  return NextResponse.json({ lead, messages: messages ?? [] })
}
