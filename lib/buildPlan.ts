// Generate a Virtual Closer build plan for a prospect from a call
// transcript. Uses Claude Sonnet — quality matters here, the output
// gets reviewed by the admin and shared with the customer.

import Anthropic from '@anthropic-ai/sdk'
import type { FathomMeeting } from './fathom'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'

export type BuildPlan = {
  summary: string                        // 2-3 sentence executive summary
  brief: string                          // detailed brief covering pain, ICP, goals
  plan: string                           // markdown — recommended build (modules, integrations, AI config)
  cost_estimate_usd: number | null       // monthly recurring estimate
  setup_fee_estimate_usd: number | null  // one-time build fee estimate
  selected_features: string[]            // feature key tags
  open_questions: string[]               // things not clear from the call that admin should follow up on
}

const FEATURE_KEYS = [
  'sdr_outbound', 'sdr_inbound', 'trainer_roleplay', 'fathom', 'wavv', 'bluebubbles',
  'ghl', 'hubspot', 'pipedrive', 'salesforce', 'white_label', 'team_leaderboard',
  'custom_integration', 'live_transfer', 'workflow_automation',
] as const

const SYSTEM_PROMPT = `You are an expert Virtual Closer sales engineer. You read a call transcript with a prospect and write a custom build plan for them.

Virtual Closer is an AI sales suite. Modules:
- AI SDR: outbound dialer, books meetings, voicemail drop. Per-rep, weekly hours.
- AI Trainer: roleplay coach for reps. Per-rep, weekly hours.
- AI Receptionist: answers inbound calls.
- CRM integrations: GoHighLevel, HubSpot, Pipedrive, Salesforce.
- Add-ons: WAVV (dialer KPI), Fathom (call intelligence), BlueBubbles (iMessage), white-label, team leaderboard.
- One-time build fee: $2,000 individual, $400/rep enterprise (under 25), $350/rep (25-49), $300/rep (50-99), $200/rep (100+).
- Weekly billing for the recurring side. Hour packs at $4.15-$6/hr depending on volume tier.

You output STRICT JSON matching this schema (no markdown, no commentary outside JSON):
{
  "summary": "2-3 sentence executive summary",
  "brief": "detailed brief: who they are, what they sell, current pain, team size, goals",
  "plan": "markdown — recommended build, what we configure, integrations, AI persona/script direction",
  "cost_estimate_usd": <monthly recurring number or null>,
  "setup_fee_estimate_usd": <one-time number or null>,
  "selected_features": [<list of feature keys from: ${FEATURE_KEYS.join(', ')}>],
  "open_questions": [<list of strings — things not clear from the call>]
}`

export async function generateBuildPlanFromMeeting(meeting: FathomMeeting): Promise<BuildPlan | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[buildPlan] ANTHROPIC_API_KEY not set, skipping')
    return null
  }

  const transcript = (meeting.transcript ?? '').slice(0, 60_000)   // cap to keep tokens reasonable
  const summary = meeting.summary ?? ''

  if (!transcript && !summary) {
    console.warn('[buildPlan] no transcript or summary on meeting, cannot generate plan')
    return null
  }

  const userPrompt = [
    `Meeting title: ${meeting.title ?? '(untitled)'}`,
    meeting.startedAt ? `Date: ${meeting.startedAt}` : '',
    meeting.attendees.length > 0
      ? `Attendees: ${meeting.attendees.map((a) => `${a.name ?? '?'} <${a.email ?? '?'}>`).join(', ')}`
      : '',
    summary ? `\nFathom AI summary:\n${summary}` : '',
    transcript ? `\nTranscript:\n${transcript}` : '',
    meeting.actionItems && meeting.actionItems.length > 0
      ? `\nFathom action items:\n- ${meeting.actionItems.join('\n- ')}`
      : '',
    `\nReturn the JSON build plan now.`,
  ].filter(Boolean).join('\n')

  let raw: string
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const block = response.content[0]
    if (block?.type !== 'text') {
      console.warn('[buildPlan] non-text response from Claude')
      return null
    }
    raw = block.text
  } catch (err) {
    console.error('[buildPlan] Claude call failed', err)
    return null
  }

  // Claude sometimes wraps JSON in ```json fences — strip them.
  const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as BuildPlan
    return {
      summary: parsed.summary ?? '',
      brief: parsed.brief ?? '',
      plan: parsed.plan ?? '',
      cost_estimate_usd: parsed.cost_estimate_usd ?? null,
      setup_fee_estimate_usd: parsed.setup_fee_estimate_usd ?? null,
      selected_features: Array.isArray(parsed.selected_features) ? parsed.selected_features : [],
      open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
    }
  } catch (err) {
    console.error('[buildPlan] JSON parse failed', err, '\nraw:', raw.slice(0, 500))
    return null
  }
}
