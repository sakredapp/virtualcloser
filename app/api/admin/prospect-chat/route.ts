import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getProspect } from '@/lib/prospects'

export const maxDuration = 60
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL =
  process.env.ANTHROPIC_MODEL_SMART || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

const SYSTEM = `You are a build consultant for Virtual Closer — a Telegram-native AI sales assistant platform. You help the founder ideate and plan custom builds for specific prospects.

## Virtual Closer Stack
- **Telegram bot** (primary interface): voice notes, text commands, AI-powered intent parsing + responses
- **Next.js 14 dashboard** (web UI for clients): activity feed, goals, roleplay, team, integrations
- **Supabase** (Postgres + Storage, fully multi-tenant, scoped by rep_id)
- **Claude AI** (Anthropic): all intelligence — intent classification, content generation, coaching
- **Vercel** hosting

## Available Integrations (configurable per client)

### Core (always included)
- **Cal.com** — booking webhook → auto-creates prospect record in VC
- **Google** (Calendar, Gmail, Drive) — OAuth sync for meetings + emails
- **Fathom / Fireflies** — meeting transcript ingestion for coaching

### iMessage via BlueBubbles
- Client installs BlueBubbles app on their MacBook, enables cloud relay
- Stored in client config: \`bluebubbles_url\` + \`bluebubbles_password\`
- Bot can **SEND + RECEIVE** iMessages from the client's own Apple ID
- Best for: US-based reps who already text leads from their personal iPhone/Mac
- Limitations: Mac must be on during business hours; works on Apple silicon or Intel Mac
- Setup effort: ~30 min (install, sign in with Apple ID, enable cloud relay, share URL)
- No extra monthly cost beyond the Mac being on

### GoHighLevel CRM
- Connect client's existing GHL account (or set up new white-label)
- Stored in client config: \`ghl_api_key\` + \`ghl_location_id\`
- Bot can: look up contacts, create/update contacts, move pipeline stages, log notes
- Best for: clients already on GHL or wanting a full CRM pipeline integrated
- Setup effort: ~15 min (API key from GHL settings)

### Other CRMs
- HubSpot, Pipedrive, Salesforce — via Zapier webhook or direct API

## Client Tiers
- **Individual** ($50/mo): single rep, core bot, Cal.com + Google integrations, all standard CRM integrations
- **Enterprise** (custom): multi-rep, team dashboard, shared pipeline, leaderboards, custom API + webhook builds

## Your Role
You are talking directly to the founder who is planning this client's build. Help them think through:
1. Which integrations fit this specific client's workflow (ask about their tech stack)
2. What the Telegram bot should do day-to-day for them
3. Build complexity and what's custom vs out-of-the-box
4. Any setup gotchas specific to their situation

When generating setup checklists or onboarding instructions, **only include steps for the features listed in the Selected Features section** of the prospect context below. Do not mention or include setup steps for features that are NOT selected. If no features are listed, ask which features to include before generating a checklist.

Keep answers practical and concise. Ask one clarifying question at a time if needed.`

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { prospectId: string; messages: ChatMessage[] }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { prospectId, messages } = body

  if (!prospectId || typeof prospectId !== 'string') {
    return new Response('prospectId required', { status: 400 })
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('messages array required', { status: 400 })
  }

  const prospect = await getProspect(prospectId)
  if (!prospect) {
    return new Response('Prospect not found', { status: 404 })
  }

  const contextBlock = [
    `## Prospect: ${prospect.name ?? 'Unknown'}`,
    prospect.company ? `Company: ${prospect.company}` : null,
    prospect.email ? `Email: ${prospect.email}` : null,
    prospect.phone ? `Phone: ${prospect.phone}` : null,
    prospect.tier_interest ? `Tier interest: ${prospect.tier_interest}` : null,
    prospect.meeting_at
      ? `Meeting: ${new Date(prospect.meeting_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : null,
    prospect.notes ? `\nBooking notes:\n${prospect.notes}` : null,
    prospect.build_brief ? `\nBuild brief:\n${prospect.build_brief}` : null,
    prospect.build_summary ? `\nAI-generated build summary:\n${prospect.build_summary}` : null,
    (() => {
      const features = prospect.selected_features ?? []
      if (features.length === 0) return '\n**Selected Features:** _(none selected yet — ask the admin which integrations to build before generating a checklist)_'
      return `\n**Selected Features for this build:**\n${features.map((k: string) => `- ${k}`).join('\n')}\n\nOnly generate setup steps / checklists for these features.`
    })(),
  ]
    .filter(Boolean)
    .join('\n')

  const systemWithContext = `${SYSTEM}\n\n---\n\n${contextBlock}`

  // Sanitise messages: valid roles only, cap at last 20
  const validMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }))
    .slice(-20)

  if (validMessages.length === 0 || validMessages[0].role !== 'user') {
    return new Response('First message must be from user', { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 2000,
          system: systemWithContext,
          messages: validMessages,
          stream: true,
        })
        for await (const event of response) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } catch (err) {
        console.error('[prospect-chat] Claude error:', err)
        controller.enqueue(
          new TextEncoder().encode('\n\n[Error generating response. Please try again.]'),
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
