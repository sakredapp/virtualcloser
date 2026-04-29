// SMS sender — Twilio REST API (no SDK).
//
// Tenant-scoped. Reads Twilio creds from client_integrations.config['twilio']:
//   - account_sid
//   - auth_token
//   - phone_number          ← the FROM number
//
// Optional: client_integrations.config['twilio'].sms_workflows is an array
// of { trigger_stage, template, enabled } that GHL stage-update handler
// fires against. trigger_stage matches against the GHL pipelineStageId OR a
// human-readable substring of the stage name (server checks both).

import { getIntegrationConfig } from './client-integrations'

export type SmsWorkflow = {
  trigger_stage: string        // e.g. 'approved' or '<ghl_stage_id>'
  template: string             // supports {{first_name}} {{rep_name}} {{deal_value}}
  enabled?: boolean
}

export type SmsResult =
  | { ok: true; sid: string }
  | { ok: false; reason: string }

function normalizeE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits
}

export async function sendSms(
  repId: string,
  opts: { to: string; body: string },
): Promise<SmsResult> {
  const cfg = await getIntegrationConfig(repId, 'twilio')
  if (!cfg) return { ok: false, reason: 'twilio_not_configured' }
  const sid = cfg.account_sid as string | undefined
  const token = cfg.auth_token as string | undefined
  const from = cfg.phone_number as string | undefined
  if (!sid || !token || !from) return { ok: false, reason: 'twilio_creds_incomplete' }

  const to = normalizeE164(opts.to)
  if (!to) return { ok: false, reason: 'invalid_to_number' }

  const params = new URLSearchParams({ To: to, From: from, Body: opts.body.slice(0, 1500) })
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    return { ok: false, reason: `twilio_${res.status}: ${text.slice(0, 200)}` }
  }
  const data = (await res.json().catch(() => ({}))) as { sid?: string }
  return { ok: true, sid: data.sid ?? '' }
}

/**
 * Fill {{var}} placeholders in a template. Unknown vars become empty.
 */
export function fillSmsTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const v = vars[key as string]
    return v == null ? '' : String(v)
  })
}

/**
 * Look up SMS workflows configured for this rep and return the templates that
 * match the given GHL stage trigger (id OR human substring).
 */
export async function findMatchingSmsWorkflows(
  repId: string,
  args: { stageId?: string | null; stageName?: string | null },
): Promise<SmsWorkflow[]> {
  const cfg = await getIntegrationConfig(repId, 'twilio')
  if (!cfg) return []
  const flows = (cfg.sms_workflows as SmsWorkflow[] | undefined) ?? []
  const idLower = (args.stageId ?? '').toLowerCase()
  const nameLower = (args.stageName ?? '').toLowerCase()
  return flows.filter((w) => {
    if (w.enabled === false) return false
    const trig = (w.trigger_stage ?? '').toLowerCase()
    if (!trig) return false
    return trig === idLower || (nameLower && nameLower.includes(trig))
  })
}
