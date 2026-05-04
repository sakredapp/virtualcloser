import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { upsertClientIntegration, getIntegrationConfig } from '@/lib/client-integrations'
import { audit } from '@/lib/billing/auditLog'

// POST /api/admin/billing/[repId]/provision-revring-trunk
//
// Sets or provisions the RevRing voice billing model for a client.
//
// Three models:
//   shared          — Individual clients. Uses platform's REVRING_API_KEY env var
//                     for calls; only agent IDs are stored per-client in DB.
//   own_trunk       — Enterprise brings their own RevRing account. Admin supplies
//                     api_key, trunk_sid, from_number; we store them and use them.
//   platform_trunk  — Enterprise. Platform creates a dedicated trunk under our
//                     RevRing master account via the RevRing sub-account API, then
//                     stores the returned trunk_sid + from_number.
//
// Required env vars for platform_trunk provisioning:
//   REVRING_MASTER_API_KEY   — platform's RevRing master API key
//
// Body (JSON):
//   model        — 'shared' | 'own_trunk' | 'platform_trunk'
//   api_key?     — required for own_trunk
//   trunk_sid?   — required for own_trunk; returned by RevRing for platform_trunk
//   from_number? — E.164 from-number to use
//   friendly_name? — label for the trunk (platform_trunk only)

const REVRING_BASE = 'https://api.revring.ai/v1'

type Body = {
  model: 'shared' | 'own_trunk' | 'platform_trunk'
  api_key?: string
  trunk_sid?: string
  from_number?: string
  friendly_name?: string
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ repId: string }> },
) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { repId } = await params
  const body = await req.json().catch(() => ({})) as Body
  const { model } = body

  if (!model || !['shared', 'own_trunk', 'platform_trunk'].includes(model)) {
    return NextResponse.json({ error: 'model must be shared | own_trunk | platform_trunk' }, { status: 400 })
  }

  const existing = await getIntegrationConfig(repId, 'revring')

  // ── shared ───────────────────────────────────────────────────────────────
  if (model === 'shared') {
    const updated = {
      ...(existing ?? {}),
      voice_billing_model: 'shared',
      // Clear out any trunk-specific fields when reverting to shared.
      api_key: undefined,
      trunk_sid: undefined,
    }
    await upsertClientIntegration(repId, 'revring', {
      label: 'AI Voice (shared platform account)',
      kind: 'api',
      config: updated,
    })
    console.info('[provision-revring-trunk] set to shared', { repId })
    await audit({ actorKind: 'admin', action: 'revring.set_model_shared', repId })
    return NextResponse.json({ ok: true, model: 'shared' })
  }

  // ── own_trunk ─────────────────────────────────────────────────────────────
  if (model === 'own_trunk') {
    if (!body.api_key && !existing?.api_key) {
      return NextResponse.json({ error: 'api_key required for own_trunk' }, { status: 400 })
    }
    if (!body.trunk_sid && !existing?.trunk_sid) {
      return NextResponse.json({ error: 'trunk_sid required for own_trunk' }, { status: 400 })
    }
    const updated = {
      ...(existing ?? {}),
      voice_billing_model: 'own_trunk',
      api_key: body.api_key ?? existing?.api_key,
      trunk_sid: body.trunk_sid ?? existing?.trunk_sid,
      from_number: body.from_number ?? existing?.from_number,
    }
    await upsertClientIntegration(repId, 'revring', {
      label: 'AI Voice (enterprise — own trunk)',
      kind: 'api',
      config: updated,
    })
    console.info('[provision-revring-trunk] set to own_trunk', { repId, trunk_sid: updated.trunk_sid })
    await audit({
      actorKind: 'admin',
      action: 'revring.set_model_own_trunk',
      repId,
      after: { trunk_sid: updated.trunk_sid },
    })
    return NextResponse.json({ ok: true, model: 'own_trunk', trunk_sid: updated.trunk_sid })
  }

  // ── platform_trunk ────────────────────────────────────────────────────────
  const masterKey = process.env.REVRING_MASTER_API_KEY
  if (!masterKey) {
    return NextResponse.json({ error: 'REVRING_MASTER_API_KEY not configured' }, { status: 500 })
  }

  // If trunk_sid already supplied skip creation (idempotent re-save).
  if (body.trunk_sid) {
    const updated = {
      ...(existing ?? {}),
      voice_billing_model: 'platform_trunk',
      trunk_sid: body.trunk_sid,
      from_number: body.from_number ?? existing?.from_number,
      // For platform_trunk calls use the master api_key (set at call-time from env),
      // so we intentionally leave api_key undefined here.
      api_key: undefined,
    }
    await upsertClientIntegration(repId, 'revring', {
      label: 'AI Voice (enterprise — platform trunk)',
      kind: 'api',
      config: updated,
    })
    console.info('[provision-revring-trunk] platform_trunk saved (pre-existing SID)', { repId, trunk_sid: body.trunk_sid })
    await audit({
      actorKind: 'admin',
      action: 'revring.set_model_platform_trunk',
      repId,
      after: { trunk_sid: body.trunk_sid },
    })
    return NextResponse.json({ ok: true, model: 'platform_trunk', trunk_sid: body.trunk_sid })
  }

  // Create a new sub-account / trunk under the platform's RevRing master account.
  // TODO: confirm the exact endpoint + response shape with your RevRing rep.
  //       Common patterns: POST /v1/trunks, POST /v1/sub-accounts, POST /v1/organizations
  const createRes = await fetch(`${REVRING_BASE}/trunks`, {
    method: 'POST',
    headers: {
      'x-api-key': masterKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      friendly_name: body.friendly_name ?? `virtualcloser_${repId.slice(0, 8)}`,
    }),
  })

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => createRes.statusText)
    console.error('[provision-revring-trunk] trunk creation failed', { repId, status: createRes.status, text })
    return NextResponse.json(
      { error: `revring_create_trunk_failed:${createRes.status}:${text}` },
      { status: 502 },
    )
  }

  const trunk = (await createRes.json()) as {
    id?: string
    trunk_sid?: string
    sid?: string
    from_number?: string
    phone_number?: string
  }
  const trunkSid = trunk.trunk_sid ?? trunk.sid ?? trunk.id
  if (!trunkSid) {
    return NextResponse.json({ error: 'revring_trunk_response_missing_id' }, { status: 502 })
  }

  const fromNumber = body.from_number ?? trunk.from_number ?? trunk.phone_number ?? existing?.from_number

  const updated = {
    ...(existing ?? {}),
    voice_billing_model: 'platform_trunk',
    trunk_sid: trunkSid,
    from_number: fromNumber,
    api_key: undefined,
    provisioned_at: new Date().toISOString(),
  }
  await upsertClientIntegration(repId, 'revring', {
    label: 'AI Voice (enterprise — platform trunk)',
    kind: 'api',
    config: updated,
  })

  console.info('[provision-revring-trunk] platform trunk created', { repId, trunk_sid: trunkSid, from_number: fromNumber })
  await audit({
    actorKind: 'admin',
    action: 'revring.provision_platform_trunk',
    repId,
    after: { trunk_sid: trunkSid, from_number: fromNumber },
  })

  return NextResponse.json({ ok: true, model: 'platform_trunk', trunk_sid: trunkSid, from_number: fromNumber })
}
