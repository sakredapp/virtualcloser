// POST /api/billing/change-request
// Body: { kind, notes, hours? }
//
// Manager-or-above (non-owner) submits a billing change request. Owner gets
// an email notification.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { can } from '@/lib/permissions'
import { supabase } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID = new Set(['add_hours','remove_hours','toggle_overflow','add_addon','remove_addon','cancel','other'])

export async function POST(req: NextRequest) {
  let session
  try { session = await requireMember() } catch { return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) }

  // Owners don't need to file a request — they can change directly.
  if (can(session.member, 'billing.manage')) {
    return NextResponse.json({ ok: false, reason: 'owner_should_change_directly' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const kind = String(body.kind ?? '')
  if (!VALID.has(kind)) return NextResponse.json({ ok: false, reason: 'bad_kind' }, { status: 400 })

  await supabase.from('billing_change_requests').insert({
    rep_id: session.tenant.id,
    requested_by: session.member.id,
    kind,
    payload: { notes: body.notes ?? null, hours: body.hours ?? null },
    status: 'open',
  })

  // Notify owners.
  const { data: owners } = await supabase
    .from('members')
    .select('email, display_name')
    .eq('rep_id', session.tenant.id)
    .eq('role', 'owner')
    .eq('is_active', true)
  for (const o of (owners ?? []) as { email: string; display_name: string }[]) {
    if (!o.email) continue
    sendEmail({
      to: o.email,
      subject: `[Billing request] ${kind} from ${session.member.display_name}`,
      html: `<p>${session.member.display_name} (${session.member.role}) requested a billing change:</p>
        <p><strong>${kind}</strong> ${body.hours != null ? `· ${body.hours}h` : ''}</p>
        <p>${(body.notes ?? '').replace(/[<>]/g, '')}</p>
        <p><a href="https://${process.env.ROOT_DOMAIN ?? 'virtualcloser.com'}/dashboard/billing/account">Open billing →</a></p>`,
      text: `${session.member.display_name} requested ${kind}. ${body.notes ?? ''}`,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
