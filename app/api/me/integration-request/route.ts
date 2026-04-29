import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { sendFeatureRequest } from '@/lib/email'
import { supabase } from '@/lib/supabase'

/**
 * POST /api/me/integration-request
 * Rep describes what integration they need. Logged to addon_requests
 * (addon_key = 'custom_integration') and emailed to the team.
 */
export async function POST(req: Request) {
  let payload: { description?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const description = (payload.description ?? '').trim()
  if (!description) {
    return NextResponse.json({ error: 'description_required' }, { status: 400 })
  }

  const { tenant, member } = await requireMember()

  // Log to addon_requests so admin sees it in the portal.
  try {
    await supabase.from('addon_requests').insert({
      rep_id: tenant.id,
      member_id: member.id,
      addon_key: 'custom_integration',
      notes: description,
    })
  } catch {
    // swallow — email is the important side-effect
  }

  const result = await sendFeatureRequest({
    fromName: member.display_name ?? tenant.display_name ?? tenant.slug,
    fromEmail: member.email ?? tenant.email ?? null,
    workspace: tenant.slug,
    summary: `Integration request from ${tenant.slug}`,
    context: description,
  })

  if (!result.ok) {
    console.error('[integration-request] email failed', result.error)
  }

  return NextResponse.json({ ok: true })
}
