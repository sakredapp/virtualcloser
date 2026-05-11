#!/usr/bin/env tsx
/**
 * Patches the live RevRing agent with the health insurance SDR prompt,
 * Rachel voice, demo default variables, and live booking custom tools.
 *
 * Usage:
 *   REVRING_API_KEY=<key> VC_BASE_URL=https://app.virtualcloser.com \
 *     REVRING_TOOL_SECRET=<secret> \
 *     npx tsx scripts/patch-health-insurance-agent.ts
 *
 *   Add --dry-run to preview without making changes.
 *
 * Required env vars:
 *   REVRING_API_KEY    — RevRing platform API key
 *   VC_BASE_URL        — Public base URL of this VC deployment (no trailing slash)
 *   REVRING_TOOL_SECRET — Shared secret sent as x-tool-secret header on tool calls
 */

import {
  HEALTH_INSURANCE_AGENT_ID,
  HEALTH_INSURANCE_AGENT_PHONE,
  buildHealthInsuranceAgentUpdate,
} from '../lib/voice/healthInsuranceAgent'

const BASE    = 'https://api.revring.ai/v1'
const DRY_RUN = process.argv.includes('--dry-run')

// Custom tool definitions — schema follows OpenAI function calling format
const GET_SLOTS_SCHEMA = {
  type: 'function',
  name: 'get_available_slots',
  description:
    'Fetch real available appointment slots for the lead. Call this as soon as the lead agrees to book a follow-up call with the licensed agent. Pass the lead\'s IANA timezone so times are returned in their local time.',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Lead\'s IANA timezone, e.g. America/Los_Angeles or America/New_York',
      },
      tz_name: {
        type: 'string',
        description: 'Human-readable timezone label shown to the lead, e.g. Pacific Time (PT)',
      },
    },
    required: ['timezone', 'tz_name'],
    additionalProperties: false,
  },
}

const BOOK_APPT_SCHEMA = {
  type: 'function',
  name: 'book_appointment',
  description:
    'Book the specific appointment slot the lead has verbally confirmed. Call this immediately after the lead picks a time from the available slots list. Do NOT confirm the appointment to the lead until this tool returns success.',
  parameters: {
    type: 'object',
    properties: {
      start_utc: {
        type: 'string',
        description: 'Exact UTC start time from the slots list, e.g. 2026-05-10T13:00:00.000Z',
      },
      lead_name: {
        type: 'string',
        description: 'Lead\'s full name',
      },
      lead_phone: {
        type: 'string',
        description: 'Lead\'s phone number',
      },
      lead_email: {
        type: 'string',
        description: 'Lead\'s email address if collected, otherwise omit',
      },
      lead_state: {
        type: 'string',
        description: 'Lead\'s US state abbreviation or name, e.g. TX or California',
      },
      timezone: {
        type: 'string',
        description: 'Lead\'s IANA timezone for confirmation readback',
      },
      tz_name: {
        type: 'string',
        description: 'Human-readable timezone label for confirmation readback',
      },
    },
    required: ['start_utc', 'lead_name', 'lead_phone', 'timezone', 'tz_name'],
    additionalProperties: false,
  },
}

async function upsertTool(
  apiKey: string,
  agentId: string,
  webhookUrl: string,
  toolSecret: string,
  schema: typeof GET_SLOTS_SCHEMA | typeof BOOK_APPT_SCHEMA,
  existingTools: { id: string; name: string }[],
) {
  const existing = existingTools.find((t) => t.name === schema.name)
  const method = existing ? 'PATCH' : 'POST'
  const url = existing
    ? `${BASE}/agents/${agentId}/custom-tools/${existing.id}`
    : `${BASE}/agents/${agentId}/custom-tools`

  const body = {
    name: schema.name,
    webhookUrl,
    httpMethod: 'POST',
    headers: [{ key: 'x-tool-secret', value: toolSecret }],
    sendRawRequestBody: false,
    enabled: true,
    schema,
  }

  const res = await fetch(url, {
    method,
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`upsert tool ${schema.name} failed: ${res.status} ${text}`)
  return JSON.parse(text) as { id: string; name: string }
}

async function main() {
  const apiKey = process.env.REVRING_API_KEY || process.env.REVRING_MASTER_API_KEY
  if (!apiKey) {
    console.error('Error: set REVRING_API_KEY or REVRING_MASTER_API_KEY')
    process.exit(1)
  }

  const vcBase = (process.env.VC_BASE_URL ?? '').replace(/\/$/, '')
  if (!vcBase) {
    console.error('Error: set VC_BASE_URL to the public base URL of this deployment (e.g. https://app.virtualcloser.com)')
    process.exit(1)
  }

  const toolSecret = process.env.REVRING_TOOL_SECRET ?? ''
  if (!toolSecret) {
    console.error('Error: REVRING_TOOL_SECRET is empty or unset.')
    console.error('Refusing to patch tools — would overwrite live RevRing tool headers with an empty')
    console.error('secret and break booking/slot-fetching for every active call.')
    console.error('')
    console.error('If you only need to update the prompt (not the tools), pass --prompt-only.')
    if (!process.argv.includes('--prompt-only')) process.exit(1)
  }

  const slotsUrl  = `${vcBase}/api/tools/revring/get-available-slots`
  const bookUrl   = `${vcBase}/api/tools/revring/book-appointment`
  const payload   = buildHealthInsuranceAgentUpdate()

  console.log('─────────────────────────────────────────────────')
  console.log('Health Insurance SDR — RevRing agent PATCH + Tools')
  console.log('─────────────────────────────────────────────────')
  console.log(`Agent ID    : ${HEALTH_INSURANCE_AGENT_ID}`)
  console.log(`Phone       : ${HEALTH_INSURANCE_AGENT_PHONE}`)
  console.log(`Slots URL   : ${slotsUrl}`)
  console.log(`Booking URL : ${bookUrl}`)
  console.log(`Tool secret : ${toolSecret ? '***set***' : 'NOT SET'}`)
  console.log(`Dry run     : ${DRY_RUN}`)
  console.log('')

  if (DRY_RUN) {
    console.log('Agent payload preview:')
    console.log(JSON.stringify({ ...payload, promptTemplate: '[...truncated...]' }, null, 2))
    console.log('\nDry run complete — no changes made.')
    return
  }

  // 1. Patch agent prompt + voice
  console.log('1/3  PATCH agent prompt...')
  const patchRes = await fetch(`${BASE}/agents/${HEALTH_INSURANCE_AGENT_ID}`, {
    method: 'PATCH',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!patchRes.ok) {
    const t = await patchRes.text()
    console.error(`Failed: HTTP ${patchRes.status}\n${t}`)
    process.exit(1)
  }
  console.log(`     → HTTP ${patchRes.status} OK`)

  // 2. Fetch existing custom tools
  console.log('2/3  Fetching existing custom tools...')
  const listRes = await fetch(`${BASE}/agents/${HEALTH_INSURANCE_AGENT_ID}/custom-tools`, {
    headers: { 'x-api-key': apiKey },
  })
  const listJson = (await listRes.json().catch(() => ({ data: [] }))) as {
    data?: { id: string; name: string }[]
  }
  const existingTools = listJson.data ?? []
  console.log(`     → found ${existingTools.length} existing tool(s): ${existingTools.map((t) => t.name).join(', ') || 'none'}`)

  // 3. Upsert both custom tools (skipped if --prompt-only or no tool secret)
  if (process.argv.includes('--prompt-only') || !toolSecret) {
    console.log('3/3  Skipping tool upsert (--prompt-only or no REVRING_TOOL_SECRET).')
  } else {
    console.log('3/3  Upserting custom tools...')
    const slots = await upsertTool(apiKey, HEALTH_INSURANCE_AGENT_ID, slotsUrl, toolSecret, GET_SLOTS_SCHEMA, existingTools)
    console.log(`     → get_available_slots : id=${slots.id}`)

    const book = await upsertTool(apiKey, HEALTH_INSURANCE_AGENT_ID, bookUrl, toolSecret, BOOK_APPT_SCHEMA, existingTools)
    console.log(`     → book_appointment    : id=${book.id}`)
  }

  console.log('\nAll done. Rachel will now check real availability and book live during the call.')
  console.log('\nReminder: ensure REVRING_TOOL_SECRET is set in your production env and matches what was used here.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
