import Anthropic from '@anthropic-ai/sdk'
import type { BrainItemHorizon, BrainItemType } from '@/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function buildRepContext(repName?: string): string {
  const name = repName ?? process.env.REP_NAME ?? 'the sales rep'
  return `
You are the Virtual Closer - an AI sales assistant for ${name}.
Your job is to help them close more deals by analyzing their leads, drafting
outreach, and flagging what needs attention. Be direct, practical, and sound
like a knowledgeable sales coach - not a robot.
`.trim()
}

const REP_CONTEXT = buildRepContext()

type LeadClassificationResult = {
  status: 'hot' | 'warm' | 'cold' | 'dormant'
  reason: string
}

function parseJsonResponse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as T
  } catch {
    return fallback
  }
}

export async function classifyLead(lead: {
  name: string
  company: string
  lastContact: string | null
  notes: string
  emailHistory?: string
}): Promise<LeadClassificationResult> {
  const daysSinceContact = lead.lastContact
    ? Math.floor((Date.now() - new Date(lead.lastContact).getTime()) / 86400000)
    : 999

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: REP_CONTEXT,
    messages: [
      {
        role: 'user',
        content: `Classify this lead. Respond ONLY with JSON: {"status":"hot|warm|cold|dormant","reason":"one sentence"}

Lead: ${lead.name} at ${lead.company}
Days since last contact: ${daysSinceContact}
Notes: ${lead.notes || 'none'}
Email history: ${lead.emailHistory || 'none'}

Rules:
- hot = buying signals, recent engagement, active conversation
- warm = interested but not urgent, <14 days since contact
- cold = no recent engagement, 14-30 days out
- dormant = no contact 30+ days, deal likely stalled`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  return parseJsonResponse<LeadClassificationResult>(text, {
    status: 'cold',
    reason: 'Fallback classification due to parsing error',
  })
}

export async function draftFollowUp(lead: {
  name: string
  company: string
  status: string
  notes: string
  lastContact: string | null
}): Promise<{ subject: string; body: string }> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: REP_CONTEXT,
    messages: [
      {
        role: 'user',
        content: `Draft a follow-up email for this ${lead.status} lead.
Respond ONLY with JSON: {"subject":"...","body":"..."}

Lead: ${lead.name} at ${lead.company}
Status: ${lead.status}
Notes: ${lead.notes || 'none'}
Last contact: ${lead.lastContact || 'unknown'}

Guidelines:
- Keep it under 5 sentences
- No fluff, no "I hope this email finds you well"
- Sound like a real human sales rep
- Reference specific context from notes if available
- For dormant leads: acknowledge the gap, offer new value`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  return parseJsonResponse<{ subject: string; body: string }>(text, {
    subject: `Quick follow-up for ${lead.company || lead.name}`,
    body: `Hi ${lead.name},\n\nWanted to follow up based on our previous conversation. If priorities have shifted, I can share a shorter path forward tailored to your current goals.\n\nBest,`,
  })
}

export async function generateMorningBriefing(summary: {
  hotCount: number
  warmCount: number
  dormantCount: number
  topLeads: Array<{ name: string; company: string; status: string; reason: string }>
}): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: REP_CONTEXT,
    messages: [
      {
        role: 'user',
        content: `Write a short morning briefing for ${process.env.REP_NAME}.
Plain text, 3-5 sentences, no headers or bullets.

Data:
- Hot leads: ${summary.hotCount}
- Warm leads: ${summary.warmCount}
- Dormant leads needing attention: ${summary.dormantCount}
- Top priority leads: ${summary.topLeads
          .map((l) => `${l.name} (${l.company}) - ${l.reason}`)
          .join('; ')}

Sound like a sharp sales coach giving a quick morning standup.`,
      },
    ],
  })

  return response.content[0]?.type === 'text' ? response.content[0].text : ''
}

export type ExtractedBrainItem = {
  item_type: BrainItemType
  content: string
  priority: 'low' | 'normal' | 'high'
  horizon: BrainItemHorizon
  due_date: string | null
}

export type BrainDumpAnalysis = {
  summary: string
  items: ExtractedBrainItem[]
}

/**
 * Turn a raw transcript into a short summary + a structured list of
 * tasks / goals / ideas / plans / notes.
 */
export async function extractBrainDump(
  rawText: string,
  repName?: string
): Promise<BrainDumpAnalysis> {
  const today = new Date().toISOString().slice(0, 10)

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    system: buildRepContext(repName),
    messages: [
      {
        role: 'user',
        content: `The rep just spoke the following brain dump (today is ${today}):

"""
${rawText}
"""

Extract a structured breakdown. Respond ONLY with JSON in this exact shape:

{
  "summary": "one or two sentence summary",
  "items": [
    {
      "item_type": "task|goal|idea|plan|note",
      "content": "short, actionable phrasing",
      "priority": "low|normal|high",
      "horizon": "day|week|month|quarter|year|none",
      "due_date": "YYYY-MM-DD or null"
    }
  ]
}

Rules:
- task = concrete action to execute
- goal = outcome they want to hit (usually has a horizon)
- plan = sequence of steps or strategy
- idea = something to explore later
- note = context or observation, no action
- If they say "this week" set horizon="week"; "this month" = "month", etc.
- Infer priority from urgency language ("urgent", "asap" = high).
- due_date only if they specify one. Otherwise null.
- Keep each content line under ~140 chars, clean and specific.`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<BrainDumpAnalysis>(text, { summary: '', items: [] })

  // Defensive: ensure items is an array of valid shapes.
  const items = Array.isArray(parsed.items)
    ? parsed.items.filter(
        (i) =>
          i &&
          typeof i.content === 'string' &&
          ['task', 'goal', 'idea', 'plan', 'note'].includes(i.item_type)
      )
    : []

  return { summary: parsed.summary ?? '', items }
}

// ── Telegram natural-language command router ──────────────────────────────

export type TelegramIntent =
  | {
      kind: 'add_lead'
      name: string
      company?: string | null
      email?: string | null
      status?: 'hot' | 'warm' | 'cold' | 'dormant'
      note?: string | null
    }
  | {
      kind: 'update_lead'
      lead_name: string
      status?: 'hot' | 'warm' | 'cold' | 'dormant' | null
      note?: string | null
      mark_contacted?: boolean
    }
  | {
      kind: 'schedule_followup'
      lead_name: string
      due_date: string // YYYY-MM-DD
      content: string // "Call Dana about pricing"
      priority?: 'low' | 'normal' | 'high'
    }
  | {
      kind: 'brain_item'
      item_type: BrainItemType
      content: string
      priority?: 'low' | 'normal' | 'high'
      horizon?: BrainItemHorizon
      due_date?: string | null
    }
  | { kind: 'question'; reply: string }

export type TelegramInterpretation = {
  intents: TelegramIntent[]
  reply_hint?: string
}

export async function interpretTelegramMessage(
  rawText: string,
  repName: string,
  knownLeads: Array<{ name: string; company: string | null; status: string }>,
): Promise<TelegramInterpretation> {
  const today = new Date().toISOString().slice(0, 10)
  const leadList = knownLeads
    .slice(0, 30)
    .map((l) => `- ${l.name}${l.company ? ` (${l.company})` : ''} [${l.status}]`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: buildRepContext(repName),
    messages: [
      {
        role: 'user',
        content: `The rep just sent you this message over Telegram (today is ${today}):

"""
${rawText}
"""

Their existing prospects (for name matching — reuse these if they're clearly the same person):
${leadList || '(no leads yet)'}

You are their operations brain. Translate the message into a list of concrete actions.
Respond ONLY with JSON in this exact shape:

{
  "intents": [
    // zero or more of the following objects:

    // Add a new prospect to the CRM
    { "kind": "add_lead", "name": "Full Name", "company": "Acme or null", "email": "a@b.com or null", "status": "hot|warm|cold|dormant", "note": "context or null" },

    // Update an existing prospect (status, append a note, mark just-contacted)
    { "kind": "update_lead", "lead_name": "name or company matching an existing lead", "status": "hot|warm|cold|dormant|null", "note": "append this note or null", "mark_contacted": true or false },

    // Schedule a follow-up action tied to a lead (creates a task with due_date)
    { "kind": "schedule_followup", "lead_name": "existing prospect name", "due_date": "YYYY-MM-DD", "content": "short action", "priority": "low|normal|high" },

    // Generic task/goal/idea/plan/note not tied to a specific lead
    { "kind": "brain_item", "item_type": "task|goal|idea|plan|note", "content": "short phrasing", "priority": "low|normal|high", "horizon": "day|week|month|quarter|year|none", "due_date": "YYYY-MM-DD or null" },

    // If they're only asking a question or small-talking, reply directly
    { "kind": "question", "reply": "short conversational answer" }
  ],
  "reply_hint": "optional short conversational confirmation to send back"
}

Routing rules:
- "Add/new prospect/lead X at Y" → add_lead
- "X is hot/warm/cold/dead" or "mark X as dormant" → update_lead with status
- "Talked to X / X just called / called X" → update_lead with mark_contacted=true and a note if context given
- "Follow up with X on Thursday" / "call X next week" → schedule_followup with due_date resolved to an ISO date
- "Remind me to …" / generic goals / ideas → brain_item
- One message can produce multiple intents (e.g. "just talked to Dana, she's hot, follow up Thursday about pricing" → update_lead + schedule_followup)
- If the rep references a prospect by first name only and it uniquely matches the list above, use the full matched name
- Infer priority from urgency language (urgent/asap/today = high)
- Dates: "today" = ${today}, "tomorrow" = next day, "Thursday" = next Thursday from today, etc.
- If the message is purely conversational ("hey", "thanks", "what's up"), emit a single "question" intent and nothing else`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<TelegramInterpretation>(text, { intents: [] })
  const intents = Array.isArray(parsed.intents) ? parsed.intents.filter(Boolean) : []
  return { intents, reply_hint: parsed.reply_hint }
}