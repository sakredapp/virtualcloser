// PATCH /api/admin/billing/:repId/custom-pricing
// Body: { monthly_flat_cents?: number | null, sdr_hourly_cents?: number | null }
//
// Saves per-client pricing overrides to reps.pricing_overrides. Null clears
// the field (falls back to catalog). Used by the Custom Pricing panel on the
// admin client detail page.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })

  const { repId } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    monthly_flat_cents?: number | null
    sdr_hourly_cents?: number | null
  }

  // Read existing overrides so we merge rather than replace.
  const { data: rep } = await supabase
    .from('reps')
    .select('pricing_overrides')
    .eq('id', repId)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false, reason: 'rep_not_found' }, { status: 404 })

  const existing = (rep.pricing_overrides as Record<string, unknown> | null) ?? {}
  const updated: Record<string, unknown> = { ...existing }

  if ('monthly_flat_cents' in body) {
    const v = body.monthly_flat_cents
    if (v === null || v === undefined) {
      delete updated.monthly_flat_cents
    } else {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ ok: false, reason: 'invalid monthly_flat_cents' }, { status: 400 })
      }
      updated.monthly_flat_cents = n
    }
  }

  if ('sdr_hourly_cents' in body) {
    const v = body.sdr_hourly_cents
    if (v === null || v === undefined) {
      delete updated.sdr_hourly_cents
    } else {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ ok: false, reason: 'invalid sdr_hourly_cents' }, { status: 400 })
      }
      updated.sdr_hourly_cents = n
    }
  }

  await supabase.from('reps').update({ pricing_overrides: updated }).eq('id', repId)

  const notes = [
    updated.monthly_flat_cents != null ? `monthly flat $${(Number(updated.monthly_flat_cents) / 100).toFixed(2)}` : null,
    updated.sdr_hourly_cents != null ? `SDR $${(Number(updated.sdr_hourly_cents) / 100).toFixed(2)}/hr` : null,
  ].filter(Boolean).join(' · ') || 'all overrides cleared'

  await audit({
    actorKind: 'admin',
    action: 'pricing_overrides.updated',
    repId,
    notes,
    after: updated,
  })

  return NextResponse.json({ ok: true, pricing_overrides: updated })
}
