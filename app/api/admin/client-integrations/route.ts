import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import {
  upsertClientIntegration,
  toggleClientIntegration,
  deleteClientIntegration,
  type IntegrationKind,
} from '@/lib/client-integrations'
import { provisionVapiForRep } from '@/lib/voice/vapiProvision'
import { normalizeAndValidateFlowDefinition } from '@/lib/voice/revringFlow'

const VALID_KINDS = new Set<string>(['api', 'oauth', 'webhook_inbound', 'webhook_outbound', 'zapier'])

// POST — upsert an integration (create or update by rep_id + key)
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    repId: string
    key: string
    label: string
    kind: string
    config: Record<string, unknown>
    notes?: string
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { repId, key, label, kind, config } = body
  if (!repId || !key || !label || !kind) {
    return NextResponse.json({ error: 'repId, key, label, kind required' }, { status: 400 })
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  }
  // Sanitise key: only a-z0-9_ allowed
  if (!/^[a-z0-9_]+$/.test(key)) {
    return NextResponse.json({ error: 'key must be a-z0-9_ only' }, { status: 400 })
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return NextResponse.json({ error: 'config must be an object' }, { status: 400 })
  }

  const normalizedConfigResult = normalizeConfigForKey(key, config)
  if (!normalizedConfigResult.ok) {
    return NextResponse.json({ error: normalizedConfigResult.error }, { status: 400 })
  }

  const row = await upsertClientIntegration(repId, key, {
    label,
    kind: kind as IntegrationKind,
    config: normalizedConfigResult.config,
    notes: body.notes ?? null,
  })

  // Auto-provision Vapi resources (phone number + cloned assistants with the
  // latest product/objections/addendum baked in) whenever vapi or twilio
  // creds change. Failures here are surfaced as `provision` field but do
  // not block the save itself.
  let provision: unknown = null
  if (key === 'vapi' || key === 'twilio') {
    try {
      provision = await provisionVapiForRep(repId)
    } catch (err) {
      provision = { ok: false, error: (err as Error).message }
    }
  }

  return NextResponse.json({ ...row, provision })
}

// PATCH — toggle is_active
export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id: string; is_active: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await toggleClientIntegration(body.id, !!body.is_active)
  return NextResponse.json({ ok: true })
}

// DELETE — remove an integration row
export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await deleteClientIntegration(body.id)
  return NextResponse.json({ ok: true })
}

function normalizeConfigForKey(
  key: string,
  config: Record<string, unknown>,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (key !== 'revring') return { ok: true, config }

  const out: Record<string, unknown> = { ...config }

  if (typeof out.skip_queue === 'string') {
    const v = out.skip_queue.trim().toLowerCase()
    out.skip_queue = v === 'true' || v === '1' || v === 'yes'
  }
  if (typeof out.dry_run === 'string') {
    const v = out.dry_run.trim().toLowerCase()
    out.dry_run = v === 'true' || v === '1' || v === 'yes'
  }
  if (typeof out.caller_id_name === 'string' && out.caller_id_name.length > 15) {
    return { ok: false, error: 'revring caller_id_name must be 15 chars or fewer' }
  }

  if ('flow_definition' in out) {
    const normalized = normalizeAndValidateFlowDefinition(out.flow_definition)
    if (!normalized.ok) {
      return { ok: false, error: normalized.error }
    }
    out.flow_definition = normalized.value
  }

  return { ok: true, config: out }
}
