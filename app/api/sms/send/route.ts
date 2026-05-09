import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getTwilioCreds, sendSms } from '@/lib/sms/twilioClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { member } = ctx

  const { leadId, body } = (await req.json()) as { leadId?: string; body?: string }
  if (!leadId || !body?.trim()) {
    return NextResponse.json({ error: 'leadId and body required' }, { status: 400 })
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, phone, do_not_call')
    .eq('id', leadId)
    .eq('rep_id', member.rep_id)
    .maybeSingle()

  if (!lead) return NextResponse.json({ error: 'lead_not_found' }, { status: 404 })
  if (!lead.phone) return NextResponse.json({ error: 'lead_has_no_phone' }, { status: 422 })
  if (lead.do_not_call) return NextResponse.json({ error: 'do_not_contact' }, { status: 422 })

  const creds = await getTwilioCreds(member.rep_id)
  if (!creds) return NextResponse.json({ error: 'no_twilio_creds' }, { status: 422 })

  let sid: string
  try {
    const result = await sendSms(creds, lead.phone as string, body.trim())
    sid = result.sid
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'send_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  await supabase.from('sms_messages').insert({
    rep_id: member.rep_id,
    lead_id: leadId,
    direction: 'outbound',
    body: body.trim(),
    from_phone: creds.phoneNumber,
    to_phone: lead.phone,
    status: 'sent',
    is_ai_reply: false,
    provider_message_id: sid,
  })

  // Touch last_contacted_at
  await supabase
    .from('leads')
    .update({ last_contacted_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('rep_id', member.rep_id)

  return NextResponse.json({ ok: true, sid })
}
