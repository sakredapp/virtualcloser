import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { upsertClientIntegration, getIntegrationConfig } from '@/lib/client-integrations'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'

// POST /api/admin/billing/[repId]/provision-twilio
//
// Creates a Twilio sub-account for this client and optionally purchases
// a local phone number in it. All usage, call logs, and numbers are
// isolated to the sub-account while billing rolls up to the master account.
// This is required by Twilio ToS for any platform that resells voice/SMS.
//
// Required env vars:
//   TWILIO_MASTER_ACCOUNT_SID — the platform's main Twilio account SID
//   TWILIO_MASTER_AUTH_TOKEN  — its auth token
//
// Idempotent: returns the existing sub-account if already provisioned.

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

function twilioFetch(masterSid: string, masterToken: string, path: string, body?: URLSearchParams) {
  const creds = Buffer.from(`${masterSid}:${masterToken}`).toString('base64')
  return fetch(`${TWILIO_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${creds}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: body.toString() } : {}),
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ repId: string }> },
) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const masterSid = process.env.TWILIO_MASTER_ACCOUNT_SID
  const masterToken = process.env.TWILIO_MASTER_AUTH_TOKEN
  if (!masterSid || !masterToken) {
    return NextResponse.json(
      { error: 'TWILIO_MASTER_ACCOUNT_SID / TWILIO_MASTER_AUTH_TOKEN not configured' },
      { status: 500 },
    )
  }

  const { repId } = await params
  const body = await req.json().catch(() => ({})) as {
    area_code?: string
    buy_number?: boolean
  }

  // Fetch client info for the friendly name.
  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug, display_name')
    .eq('id', repId)
    .maybeSingle()
  if (!rep) return NextResponse.json({ error: 'client not found' }, { status: 404 })

  // Check if already provisioned.
  const existing = await getIntegrationConfig(repId, 'twilio')
  if (existing?.account_sid && existing?.provisioned_by_platform === true) {
    return NextResponse.json({
      ok: true,
      already_provisioned: true,
      account_sid: existing.account_sid,
      phone_number: existing.phone_number ?? null,
    })
  }

  // Create Twilio sub-account.
  const friendlyName = `VirtualCloser__${rep.slug}`
  const createRes = await twilioFetch(
    masterSid,
    masterToken,
    '/Accounts.json',
    new URLSearchParams({ FriendlyName: friendlyName }),
  )
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => createRes.statusText)
    return NextResponse.json(
      { error: `twilio_create_subaccount_failed:${createRes.status}:${text}` },
      { status: 502 },
    )
  }
  const subAccount = (await createRes.json()) as {
    sid: string
    auth_token: string
    friendly_name: string
    status: string
  }

  let phoneNumber: string | null = null

  // Optionally purchase a local phone number inside the sub-account.
  if (body.buy_number !== false) {
    const areaCode = body.area_code || '800'
    const numRes = await twilioFetch(
      subAccount.sid,
      subAccount.auth_token,
      `/Accounts/${subAccount.sid}/IncomingPhoneNumbers.json`,
      new URLSearchParams({
        AreaCode: areaCode,
        VoiceMethod: 'POST',
        SmsMethod: 'POST',
      }),
    )
    if (numRes.ok) {
      const numData = (await numRes.json()) as { phone_number?: string }
      phoneNumber = numData.phone_number ?? null
    }
    // Non-fatal if number purchase fails — admin can do it manually.
  }

  const newConfig: Record<string, unknown> = {
    account_sid: subAccount.sid,
    auth_token: subAccount.auth_token,
    provisioned_by_platform: true,
    master_account_sid: masterSid,
    friendly_name: subAccount.friendly_name,
    provisioned_at: new Date().toISOString(),
    // Preserve any manually-set phone number from before provisioning.
    phone_number: phoneNumber ?? existing?.phone_number ?? null,
    // Preserve existing sms_workflows if any.
    sms_workflows: existing?.sms_workflows ?? [],
  }

  await upsertClientIntegration(repId, 'twilio', {
    label: 'Twilio (platform sub-account)',
    kind: 'api',
    config: newConfig,
  })

  console.info('[provision-twilio] sub-account created', {
    repId,
    sub_account_sid: subAccount.sid,
    phone_number: phoneNumber,
  })

  await audit({
    actorKind: 'admin',
    action: 'twilio.provision_subaccount',
    repId,
    after: { sub_account_sid: subAccount.sid, phone_number: phoneNumber },
  })

  return NextResponse.json({
    ok: true,
    account_sid: subAccount.sid,
    phone_number: phoneNumber,
  })
}
