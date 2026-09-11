#!/usr/bin/env tsx
/**
 * Provisions the RevRing agents for the roleplay APPLICATION-MODE scenarios
 * (the applicant personas with hidden answer sheets).
 *
 * Usage:
 *   REVRING_API_KEY=<key> npx tsx scripts/provision-roleplay-applicant-agents.ts
 *   Add --dry-run to print the payloads without creating anything.
 *
 * For each scenario in APPLICATION_SCENARIOS this creates a RevRing agent
 * whose system prompt is the applicant persona (built from the profile's
 * answer sheet + the carrier overlay), then prints:
 *
 *   1. the new agent id  → set <scenario.idEnv> on Vercel
 *   2. a reminder to attach a phone number in RevRing → Agents → Phone
 *      Numbers, and set <scenario.numberEnv> to that E.164 number
 *
 * The floor shows an application scenario only once its *_NUMBER env var is
 * set, so nothing goes live until both steps are done.
 */

import { APPLICATION_SCENARIOS } from '../lib/roleplay-engine'
import {
  CARRIER_OVERLAYS,
  getApplicantProfile,
  buildApplicantAgentPrompt,
} from '../lib/roleplay-application'

const BASE = 'https://api.revring.ai/v1'
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const apiKey = process.env.REVRING_API_KEY
  if (!apiKey && !DRY_RUN) {
    console.error('REVRING_API_KEY is required (or pass --dry-run).')
    process.exit(1)
  }

  for (const scenario of APPLICATION_SCENARIOS) {
    const profile = getApplicantProfile(scenario.profileKey)
    if (!profile) {
      console.error(`✗ ${scenario.key}: profile ${scenario.profileKey} not found`)
      continue
    }
    const carrier = CARRIER_OVERLAYS[scenario.carrier]
    const prompt = buildApplicantAgentPrompt(profile, carrier)

    const payload = {
      name: `VC Roleplay — ${scenario.name}`,
      prompt,
      // Keep the applicant from monologuing; application calls are Q&A.
      firstMessage: 'Hello?',
    }

    if (DRY_RUN) {
      console.log(`\n── ${scenario.key} (${carrier.carrier}) ─ dry run ──`)
      console.log(payload.name)
      console.log(prompt.slice(0, 600) + '…')
      continue
    }

    const res = await fetch(`${BASE}/agents`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey!, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error(`✗ ${scenario.key}: HTTP ${res.status} — ${await res.text().catch(() => '')}`)
      continue
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; data?: { id?: string } }
    const id = json.data?.id || json.id
    console.log(`✓ ${scenario.key}: agent ${id}`)
    console.log(`  → vercel env add ${scenario.idEnv}      (value: ${id})`)
    console.log(`  → attach a phone number in RevRing, then: vercel env add ${scenario.numberEnv}`)
  }
}

void main()
