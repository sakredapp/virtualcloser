import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getProspect, updateProspect } from '@/lib/prospects'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_MODEL_SMART || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

const SYSTEM = `You are a senior technical project manager and solutions architect for Virtual Closer, a Telegram-native AI sales assistant platform. You help the founder plan custom builds for new clients.

Virtual Closer's core stack:
- Telegram bot as the primary interface (voice notes + text)
- Next.js dashboard (web)
- Supabase (Postgres + Storage)
- Claude AI (Anthropic) for intelligence
- Integrations: HubSpot, Pipedrive, Cal.com, Zapier, Google (Calendar / Gmail / Drive), Fathom, Fireflies, Stripe
- Tiers: Salesperson ($50/mo) · Team Builder (custom) · Executive (custom)

When given a build brief, produce a structured JSON plan with:
1. A clear phased build plan in markdown
2. Honest cost estimates (build hours × $150/hr typical, maintenance = infra + AI tokens + support time)
3. Integrations required
4. Suggested tier/config

Respond ONLY with valid JSON matching this exact shape:
{
  "summary": "2-3 sentence plain-English summary of what this client gets",
  "plan": "Full markdown build plan with ## Phase headers, bullet points, deliverables",
  "integrations": ["list", "of", "integration", "names"],
  "build_cost": 3500,
  "maintenance_cost": 150,
  "cost_reasoning": "Brief breakdown: build hours × rate + what drives monthly cost",
  "suggested_tier": "salesperson | team_builder | executive",
  "timeline_weeks": 3
}`

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { prospectId: string; buildBrief: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { prospectId, buildBrief } = body
  if (!prospectId || typeof prospectId !== 'string') {
    return NextResponse.json({ error: 'prospectId required' }, { status: 400 })
  }
  if (!buildBrief || typeof buildBrief !== 'string' || buildBrief.trim().length < 10) {
    return NextResponse.json({ error: 'buildBrief too short' }, { status: 400 })
  }

  const prospect = await getProspect(prospectId)
  if (!prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
  }

  const contextLines = [
    `Name: ${prospect.name ?? 'unknown'}`,
    `Company: ${prospect.company ?? 'unknown'}`,
    `Email: ${prospect.email ?? 'unknown'}`,
    `Tier interest: ${prospect.tier_interest ?? 'not specified'}`,
    `Meeting date: ${prospect.meeting_at ?? 'not booked'}`,
    prospect.notes ? `Notes from booking: ${prospect.notes}` : null,
    prospect.build_plan ? `\nPrevious plan (regenerating):\n${prospect.build_plan}` : null,
  ].filter(Boolean).join('\n')

  const userMessage = `Prospect context:\n${contextLines}\n\nWhat they want built:\n${buildBrief.trim()}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''

  let parsed: {
    summary: string
    plan: string
    integrations: string[]
    build_cost: number
    maintenance_cost: number
    cost_reasoning: string
    suggested_tier: string
    timeline_weeks: number
  }
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
  } catch {
    return NextResponse.json({ error: 'AI returned unparseable response', raw }, { status: 502 })
  }

  await updateProspect(prospectId, {
    build_brief: buildBrief.trim(),
    build_plan: parsed.plan,
    build_summary: parsed.summary,
    build_cost_estimate: parsed.build_cost ?? null,
    maintenance_estimate: parsed.maintenance_cost ?? null,
    plan_generated_at: new Date().toISOString(),
    ...(parsed.suggested_tier && !prospect.tier_interest
      ? { tier_interest: parsed.suggested_tier }
      : {}),
  })

  return NextResponse.json({
    summary: parsed.summary,
    plan: parsed.plan,
    integrations: parsed.integrations ?? [],
    build_cost: parsed.build_cost,
    maintenance_cost: parsed.maintenance_cost,
    cost_reasoning: parsed.cost_reasoning,
    suggested_tier: parsed.suggested_tier,
    timeline_weeks: parsed.timeline_weeks,
  })
}
