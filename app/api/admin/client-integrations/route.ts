import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import {
  upsertClientIntegration,
  toggleClientIntegration,
  deleteClientIntegration,
  type IntegrationKind,
} from '@/lib/client-integrations'

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

  const row = await upsertClientIntegration(repId, key, {
    label,
    kind: kind as IntegrationKind,
    config,
    notes: body.notes ?? null,
  })

  return NextResponse.json(row)
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
