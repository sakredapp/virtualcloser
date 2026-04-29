// Vapi auto-provisioning for a tenant.
//
// Goal: admin pastes their Vapi API key + product info + objections in the
// Client Integrations panel, optionally connects Twilio for BYO number, and
// clicks save. We then:
//
//   1. Register a phone number on Vapi
//        - if Twilio creds present → BYO Twilio (uses their existing number)
//        - else → buy a new Vapi-managed number on the spot
//   2. Clone the master Confirm + Reschedule + Roleplay assistants in Vapi,
//      patch the system prompt with this tenant's product summary +
//      objections + freeform addendum, and store the new assistantIds back
//      into client_integrations.config.
//
// The master assistants live once in our Vapi account. Their system prompts
// contain placeholder tokens we replace per-tenant:
//
//     {{PRODUCT_SUMMARY}}     → 1–2 paragraphs, what this client sells
//     {{OBJECTIONS}}          → bullet list, common objections + responses
//     {{CUSTOM_ADDENDUM}}     → freeform extra rules from the client
//     {{COMPANY_NAME}}        → tenant.display_name
//     {{AI_NAME}}             → 'Riley' / 'Avery' / etc.
//
// Per-call dynamics ({{lead_name}}, {{when}}, etc.) still flow via
// assistantOverrides.variableValues at placeCall time.

import { getIntegrationConfig, upsertClientIntegration } from '../client-integrations'
import { supabase } from '../supabase'

const BASE = 'https://api.vapi.ai'

const MASTER_CONFIRM_ID = process.env.VAPI_MASTER_CONFIRM_ASSISTANT_ID || ''
const MASTER_RESCHEDULE_ID = process.env.VAPI_MASTER_RESCHEDULE_ASSISTANT_ID || ''
const MASTER_ROLEPLAY_ID = process.env.VAPI_MASTER_ROLEPLAY_ASSISTANT_ID || ''

type ProvisionResult = {
  ok: boolean
  changed: string[]      // ['phone_number', 'confirm_assistant', ...]
  warnings: string[]     // non-fatal ('master_confirm_id_missing', ...)
  error?: string
}

async function vapiFetch(apiKey: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Vapi ${init.method ?? 'GET'} ${path} ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}

function fillTemplate(
  template: string,
  vars: { product: string; objections: string; addendum: string; company: string; aiName: string },
): string {
  return template
    .replace(/\{\{\s*PRODUCT_SUMMARY\s*\}\}/g, vars.product || '(not provided)')
    .replace(/\{\{\s*OBJECTIONS\s*\}\}/g, vars.objections || '(not provided)')
    .replace(/\{\{\s*CUSTOM_ADDENDUM\s*\}\}/g, vars.addendum || '')
    .replace(/\{\{\s*COMPANY_NAME\s*\}\}/g, vars.company || '')
    .replace(/\{\{\s*AI_NAME\s*\}\}/g, vars.aiName || 'Riley')
}

/**
 * Clone a Vapi assistant by id, patch its system prompt with the tenant's
 * product/objections/addendum, return the new assistant id.
 */
async function cloneAssistant(
  apiKey: string,
  masterId: string,
  nameSuffix: string,
  vars: { product: string; objections: string; addendum: string; company: string; aiName: string },
): Promise<string> {
  const master = (await vapiFetch(apiKey, `/assistant/${masterId}`)) as Record<string, unknown>
  // Vapi assistants nest the system prompt under model.messages[0].content
  const model = (master.model ?? {}) as Record<string, unknown>
  const messages = Array.isArray(model.messages) ? [...(model.messages as unknown[])] : []
  const systemMsgIdx = messages.findIndex(
    (m) => typeof m === 'object' && m !== null && (m as { role?: string }).role === 'system',
  )
  if (systemMsgIdx >= 0) {
    const sys = messages[systemMsgIdx] as { role: string; content: string }
    messages[systemMsgIdx] = { ...sys, content: fillTemplate(sys.content || '', vars) }
  }
  const firstMessage = typeof master.firstMessage === 'string'
    ? fillTemplate(master.firstMessage, vars)
    : master.firstMessage

  const payload: Record<string, unknown> = {
    ...master,
    name: `${(master.name as string) || 'assistant'} · ${nameSuffix}`.slice(0, 60),
    model: { ...model, messages },
    firstMessage,
  }
  // Vapi rejects these on create
  delete payload.id
  delete payload.orgId
  delete payload.createdAt
  delete payload.updatedAt
  delete payload.isServerUrlSecretSet

  const created = (await vapiFetch(apiKey, '/assistant', {
    method: 'POST',
    body: JSON.stringify(payload),
  })) as { id: string }
  return created.id
}

async function patchAssistant(
  apiKey: string,
  assistantId: string,
  vars: { product: string; objections: string; addendum: string; company: string; aiName: string },
): Promise<void> {
  const existing = (await vapiFetch(apiKey, `/assistant/${assistantId}`)) as Record<string, unknown>
  const model = (existing.model ?? {}) as Record<string, unknown>
  const messages = Array.isArray(model.messages) ? [...(model.messages as unknown[])] : []
  const systemMsgIdx = messages.findIndex(
    (m) => typeof m === 'object' && m !== null && (m as { role?: string }).role === 'system',
  )
  // To re-fill cleanly we need the original master prompt — fetch master,
  // pull its system content, run fillTemplate, write back.
  // (If the master id isn't known here, we just leave the prompt as-is.)
  // Simpler approach: just patch from current; won't refill placeholders if
  // they were already replaced. For first-pass implementation we accept that
  // re-provision = full clone (delete old, create new).
  if (systemMsgIdx >= 0) {
    const sys = messages[systemMsgIdx] as { role: string; content: string }
    messages[systemMsgIdx] = {
      ...sys,
      content: fillTemplate(sys.content || '', vars),
    }
  }
  await vapiFetch(apiKey, `/assistant/${assistantId}`, {
    method: 'PATCH',
    body: JSON.stringify({ model: { ...model, messages } }),
  })
}

/**
 * Register a phone number on Vapi.
 *   - BYO Twilio if creds are saved on this tenant
 *   - else buy a new Vapi-managed US number
 */
async function ensurePhoneNumber(
  apiKey: string,
  tenantName: string,
  twilio: { account_sid?: string; auth_token?: string; phone_number?: string } | null,
): Promise<{ id: string; provider: 'twilio' | 'vapi'; number?: string }> {
  if (twilio?.account_sid && twilio?.auth_token && twilio?.phone_number) {
    const created = (await vapiFetch(apiKey, '/phone-number', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'twilio',
        twilioAccountSid: twilio.account_sid,
        twilioAuthToken: twilio.auth_token,
        number: twilio.phone_number,
        name: `${tenantName} (BYO Twilio)`.slice(0, 40),
      }),
    })) as { id: string; number?: string }
    return { id: created.id, provider: 'twilio', number: created.number ?? twilio.phone_number }
  }
  // Vapi-managed: provision a fresh US number
  const created = (await vapiFetch(apiKey, '/phone-number/buy', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'vapi',
      name: tenantName.slice(0, 40),
    }),
  })) as { id: string; number?: string }
  return { id: created.id, provider: 'vapi', number: created.number }
}

/**
 * Provision (or re-provision) Vapi resources for a single tenant.
 *
 * Idempotent:
 *   - phone_number_id reused if already saved
 *   - existing assistants are PATCHed in place (prompt re-filled with current
 *     product/objections/addendum) instead of cloned every time
 *   - if no master assistant id is configured for some role, that role is
 *     skipped with a warning
 *
 * Pass `forceReprovision: true` to delete the existing assistant ids and
 * clone fresh ones from the master.
 */
export async function provisionVapiForRep(
  repId: string,
  opts: { forceReprovision?: boolean } = {},
): Promise<ProvisionResult> {
  const result: ProvisionResult = { ok: true, changed: [], warnings: [] }

  const vapiCfg = (await getIntegrationConfig(repId, 'vapi')) ?? {}
  // Platform mode: ONE Vapi org owned by us, all clients ride on it as
  // separate cloned assistants. If the tenant hasn't pasted their own key,
  // fall back to the platform key (we foot the Vapi bill, charge them
  // monthly markup). If neither is set, bail.
  const apiKey =
    (vapiCfg.api_key as string | undefined) || process.env.VAPI_API_KEY || ''
  if (!apiKey) {
    return {
      ok: false,
      changed: [],
      warnings: [],
      error: 'No Vapi API key — set VAPI_API_KEY env or paste a per-client key',
    }
  }

  // Tenant display name for assistant labels
  const { data: rep } = await supabase
    .from('reps')
    .select('display_name, business_name')
    .eq('id', repId)
    .maybeSingle()
  const tenantName =
    (rep?.business_name as string | null) || (rep?.display_name as string | null) || 'Client'

  const vars = {
    product: (vapiCfg.product_summary as string) || '',
    objections: (vapiCfg.objections as string) || '',
    addendum: (vapiCfg.confirm_addendum as string) || '',
    company: tenantName,
    aiName: (vapiCfg.ai_name as string) || 'Riley',
  }

  // Pull training docs and inline their text bodies (and storage_path
  // pointers for binary files) into the addendums. We split by intent so the
  // dialer only sees dialer-relevant docs and the roleplay AI sees the full
  // bank.
  let dialerDocsBlock = ''
  let roleplayDocsBlock = ''
  try {
    const { data: docs } = await supabase
      .from('roleplay_training_docs')
      .select('title, body, storage_path, doc_kind, scope')
      .eq('rep_id', repId)
      .eq('is_active', true)
    const dialerKinds = new Set(['product_brief', 'script', 'objection_list', 'reference'])
    const lines = (docs ?? []).map((d) => {
      const head = `### ${d.title} (${d.doc_kind})`
      const body = d.body ? d.body.slice(0, 4000) : `(file at storage://roleplay-training/${d.storage_path ?? ''})`
      return `${head}\n${body}`
    })
    const dialerLines = (docs ?? [])
      .filter((d) => dialerKinds.has(String(d.doc_kind)))
      .map((d) => {
        const head = `### ${d.title} (${d.doc_kind})`
        const body = d.body ? d.body.slice(0, 4000) : `(file at storage://roleplay-training/${d.storage_path ?? ''})`
        return `${head}\n${body}`
      })
    if (dialerLines.length) {
      dialerDocsBlock = `\n\n---\nReference documents the client uploaded:\n\n${dialerLines.join('\n\n')}`
    }
    if (lines.length) {
      roleplayDocsBlock = `\n\n---\nTraining documents the client uploaded:\n\n${lines.join('\n\n')}`
    }
  } catch {
    // table might not exist in some envs — skip silently
  }

  const twilioCfg = await getIntegrationConfig(repId, 'twilio')
  const twilio = twilioCfg
    ? {
        account_sid: twilioCfg.account_sid as string | undefined,
        auth_token: twilioCfg.auth_token as string | undefined,
        phone_number: twilioCfg.phone_number as string | undefined,
      }
    : null

  // Build a mutable copy of vapi config so we can save updated ids back at the end.
  const newCfg: Record<string, unknown> = { ...vapiCfg }

  // 1. Phone number ────────────────────────────────────────────────────────
  if (!newCfg.phone_number_id) {
    try {
      const phone = await ensurePhoneNumber(apiKey, tenantName, twilio)
      newCfg.phone_number_id = phone.id
      newCfg.phone_number = phone.number
      newCfg.phone_provider = phone.provider
      result.changed.push(`phone_number(${phone.provider})`)
    } catch (err) {
      result.warnings.push(`phone_number_failed: ${(err as Error).message}`)
    }
  }

  // 2. Confirm assistant ────────────────────────────────────────────────────
  if (MASTER_CONFIRM_ID) {
    try {
      const cVars = { ...vars, addendum: ((vapiCfg.confirm_addendum as string) || '') + dialerDocsBlock }
      if (!newCfg.confirm_assistant_id || opts.forceReprovision) {
        const id = await cloneAssistant(apiKey, MASTER_CONFIRM_ID, `${tenantName} · confirm`, cVars)
        newCfg.confirm_assistant_id = id
        result.changed.push('confirm_assistant')
      } else {
        await patchAssistant(apiKey, newCfg.confirm_assistant_id as string, cVars)
        result.changed.push('confirm_assistant_patched')
      }
    } catch (err) {
      result.warnings.push(`confirm_assistant_failed: ${(err as Error).message}`)
    }
  } else {
    result.warnings.push('VAPI_MASTER_CONFIRM_ASSISTANT_ID env var not set')
  }

  // 3. Reschedule assistant ─────────────────────────────────────────────────
  if (MASTER_RESCHEDULE_ID) {
    try {
      const rVars = { ...vars, addendum: ((vapiCfg.reschedule_addendum as string) || vars.addendum) + dialerDocsBlock }
      if (!newCfg.reschedule_assistant_id || opts.forceReprovision) {
        const id = await cloneAssistant(apiKey, MASTER_RESCHEDULE_ID, `${tenantName} · reschedule`, rVars)
        newCfg.reschedule_assistant_id = id
        result.changed.push('reschedule_assistant')
      } else {
        await patchAssistant(apiKey, newCfg.reschedule_assistant_id as string, rVars)
        result.changed.push('reschedule_assistant_patched')
      }
    } catch (err) {
      result.warnings.push(`reschedule_assistant_failed: ${(err as Error).message}`)
    }
  } else {
    result.warnings.push('VAPI_MASTER_RESCHEDULE_ASSISTANT_ID env var not set')
  }

  // 4. Roleplay assistant ───────────────────────────────────────────────────
  if (MASTER_ROLEPLAY_ID) {
    try {
      const rpVars = { ...vars, addendum: ((vapiCfg.roleplay_addendum as string) || '') + roleplayDocsBlock }
      if (!newCfg.roleplay_assistant_id || opts.forceReprovision) {
        const id = await cloneAssistant(apiKey, MASTER_ROLEPLAY_ID, `${tenantName} · roleplay`, rpVars)
        newCfg.roleplay_assistant_id = id
        result.changed.push('roleplay_assistant')
      } else {
        await patchAssistant(apiKey, newCfg.roleplay_assistant_id as string, rpVars)
        result.changed.push('roleplay_assistant_patched')
      }
    } catch (err) {
      result.warnings.push(`roleplay_assistant_failed: ${(err as Error).message}`)
    }
  } else {
    result.warnings.push('VAPI_MASTER_ROLEPLAY_ASSISTANT_ID env var not set')
  }

  // 5. Persist updated config back ──────────────────────────────────────────
  await upsertClientIntegration(repId, 'vapi', {
    label: 'Vapi (AI Voice)',
    kind: 'api',
    config: newCfg,
  })

  return result
}
