#!/usr/bin/env tsx
/**
 * Patches the live RevRing agent with the health insurance SDR prompt,
 * Rachel voice, and demo default variables.
 *
 * Usage:
 *   REVRING_API_KEY=<key> npx tsx scripts/patch-health-insurance-agent.ts
 *   REVRING_API_KEY=<key> npx tsx scripts/patch-health-insurance-agent.ts --dry-run
 *
 * The agent ID and phone number are hardcoded in lib/voice/healthInsuranceAgent.ts.
 * After running this, set REVRING_SDR_HEALTH_INSURANCE_NUMBER=+13368108293
 * on Vercel to enable the demo for that industry on the site.
 */

import {
  HEALTH_INSURANCE_AGENT_ID,
  HEALTH_INSURANCE_AGENT_PHONE,
  buildHealthInsuranceAgentUpdate,
} from '../lib/voice/healthInsuranceAgent'

const BASE = 'https://api.revring.ai/v1'
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const apiKey = process.env.REVRING_API_KEY || process.env.REVRING_MASTER_API_KEY
  if (!apiKey) {
    console.error('Error: set REVRING_API_KEY or REVRING_MASTER_API_KEY before running.')
    process.exit(1)
  }

  const payload = buildHealthInsuranceAgentUpdate()

  console.log('─────────────────────────────────────────')
  console.log('Health Insurance SDR — RevRing agent PATCH')
  console.log('─────────────────────────────────────────')
  console.log(`Agent ID : ${HEALTH_INSURANCE_AGENT_ID}`)
  console.log(`Phone    : ${HEALTH_INSURANCE_AGENT_PHONE}`)
  console.log(`Voice    : ${payload.voiceId}`)
  console.log(`Dry run  : ${DRY_RUN}`)
  console.log('')

  if (DRY_RUN) {
    console.log('Payload preview:')
    console.log(JSON.stringify({ ...payload, promptTemplate: '[...truncated...]' }, null, 2))
    console.log('\nDry run complete — no changes made.')
    return
  }

  console.log('Sending PATCH...')
  const res = await fetch(`${BASE}/agents/${HEALTH_INSURANCE_AGENT_ID}`, {
    method: 'PATCH',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()

  if (!res.ok) {
    console.error(`\nFailed: HTTP ${res.status}`)
    console.error(text)
    process.exit(1)
  }

  console.log(`\nSuccess: HTTP ${res.status}`)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }

  console.log('\nNext step:')
  console.log(`  Set REVRING_SDR_HEALTH_INSURANCE_NUMBER=${HEALTH_INSURANCE_AGENT_PHONE} on Vercel`)
  console.log('  to enable the health insurance demo on the site.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
