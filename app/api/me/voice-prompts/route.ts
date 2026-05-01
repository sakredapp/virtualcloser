import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getIntegrationConfig, upsertClientIntegration } from '@/lib/client-integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Tenant-side editor for their own voice prompts (used by the dialer
 * receptionist, AI SDR, and roleplay screens).
 *
 * Provider-agnostic. Writes into client_integrations.config under
 * key='voice_prompts'. RevRing pulls these fresh per call from the
 * webhook → assistant config flow, so there's no prefetch/resync to
 * trigger on save.
 *
 * Migrated from the Vapi-specific 'vapi' integration key — historical
 * rows under that key are still read by older callers (none after this
 * commit), but new writes land under 'voice_prompts'.
 */
const ALLOWED_FIELDS = [
  'product_summary',
  'objections',
  'confirm_addendum',
  'reschedule_addendum',
  'roleplay_addendum',
  'ai_name',
] as const

type AllowedKey = (typeof ALLOWED_FIELDS)[number]

export async function POST(req: NextRequest) {
  let body: Partial<Record<AllowedKey, string>>
  try {
    body = (await req.json()) as Partial<Record<AllowedKey, string>>
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }

  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const repId = ctx.tenant.id

  const existing = (await getIntegrationConfig(repId, 'voice_prompts')) ?? {}
  const merged: Record<string, unknown> = { ...existing }
  for (const k of ALLOWED_FIELDS) {
    if (typeof body[k] === 'string') merged[k] = body[k]
  }

  await upsertClientIntegration(repId, 'voice_prompts', {
    label: 'Voice prompts',
    kind: 'config',
    config: merged,
  })

  return NextResponse.json({ ok: true })
}
