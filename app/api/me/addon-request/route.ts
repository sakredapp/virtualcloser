import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { ADDON_CATALOG, type AddonKey } from '@/lib/addons'
import { sendFeatureRequest } from '@/lib/email'
import { supabase } from '@/lib/supabase'

/**
 * POST /api/me/addon-request — rep clicks "Request" in the Upgrade modal.
 * We log the intent to client_addons (status='requested') so admin sees it
 * in the dashboard, and email team@virtualcloser.com so we actually act
 * on it.
 *
 * If a row already exists in any active state (active|over_cap|requested)
 * we no-op + 200 — repeated clicks shouldn't flood the inbox.
 */
export async function POST(req: Request) {
  let payload: { addon_key?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const addonKey = payload.addon_key as AddonKey | undefined
  if (!addonKey || !(addonKey in ADDON_CATALOG)) {
    return NextResponse.json({ error: 'unknown_addon' }, { status: 400 })
  }
  const def = ADDON_CATALOG[addonKey]
  if (!def.public) {
    return NextResponse.json({ error: 'addon_not_requestable' }, { status: 400 })
  }

  const { tenant, member } = await requireMember()

  // Don't double-log if this rep already has the addon active or has an
  // open request for it.
  const { data: existingActive } = await supabase
    .from('client_addons')
    .select('id, status')
    .eq('rep_id', tenant.id)
    .eq('addon_key', addonKey)
    .maybeSingle()
  if (existingActive && ['active', 'over_cap'].includes(existingActive.status as string)) {
    return NextResponse.json({ ok: true, deduped: 'already_active' })
  }
  const { data: existingReq } = await supabase
    .from('addon_requests')
    .select('id')
    .eq('rep_id', tenant.id)
    .eq('addon_key', addonKey)
    .eq('status', 'pending')
    .maybeSingle()
  if (existingReq) {
    return NextResponse.json({ ok: true, deduped: 'already_requested' })
  }

  // Best-effort log. If the table doesn't exist yet (migration not run),
  // swallow — the email is the important side-effect.
  try {
    await supabase.from('addon_requests').insert({
      rep_id: tenant.id,
      member_id: member.id,
      addon_key: addonKey,
    })
  } catch {
    // ignore — admin will still get the email below
  }

  const result = await sendFeatureRequest({
    fromName: member.display_name ?? tenant.display_name ?? tenant.slug,
    fromEmail: member.email ?? tenant.email ?? null,
    workspace: tenant.slug,
    summary: `Add-on request: ${def.label} ($${(def.monthly_price_cents / 100).toFixed(0)}/mo)`,
    context: `Rep requested ${addonKey} via the dashboard Upgrade modal.\n\n${def.description}`,
  })

  if (!result.ok) {
    // Email failure is logged but we still return 200 — the row is in DB
    // and admin can see it. Otherwise the rep's modal looks broken.
    console.error('[addon-request] email failed', result.error)
  }

  return NextResponse.json({ ok: true })
}
