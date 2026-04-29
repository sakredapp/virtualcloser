import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getIntegrationConfig, upsertClientIntegration } from '@/lib/client-integrations'
import { provisionVapiForRep } from '@/lib/voice/vapiProvision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Tenant-side editor for their own Vapi voice prompts.
 *
 * Writes into client_integrations.config for key='vapi' (only the prompt
 * fields — never the api_key / phone_number_id which the admin owns), then
 * runs provisionVapiForRep so the new copy flows into the live Vapi
 * assistants immediately.
 *
 * If the tenant doesn't have a vapi integration yet (admin hasn't pasted the
 * api key), we still save the prompts so the admin can hit "Save" later and
 * have it provision in one shot.
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

  // Pull existing config so we preserve admin-owned fields (api_key,
  // phone_number_id, assistant ids).
  const existing = (await getIntegrationConfig(repId, 'vapi')) ?? {}
  const merged: Record<string, unknown> = { ...existing }
  for (const k of ALLOWED_FIELDS) {
    if (typeof body[k] === 'string') merged[k] = body[k]
  }

  await upsertClientIntegration(repId, 'vapi', {
    label: 'Vapi (AI Voice)',
    kind: 'api',
    config: merged,
  })

  // Re-provision (idempotent PATCH path) so the new prompts hit the live
  // assistants. Skipped when api_key is missing — that's the admin's job.
  let provision: unknown = null
  if (typeof merged.api_key === 'string' && merged.api_key) {
    try {
      provision = await provisionVapiForRep(repId)
    } catch (err) {
      provision = { ok: false, error: (err as Error).message }
    }
  }

  return NextResponse.json({ ok: true, provision })
}
