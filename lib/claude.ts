import Anthropic from '@anthropic-ai/sdk'
import type { BrainItemHorizon, BrainItemType } from '@/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Two-tier model strategy. Override individually via env if needed.
// Cheap default for high-volume extraction/classification/routing.
// Premium model for outputs the rep actually reads (emails, briefings).
// Use `||` not `??` so empty-string env vars fall through to defaults.
const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
const MODEL_SMART = process.env.ANTHROPIC_MODEL_SMART || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

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
    model: MODEL_FAST,
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
    model: MODEL_SMART,
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
    model: MODEL_SMART,
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
    model: MODEL_FAST,
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
      // Optional contact-info updates — used when the rep is filling in
      // missing fields that the linked Google Sheet asked for.
      email?: string | null
      company?: string | null
      phone?: string | null
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
  | {
      kind: 'log_call'
      lead_name: string // who was the call with (best match)
      summary: string // what was discussed
      outcome?:
        | 'positive'
        | 'neutral'
        | 'negative'
        | 'no_answer'
        | 'voicemail'
        | 'booked'
        | 'closed_won'
        | 'closed_lost'
        | null
      next_step?: string | null
      duration_minutes?: number | null
    }
  | {
      kind: 'book_meeting'
      lead_name?: string | null // existing prospect, if any
      contact_name?: string | null // free-text name if not a prospect
      email?: string | null // attendee email (optional)
      start_iso: string // ISO 8601 with offset; the rep's local time if specified
      duration_minutes?: number | null // default 30
      summary: string // event title
      notes?: string | null // event description
    }
  | {
      kind: 'set_target'
      period_type: 'day' | 'week' | 'month' | 'quarter' | 'year'
      metric: 'calls' | 'conversations' | 'meetings_booked' | 'deals_closed' | 'revenue' | 'custom'
      target_value: number
      notes?: string | null
    }
  | {
      kind: 'report'
      report_type:
        | 'pipeline'
        | 'today'
        | 'week'
        | 'calendar'
        | 'goals'
        | 'metrics'
        | 'lead_history' // history for a specific lead
      lead_name?: string | null // only for lead_history
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
    model: MODEL_FAST,
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

    // Update an existing prospect (status, append a note, mark just-contacted, fill in contact info)
    { "kind": "update_lead", "lead_name": "name or company matching an existing lead", "status": "hot|warm|cold|dormant|null", "note": "append this note or null", "mark_contacted": true or false, "email": "email or null", "company": "company or null", "phone": "phone or null" },

    // Schedule a follow-up action tied to a lead (creates a task with due_date)
    { "kind": "schedule_followup", "lead_name": "existing prospect name", "due_date": "YYYY-MM-DD", "content": "short action", "priority": "low|normal|high" },

    // Generic task/goal/idea/plan/note not tied to a specific lead
    { "kind": "brain_item", "item_type": "task|goal|idea|plan|note", "content": "short phrasing", "priority": "low|normal|high", "horizon": "day|week|month|quarter|year|none", "due_date": "YYYY-MM-DD or null" },

    // Log a phone/zoom conversation that already happened. Attach to a lead if possible.
    { "kind": "log_call", "lead_name": "matched prospect", "summary": "what was discussed in 1-3 sentences", "outcome": "positive|neutral|negative|no_answer|voicemail|booked|closed_won|closed_lost|null", "next_step": "what's next or null", "duration_minutes": 0 },

    // Book a calendar meeting (Google Calendar). Use the rep's stated time.
    { "kind": "book_meeting", "lead_name": "existing prospect or null", "contact_name": "free-text name or null", "email": "attendee email or null", "start_iso": "YYYY-MM-DDTHH:MM:SS-05:00 (include offset; assume rep's local timezone if not specified)", "duration_minutes": 30, "summary": "Meeting title", "notes": "agenda or null" },

    // Define a measurable goal/target with progress tracking
    { "kind": "set_target", "period_type": "day|week|month|quarter|year", "metric": "calls|conversations|meetings_booked|deals_closed|revenue|custom", "target_value": 50, "notes": "optional context" },

    // Ask for a summary/report (the bot will fetch data and respond)
    { "kind": "report", "report_type": "pipeline|today|week|calendar|goals|metrics|lead_history", "lead_name": "only for lead_history, else null" },

    // If they're only asking a question or small-talking, reply directly
    { "kind": "question", "reply": "short conversational answer" }
  ],
  "reply_hint": "optional short conversational confirmation to send back"
}

Routing rules:
- "Add/new prospect/lead X at Y" → add_lead
- "X is hot/warm/cold/dead" or "mark X as dormant" → update_lead with status
- "Talked to X / X just called / called X" with no further detail → update_lead with mark_contacted=true
- "Dana's email is x@y.com" / "Ben's phone is 555-1234" / "Acme is the company for Dana" → update_lead with the relevant field (email/phone/company) set. These are info fill-ins, not status changes.
- BUT: if they describe what was discussed ("just got off with Dana, she wants pricing", "Ben said budget is tight, told him I'd resend the deck") → log_call (NOT update_lead). Always extract a clean summary.
- "Follow up with X on Thursday" / "call X next week" → schedule_followup with due_date resolved to an ISO date
- "Book a call with X Thursday at 3pm" / "schedule a meeting with X tomorrow at 10" → book_meeting (use today + offset; if no timezone given, assume rep's local time and emit a -05:00 offset by default)
- "Goal: X / target: X / I want to do X this week/month" with a number → set_target. Pick the closest metric. If the goal is qualitative ("close more deals", no number), use brain_item with item_type=goal instead.
- "What's my pipeline / how am I doing / show me today / what's on my calendar / how close am I to my goal / how many calls this week" → report (pick the right report_type). lead_history if they ask about a specific person ("show me history with Dana", "what did I last say to Ben").
- "Remind me to …" / generic ideas / unmeasurable goals → brain_item
- One message can produce multiple intents (e.g. "just talked to Dana, she's hot, follow up Thursday about pricing" → log_call + update_lead status hot + schedule_followup)
- If the rep references a prospect by first name only and it uniquely matches the list above, use the full matched name
- Infer priority from urgency language (urgent/asap/today = high)
- Dates: "today" = ${today}, "tomorrow" = next day, "Thursday" = next Thursday from today, etc.
- For book_meeting times: if the rep says "3pm" with no timezone, assume their local time and pick a reasonable -05:00 offset (we'll fix it server-side).
- If the message is purely conversational ("hey", "thanks", "what's up"), emit a single "question" intent and nothing else`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<TelegramInterpretation>(text, { intents: [] })
  const intents = Array.isArray(parsed.intents) ? parsed.intents.filter(Boolean) : []
  return { intents, reply_hint: parsed.reply_hint }
}
// ── Coach / report generators ─────────────────────────────────────────────

/**
 * Turn structured data into a short, plain-text Telegram-ready summary.
 * Always returns a non-empty string.
 */
export async function generateReport(
  reportType: string,
  data: unknown,
  repName: string,
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL_SMART,
      max_tokens: 600,
      system: buildRepContext(repName),
      messages: [
        {
          role: 'user',
          content: `Write a brief Telegram-ready ${reportType} update for the rep.
- Plain text. No headers. Use emojis sparingly.
- Bullets OK (start lines with "•"). Keep it under 12 lines.
- Sound like a sharp sales coach giving them the picture.
- Call out what to focus on next.

Data (JSON):
${JSON.stringify(data, null, 2)}`,
        },
      ],
    })
    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return text.trim() || 'No data to report yet.'
  } catch (err) {
    console.error('[claude] generateReport failed', err)
    return 'I had trouble drafting that update. Try again in a minute.'
  }
}

/**
 * Generate a proactive coach prompt (Monday weekly check-in, end-of-month review, daily pulse).
 * `kind` describes what we're nudging about; `data` is the supporting context.
 */
export async function generateCoachPrompt(
  kind: 'weekly_kickoff' | 'monthly_review' | 'daily_pulse',
  data: unknown,
  repName: string,
): Promise<string> {
  const intent =
    kind === 'weekly_kickoff'
      ? "It's Monday morning. Ask the rep what their targets are for the week (calls, conversations, meetings booked, deals to close) and what's hanging over from last week. Be motivating, not corporate."
      : kind === 'monthly_review'
        ? "It's the last business day of the month. Ask the rep to lock in their plans + goals for next month. Reference any active monthly targets they hit/missed. Push them to set sharper numbers."
        : "It's late afternoon. Pulse-check the rep on the day's activity: how many calls, how many conversations, anything important to log before they shut down. Be quick."

  try {
    const response = await anthropic.messages.create({
      model: MODEL_SMART,
      max_tokens: 350,
      system: buildRepContext(repName),
      messages: [
        {
          role: 'user',
          content: `${intent}

Context (JSON):
${JSON.stringify(data, null, 2)}

Write a short, friendly Telegram message — 2-5 sentences, plain text, ask 1-2 clear questions. Reference the rep by first name if possible.`,
        },
      ],
    })
    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return text.trim() || `Quick check-in, ${repName} — how's the day looking?`
  } catch (err) {
    console.error('[claude] generateCoachPrompt failed', err)
    return `Quick check-in, ${repName} — how's the day looking?`
  }
}
