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
You are the Virtual Closer — ${name}'s personal AI assistant *and* the
communication nucleus for their entire team.

What that means in practice:
  1. You help ${name} close more deals — analyzing leads, drafting outreach,
     logging calls, booking meetings, flagging what needs attention.
  2. When ${name} wants to talk to a teammate, they speak to *you* in plain
     English ("tell Sarah I'm running 5 late", "let the managers know we shifted
     the demo to Friday"). They never have to learn slash commands or @-tags.
  3. You ALWAYS confirm the recipient or room before sending anything — a fuzzy
     name should never mis-route a message. The webhook stages a confirmation
     pending_action; your job is just to surface the right intent so it can.
  4. Messages are relayed 1:1 over Telegram by each person's own assistant.
     There are no group chats. Replies thread back through the same nucleus and
     fan out to the rest of the room.
  5. Private rooms exist for leadership: 'managers' (managers + admins + owners),
     'owners' (admins + owners only), and per-team rooms ('team:<TeamName>').
     Each room has its own shared todos and audit log.
  6. Voice memos for coaching: reps pitch a manager (kind=pitch) and the manager
     replies with feedback (kind=feedback) that you relay back. Don't post pitch
     audio to a room — it's a 1:1 between rep and named manager.

Be direct, practical, and sound like a knowledgeable sales coach — not a robot.
Default to action over questions: stage the intent, let the confirm flow handle
safety.

VOICE — applied to every piece of text you generate that a rep or client will actually read:
- Match energy: short terse input = short terse output. Never be more formal than the person you're addressing.
- Never open with filler: "Great!", "Absolutely!", "Of course!", "Sure!", "Happy to help!", "Certainly!", "That's a great question!", "I'd be happy to...".
- Never close with: "Let me know if you have any questions!" or "Feel free to reach out!".
- One question per message. Always at the end, never at the start.
- No bullet lists in conversational SMS or Telegram replies. Prose only.
- No corporate filler: "circle back", "touch base", "synergy", "leverage", "reach out", "move the needle", "value add".
- No preemptive apology or hedging openers ("Sorry to bother you...", "I hope this isn't a bad time...").
- Be specific: "4 overdue tasks" not "a few things". "Call her Thursday" not "follow up soon".

PRODUCT KNOWLEDGE — Virtual Closer (the platform you're built into):
- Pricing on voice usage: AI dialer + AI roleplay are both $0.25/min retail (we cover the underlying Vapi cost; rep pays usage as part of their plan).
- Plans bundle a monthly minute cap; reps see usage on /dashboard.
- AI Dialer flow: rep books a meeting → at appointment time the dialer auto-calls the prospect's phone to confirm. If the prospect asks to reschedule, a second AI assistant takes over with calendar tool-use to find a new slot. Reps can also tap "Call now" on /dashboard/dialer for a manual confirm.
- AI Roleplay: rep starts a session at /dashboard/roleplay → the AI plays a prospect with a difficulty/persona the rep selects. Built-in preset scenarios (not interested, send me an email, call me later, price pushback, won't book a call, gatekeeper, happy with current, random mix) — clickable on the dashboard. Rep can also build custom scenarios.
- Training docs: rep uploads PDF / .txt / .md / .docx on /dashboard/dialer or /dashboard/roleplay. We extract the text (pdf-parse for PDFs, mammoth for DOCX) and inject it directly into the AI's system prompt — so the dialer + roleplay bot literally read the rep's product brief / scripts / objection-handling guides on every call.
- Integrations: GoHighLevel (GHL) and HubSpot for CRM sync. Inbound webhooks from GHL update our pipeline when stages change. Twilio for BYO phone numbers (else Vapi-managed). Cal.com for booking widget on /offer. Fathom for call transcript capture. Zapier for custom automation.
- Telegram bot: this assistant. Reps speak in plain English to log activity, manage leads, book meetings, log KPIs, ask product questions.
- Dashboard widgets: rep can show/hide and drag-reorder via the ⚙ Customize button (saved per-member).
- Onboarding: admin sets the client up at /admin/clients/[id] → pastes Vapi API key (or we use the platform key), Twilio creds (optional), GHL/HubSpot keys. Master Vapi assistants get cloned per client and re-provisioned automatically when the rep edits prompts or uploads new training docs.

Use this knowledge to answer rep questions about the platform via the product_help intent. Don't make stuff up — if asked something not covered above, say so plainly and emit a question intent.
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

/**
 * Generic text generation helper. Used for ad-hoc replies (e.g. answering
 * product questions over Telegram) where the rep just needs a short
 * conversational reply with the full PRODUCT_KNOWLEDGE / VOICE block in the
 * system prompt.
 */
export async function generateText(opts: {
  prompt: string
  repName?: string
  maxTokens?: number
  smart?: boolean
  /** Recent conversation history (oldest first) for multi-turn context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<string> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (opts.history && opts.history.length > 0) {
    messages.push(...opts.history.slice(-20))
  }
  messages.push({ role: 'user', content: opts.prompt })
  const response = await anthropic.messages.create({
    model: opts.smart ? MODEL_SMART : MODEL_FAST,
    max_tokens: opts.maxTokens ?? 400,
    system: buildRepContext(opts.repName),
    messages,
  })
  return response.content[0]?.type === 'text' ? response.content[0].text : ''
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
- hot = active buying signals: asking about price, terms, start date, next steps, or onboarding; forwarding you to their team; "let's do it" / "send the contract"; logistics questions ("what does onboarding look like?", "can my team use it?") — mentally-in behavior. Also: price objections framed as questions ("is it really $X?", "why does it cost that much?") mean they're comparing, not exiting — still hot.
- warm = interest expressed but no urgency: "sounds good", "I'm interested", "makes sense", scheduled a future touchpoint, under 14 days since a meaningful exchange. Note: "sounds good" as a conversation-ender with no follow-up question is warm, NOT hot. Passive agreement ≠ buying signal.
- cold = stall signals or silence: "need to think about it" with no follow-up, "send me info" without a specific question, no response for 10+ days after a warm exchange, third-party veto ("need to run it by my partner/boss") without scheduling a joint call, 14–30 days of no meaningful engagement.
- dormant = no response in 30+ days, or explicit disqualification: "not interested", "moving forward with someone else", "not a fit right now".
Common misclassifications to avoid: "Sounds good" alone → warm (not hot); "Send me more info" with no specific question → cold; price objection as a question → hot; silence 10+ days after warm → cold.`,
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
- 3–5 sentences max. Shorter is better.
- NEVER open with: "I hope this email finds you well", "Just following up", "Circling back", "Touching base", "Hope you're doing well", "I wanted to reach out", "I'm checking in".
- NEVER close with: "Let me know if you have any questions!", "Feel free to reach out!", "Looking forward to hearing from you!".
- Sound like a real human — first-person, specific, direct. Use contractions. Use their first name once.
- One clear ask or question at the end. Not two. Not zero. Make it easy to say yes or no.
- Reference the last real thing that happened (from notes) — don't open in a vacuum.
- For warm leads: acknowledge what they said or did last, introduce mild urgency or new context.
- For cold leads: one new hook — what's changed, what's at stake now, or why the timing matters.
- For dormant leads: acknowledge the gap in one short sentence, don't over-explain it, pivot immediately to why now.
- No bullets in the email body. Prose only.`,
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
Plain text, 3–5 sentences. No headers, no bullets, no greeting ("Good morning", "Hey there", "Rise and shine").
Lead with the most urgent thing — what they need to act on first. Be a sharp coach texting them, not a bot filing a report.

Data:
- Hot leads: ${summary.hotCount}
- Warm leads: ${summary.warmCount}
- Dormant leads needing attention: ${summary.dormantCount}
- Top priority leads: ${summary.topLeads
          .map((l) => `${l.name} (${l.company}) - ${l.reason}`)
          .join('; ')}

Get straight to it. No "Here's your briefing" preamble. Name the lead to call first and say why.`,
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
      kind: 'reschedule_meeting'
      // Who/what the meeting is about (used to find the existing event).
      lead_name?: string | null
      contact_name?: string | null
      // Optional disambiguator for the OLD time, if the rep mentioned it
      // ("my 3pm with Dana", "the Monday meeting"). YYYY-MM-DD or full ISO.
      original_when?: string | null
      // The new slot.
      new_start_iso: string
      new_duration_minutes?: number | null
    }
  | {
      kind: 'cancel_meeting'
      lead_name?: string | null
      contact_name?: string | null
      original_when?: string | null
    }
  | {
      // Manager/admin asks to set up a 1-on-1 with another team member.
      // Server finds mutually-free slots, sends them to the team member,
      // and books once they pick one.
      kind: 'request_one_on_one'
      member_name: string // display name or first name of teammate
      duration_minutes?: number | null // default 30
      // Time window: 'tomorrow' | 'this_week' | 'next_week' | YYYY-MM-DD | null
      within?: string | null
      purpose?: string | null // optional reason ('1:1', 'pipeline review', etc.)
    }
  | {
      // "Who should I call today?" — server returns a ranked priority list.
      kind: 'pipeline_triage'
      count?: number | null // default 5
    }
  | {
      // "Hide Ben for 2 weeks" / "snooze Acme until next Monday".
      kind: 'snooze_lead'
      lead_name: string
      until_date?: string | null // YYYY-MM-DD if explicit
      within?: string | null // '1d' | '3d' | '1w' | '2w' | '1m' | null
    }
  | {
      // "Dana is a $12k MRR opp" / "Acme deal is worth 50k".
      kind: 'set_deal_value'
      lead_name: string
      deal_value: number
      currency?: string | null // 'USD' default
    }
  | {
      // "Give the Acme deal to Sarah" — manager+ reassigns owner.
      kind: 'handoff_lead'
      lead_name: string
      to_member_name: string
    }
  | {
      // "How do I respond when they say it's too expensive?" — pure Claude.
      kind: 'objection_coach'
      objection: string
    }
  | {
      // Manager-only: "how's Marcus doing this week?" / "pulse on Dana".
      kind: 'rep_pulse'
      member_name: string
      period?: 'day' | 'week' | 'month' | null
    }
  | {
      // Admin/owner-only: "who closed the most this week?" / "team revenue this month".
      kind: 'leaderboard'
      period?: 'day' | 'week' | 'month' | 'quarter' | null
      metric?: 'calls' | 'meetings_booked' | 'deals_closed' | 'revenue' | null
    }
  | {
      // Admin/owner-only: "what's our best-case for Q2?" / "forecast this month".
      kind: 'forecast'
      period?: 'month' | 'quarter' | null
    }
  | {
      // "Why are we losing deals this month?" — aggregate call_logs outcomes.
      kind: 'winloss'
      period?: 'week' | 'month' | 'quarter' | null
    }
  | {
      // Admin/owner-only: "tell everyone we're closed Friday".
      kind: 'announce'
      message: string
      audience?: 'team' | 'account' | null
      team_name?: string | null
    }
  | {
      // "Anything I owe people? / who am I behind on / what replies do I owe"
      // Lists hot/warm leads where last_contact is older than `days` (default 3)
      // and there's no scheduled follow-up.
      kind: 'inbox_zero'
      days?: number | null
    }
  | {
      kind: 'set_target'
      period_type: 'day' | 'week' | 'month' | 'quarter' | 'year'
      metric: 'calls' | 'conversations' | 'meetings_booked' | 'deals_closed' | 'revenue' | 'custom'
      target_value: number
      scope?: 'personal' | 'team' | 'account' | null
      team_name?: string | null
      notes?: string | null
      // Who sees this goal: 'all' (default), 'managers' (managers/admins/owners
      // only), 'owners' (admins/owners only).
      visibility?: 'all' | 'managers' | 'owners' | null
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
  | {
      // Direct walkie-talkie message to a teammate, relayed by the bot.
      // "Tell Sarah I'm running 5 late" / "ping Marcus to grab Dana's
      // contract" / "shoot Ben a message about the demo at 3".
      kind: 'dm_member'
      member_name: string
      message: string
    }
  | {
      // Post into a role/team-scoped room. The bot relays the post 1:1 to
      // every other audience member; replies thread back through the
      // assistant. "Tell the managers we shifted the demo to Friday." /
      // "Let owners know revenue is tracking +12% MoM."
      kind: 'room_post'
      audience: 'managers' | 'owners' | 'team'
      team_name?: string | null
      message: string
    }
  | {
      // "How much did I make this month?" / "commission this quarter"
      // Sums commission_amount on call_logs for the rep in the period.
      kind: 'commission_report'
      period?: 'day' | 'week' | 'month' | 'quarter' | 'year' | null
    }
  | {
      // "Remind me about this tomorrow at 9am" / "park this for next week"
      // Routes a thing into the caller's deferred-items inbox so it doesn't
      // get mixed up with their personal tasks/goals. Source tracking is
      // automatic when this is a reply to a walkie/memo (the webhook fills
      // in source_member_id / source_memo_id from the threaded message).
      kind: 'defer_item'
      title: string
      body?: string | null
      remind_at_iso?: string | null  // ISO 8601 with offset; null = manual review
      // Optional explicit pointer if the model can identify it from context.
      source_lead_name?: string | null
    }
  | {
      // "I finished X" / "done with Y" / "completed Z" / "wipe X off my list".
      // Server fuzzy-matches the rep's open brain_items (tasks/goals/plans/etc),
      // then asks for a yes/no (or numbered pick) before flipping status to 'done'.
      // We never auto-complete — always confirm first.
      kind: 'complete_task'
      query: string
    }
  | {
      // "Push the Dana follow-up to Friday" / "move my prospecting block to tomorrow"
      // / "change due date on the deck task to next Monday". Server fuzzy-matches
      // an open brain_item, then asks for confirmation before updating it.
      kind: 'move_task'
      query: string
      new_due_date?: string | null    // YYYY-MM-DD
      new_content?: string | null     // optional rename
      new_priority?: 'low' | 'normal' | 'high' | null
    }
  | {
      // Enterprise: "have Sarah follow up with Dana by Friday" / "assign Marcus to
      // prep the Acme deck" / "give the deck task to Sarah". Server confirms with
      // the ASSIGNER first, then creates the brain_item on the ASSIGNEE and pings
      // them with [Got it now] / [Got it later] / [Decline] inline buttons.
      kind: 'assign_task'
      member_name: string
      content: string
      due_date?: string | null            // YYYY-MM-DD
      priority?: 'low' | 'normal' | 'high' | null
      timeframe?: 'now' | 'later' | null  // suggested urgency for the assignee
    }
  | {
      // The rep wants to send AUDIO (a voice memo or call recording) to a
      // teammate or manager. We don't make them learn `/walkie` or `/pitch`
      // — when their plain-English message says "I want to record a quick
      // note for Sarah", "let me leave a voice memo for Marcus", "I have
      // a recording for my manager about Dana", "queue up a voice for
      // Ben", we arm the next inbound voice file to relay to that person.
      // The bot replies with a short confirmation; the actual relay
      // happens when the rep sends the voice file.
      // flavor='walkie'  → casual peer-to-peer (kind='note')
      // flavor='pitch'   → call recording for review (kind='pitch'); use
      //                    when the rep mentions "review", "feedback",
      //                    "coaching", or names a lead.
      kind: 'arm_voice_send'
      member_name: string
      flavor?: 'walkie' | 'pitch' | null
      lead_name?: string | null
    }
  | {
      kind: 'move_lead_stage'
      lead_name: string
      stage_name: string
      // Optional context the rep stated when moving ("plan approved",
      // "signed today"). Posted as a contact note in GHL so the rep has
      // trail of why the stage moved.
      note?: string | null
    }
  | {
      // BULK IMPORT — the rep pasted a structured list of multiple prospects
      // (3+ names with details) and said "track these / build a pipeline /
      // create a pipeline file". The fast NLU only signals the intent; the
      // webhook calls extractBulkLeads() with the SMART model to parse the
      // full list out of the raw message text.
      kind: 'bulk_import_leads'
      pipeline_name: string  // e.g. "Mortgage Protection Pipeline"
      // Optional. 'sales' (default) feeds the leads CRM; everything else
      // creates a pipeline_items board so a recruiter / exec / team-lead
      // can run their own kanban without polluting the sales pipeline.
      pipeline_kind?: 'sales' | 'recruiting' | 'team' | 'project' | 'custom'
    }
  | {
      // Rep is reporting their daily KPI numbers ("100 dials, 25 convos,
      // 5 sets today"). Each metric is a {label, value} pair plus an
      // optional canonical key the NLU may guess (the server normalizes).
      kind: 'log_kpi'
      metrics: Array<{
        key?: string | null
        label: string
        value: number
        unit?: string | null
      }>
      date?: string | null // YYYY-MM-DD; null = today
      mode?: 'set' | 'increment' | null // default 'set'
      note?: string | null
    }
  | {
      // Rep is asking to add a permanent KPI widget to their dashboard.
      kind: 'create_kpi_card'
      label: string
      metric_key?: string | null
      unit?: string | null
      period?: 'day' | 'week' | 'month' | null
      goal_value?: number | null
    }
  | {
      // "Show me my KPI cards / list my dashboard widgets".
      kind: 'list_kpi_cards'
    }
  | {
      // Rep wants a new feature on the platform — bot stores it and emails
      // the admin. NEVER use this for tasks/notes/leads — only for product
      // feature requests about the bot/dashboard itself.
      kind: 'feature_request'
      summary: string
      context?: string | null
    }
  | { kind: 'question'; reply: string }
  | {
      // Trigger an outbound AI dialer call to confirm/reschedule an
      // appointment that's already on the calendar. The webhook resolves
      // the meeting (by attendee name + optional time) and fires the
      // pre-provisioned Vapi confirm assistant. Use this when the rep says
      // "confirm my appointment with Betty at 2", "call Sarah and confirm
      // tomorrow's demo", "have the AI dial Mark for the 3pm".
      kind: 'place_call'
      contact_name: string         // attendee name as the rep said it
      when_hint?: string | null    // free-text time hint: "today at 2pm", "tomorrow", "Friday 3pm", null
      purpose?: 'confirm' | 'reschedule' | null
    }
  | {
      // Rep is asking a meta/product question about the platform itself —
      // pricing, integrations, how the dialer works, how roleplay works,
      // how to upload training docs, what CRMs are supported, the offer.
      // The webhook answers using the PRODUCT_KNOWLEDGE block. Don't use
      // for sales-coaching questions (those are objection_coach).
      kind: 'product_help'
      topic: string
    }
  | {
      // Send an email to a prospect FROM the rep's connected Gmail account.
      // Use when the rep says "email Dana", "shoot X an email about Y",
      // "send an email to Ben saying Z", "follow up with Acme via email".
      // subject and body are REQUIRED — if not fully dictated, craft a
      // sensible one from context (you have the rep's voice). Never guess
      // an email address — the server resolves it from the lead record; if
      // the rep provides it explicitly, pass it in to_email.
      kind: 'send_email'
      lead_name: string
      subject: string
      body: string
      to_email?: string | null  // optional: rep stated it explicitly
    }
  | {
      // Send an SMS to a prospect via the tenant's Twilio account.
      // Use when the rep says "text X", "shoot X a text", "SMS Ben and say Y",
      // "send Dana a quick text about Z". The server resolves the phone number
      // from the lead record; to_phone is only needed if the rep stated it.
      kind: 'send_sms'
      lead_name: string
      message: string
      to_phone?: string | null  // optional: rep stated it explicitly
    }

export type TelegramInterpretation = {
  intents: TelegramIntent[]
  reply_hint?: string
}

// Compute YYYY-MM-DD and weekday name for `now` in a given IANA timezone.
// Falls back to UTC if the timezone is invalid.
function localDateParts(now: Date, timeZone: string): { date: string; weekday: string } {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    })
    const parts = fmt.formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    const date = `${get('year')}-${get('month')}-${get('day')}`
    const weekday = get('weekday')
    if (date && weekday) return { date, weekday }
  } catch {
    // fall through to UTC
  }
  const date = now.toISOString().slice(0, 10)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  return { date, weekday }
}

// Build a literal weekday → date map for today + the next 10 days, so
// Claude doesn't have to do any calendar arithmetic. Removes off-by-one
// errors when the rep says "Monday" / "next Thursday" etc.
function buildDateTable(todayISO: string, todayWeekday: string): string {
  const lines: string[] = []
  // todayISO is YYYY-MM-DD in the rep's timezone. Anchor at noon UTC to
  // avoid DST/midnight drift when stepping by day.
  const base = new Date(`${todayISO}T12:00:00Z`)
  for (let i = 0; i <= 10; i++) {
    const d = new Date(base.getTime() + i * 86400000)
    const iso = d.toISOString().slice(0, 10)
    const wd = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    let label: string
    if (i === 0) label = `today (${wd})`
    else if (i === 1) label = `tomorrow (${wd})`
    else label = wd
    lines.push(`- ${label} = ${iso}`)
  }
  return lines.join('\n')
}

export async function interpretTelegramMessage(
  rawText: string,
  repName: string,
  knownLeads: Array<{ name: string; company: string | null; status: string }>,
  timeZone: string = 'UTC',
  recentContext?: Array<{ role: 'user' | 'bot'; text: string }>,
): Promise<TelegramInterpretation> {
  const now = new Date()
  const { date: today, weekday: todayWeekday } = localDateParts(now, timeZone)
  const dateTable = buildDateTable(today, todayWeekday)
  const leadList = knownLeads
    .slice(0, 30)
    .map((l) => `- ${l.name}${l.company ? ` (${l.company})` : ''} [${l.status}]`)
    .join('\n')

  const contextBlock =
    recentContext && recentContext.length > 0
      ? `\nRecent conversation (oldest → newest, for context only — do NOT re-process these):\n${recentContext
          .map((m) => `${m.role === 'user' ? 'Rep' : 'Bot'}: ${m.text}`)
          .join('\n')}\n`
      : ''

  const response = await anthropic.messages.create({
    model: MODEL_FAST,
    max_tokens: 1500,
    system: buildRepContext(repName),
    messages: [
      {
        role: 'user',
        content: `The rep just sent you this message over Telegram.
${contextBlock}
Reference clock (rep's local timezone is ${timeZone}):
- Today is ${todayWeekday}, ${today}

Use this exact date table — do NOT compute dates yourself:
${dateTable}

Latest message:

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

    // Move an existing meeting to a new time (Google Calendar). The server will look up the matching event by attendee/summary and ASK FOR CONFIRMATION before changing anything.
    { "kind": "reschedule_meeting", "lead_name": "existing prospect or null", "contact_name": "free-text name or null", "original_when": "YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS-05:00 if the rep referenced the old time, else null", "new_start_iso": "YYYY-MM-DDTHH:MM:SS-05:00", "new_duration_minutes": 30 },

    // Cancel an existing meeting. Server will confirm before deleting.
    { "kind": "cancel_meeting", "lead_name": "existing prospect or null", "contact_name": "free-text name or null", "original_when": "YYYY-MM-DD or full ISO if the rep referenced the time, else null" },

    // Manager/admin asks to schedule an internal 1-on-1 with someone on their team. The server finds open slots on both calendars, messages the teammate with options, and books once they pick.
    { "kind": "request_one_on_one", "member_name": "teammate's name (first name OK)", "duration_minutes": 30, "within": "tomorrow|this_week|next_week|YYYY-MM-DD|null", "purpose": "short reason or null" },

    // Ranked "what should I work on now" list — server picks the leads.
    { "kind": "pipeline_triage", "count": 5 },

    // Hide a lead from triage/dormant checks until later.
    { "kind": "snooze_lead", "lead_name": "existing prospect", "until_date": "YYYY-MM-DD or null", "within": "1d|3d|1w|2w|1m or null" },

    // Stamp a deal value on a lead.
    { "kind": "set_deal_value", "lead_name": "existing prospect", "deal_value": 12000, "currency": "USD or null" },

    // Reassign a lead to another team member.
    { "kind": "handoff_lead", "lead_name": "existing prospect", "to_member_name": "teammate's name" },

    // Sales-coach a specific objection ("too expensive", "need to think about it").
    { "kind": "objection_coach", "objection": "the objection in the rep's words" },

    // Manager-only: snapshot of how a specific rep is doing.
    { "kind": "rep_pulse", "member_name": "rep's name", "period": "day|week|month|null" },

    // Admin/owner-only: leaderboard across the whole org.
    { "kind": "leaderboard", "period": "day|week|month|quarter|null", "metric": "calls|meetings_booked|deals_closed|revenue|null" },

    // Admin/owner-only: weighted pipeline forecast.
    { "kind": "forecast", "period": "month|quarter|null" },

    // Win/loss patterns from logged call outcomes.
    { "kind": "winloss", "period": "week|month|quarter|null" },

    // Admin/owner-only: broadcast a short message to the team or whole account.
    { "kind": "announce", "message": "the announcement text", "audience": "team|account|null", "team_name": "team name if audience=team, else null" },

    // "Anything I owe people / who am I behind on / what's stuck in my inbox" → inbox_zero.
    { "kind": "inbox_zero", "days": 3 },

    // "How much did I make this month / commission this quarter / what'd I earn this week" → commission_report.
    { "kind": "commission_report", "period": "day|week|month|quarter|year|null" },

    // Park something for later in the deferred-items inbox (NOT a personal task — separate inbox).
    // "remind me about this tomorrow", "park this for next week", "follow up with this on Friday"
    { "kind": "defer_item", "title": "short title", "body": "optional context", "remind_at_iso": "ISO 8601 with offset or null", "source_lead_name": "lead name if applicable, else null" },

    // Mark a brain-item (task / goal / plan / idea / note) as done. Server confirms before flipping status.
    { "kind": "complete_task", "query": "the rep's description of the thing they finished, e.g. 'follow up with Dana' or 'send pricing deck'" },

    // Move / edit an existing open brain-item — change due date, rename, or bump priority. Server fuzzy-matches and confirms before updating.
    { "kind": "move_task", "query": "what the rep said the task is about, e.g. 'Dana follow-up' or 'pricing deck'", "new_due_date": "YYYY-MM-DD or null", "new_content": "rephrased content or null", "new_priority": "low|normal|high or null" },

    // Enterprise: assign a task to a teammate. Bot confirms with ASSIGNER, then pings the assignee with Now/Later/Decline buttons.
    { "kind": "assign_task", "member_name": "teammate first or full name", "content": "the task in the assigner's words", "due_date": "YYYY-MM-DD or null", "priority": "low|normal|high or null", "timeframe": "now|later or null" },

    // Walkie-talkie text to a teammate (the bot relays). 1:1, not broadcast.
    { "kind": "dm_member", "member_name": "teammate first or full name", "message": "the message body" },

    // Arm the NEXT voice message to relay to a teammate. Use when the rep
    // says they're about to record (no audio attached yet). flavor='pitch'
    // when they mention review/feedback/coaching/a lead, else 'walkie'.
    { "kind": "arm_voice_send", "member_name": "teammate first or full name", "flavor": "walkie|pitch|null", "lead_name": "lead name if pitch and they named one, else null" },

    // Post into a private role-room. Relays 1:1 to every other member.
    { "kind": "room_post", "audience": "managers|owners|team", "team_name": "team name if audience=team, else null", "message": "the message body" },

    // Define a measurable goal/target with progress tracking
    { "kind": "set_target", "period_type": "day|week|month|quarter|year", "metric": "calls|conversations|meetings_booked|deals_closed|revenue|custom", "target_value": 50, "scope": "personal|team|account|null", "team_name": "name of team if scope=team, else null", "notes": "optional context", "visibility": "all|managers|owners|null" },

    // Ask for a summary/report (the bot will fetch data and respond)
    { "kind": "report", "report_type": "pipeline|today|week|calendar|goals|metrics|lead_history", "lead_name": "only for lead_history, else null" },

    // Move a lead to a pipeline stage by name
    { "kind": "move_lead_stage", "lead_name": "the lead's name", "stage_name": "the stage they said", "note": "optional context like 'plan approved' if the rep stated a reason" },

    // BULK IMPORT — rep pasted a list of 3+ prospects with details and asked you to "track them" / "build a pipeline" / "create a pipeline file". Emit just this single intent (no add_leads). The server will run a deep parser on the raw message to extract every prospect. pipeline_kind defaults to 'sales' for prospect lists; set it to 'recruiting' if it's candidates being interviewed/hired, 'team' if it's teammates being tracked for performance, 'project' if it's tasks/initiatives, 'custom' if none fit.
    { "kind": "bulk_import_leads", "pipeline_name": "short pipeline name inferred from the message — e.g. 'Mortgage Protection Pipeline', 'Q2 Enterprise Pipeline'. Default to 'Sales Pipeline' if nothing obvious.", "pipeline_kind": "sales|recruiting|team|project|custom" },

    // Log daily KPI numbers (dials, convos, appointments, doors knocked, etc.). One intent per message — pack every metric the rep mentioned into the metrics array.
    { "kind": "log_kpi", "metrics": [{ "key": "dials|conversations|appointments_set|voicemails|no_answers|deals_closed|emails_sent|texts_sent|doors_knocked|null", "label": "the rep's wording (Dials, Convos, Sets, Knocks, etc.)", "value": 100, "unit": "optional unit or null" }], "date": "YYYY-MM-DD or null (null = today)", "mode": "set|increment|null (default set; use increment when rep says 'add 5 more dials')", "note": "optional one-line context" },

    // Add a NEW permanent KPI widget to the rep's dashboard (no value being logged — they're asking for a tracker to exist).
    { "kind": "create_kpi_card", "label": "display name e.g. 'Door Knocks'", "metric_key": "slug if obvious (dials, conversations, appointments_set, voicemails, no_answers, deals_closed, emails_sent, texts_sent, doors_knocked) or null", "unit": "optional unit or null", "period": "day|week|month|null (default day)", "goal_value": 100 or null },

    // Show the rep their existing KPI cards / dashboard widgets and today's values.
    { "kind": "list_kpi_cards" },

    // Rep is asking the platform for a new feature. The server stores the request and emails the admin.
    { "kind": "feature_request", "summary": "one-sentence description of what they want", "context": "any extra detail or null" },

    // Trigger the AI dialer to call a prospect and confirm/reschedule an existing meeting.
    { "kind": "place_call", "contact_name": "prospect or attendee name as the rep said it", "when_hint": "free-text time hint like 'today at 2pm', 'tomorrow', 'Friday 3pm', or null", "purpose": "confirm|reschedule|null (default confirm)" },

    // Rep is asking a meta/product question about Virtual Closer itself.
    { "kind": "product_help", "topic": "short description of what they're asking about (pricing, dialer, roleplay, integrations, GHL, HubSpot, Twilio, training docs, scenarios, dashboard, onboarding, etc.)" },

    // Send an email to a prospect FROM the rep's connected Gmail. Requires the rep to have connected Google.
    { "kind": "send_email", "lead_name": "the prospect's name from the list", "subject": "a clear, human subject line (not AI-sounding)", "body": "the full email body — write it naturally in the rep's voice based on what they told you to say", "to_email": "email address if the rep stated it explicitly, else null" },

    // Send an SMS to a prospect via Twilio. Requires Twilio to be configured.
    { "kind": "send_sms", "lead_name": "the prospect's name from the list", "message": "the SMS body — concise, plain text, conversational", "to_phone": "phone number if the rep stated it explicitly, else null" },

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
- "Move my call with X to Thursday 10am" / "reschedule X to next Tuesday 2pm" / "push the Dana meeting to Friday" → reschedule_meeting (extract new_start_iso the same way as book_meeting; original_when only if the rep explicitly named the old day/time)
- "Cancel my meeting with X" / "kill the Dana call" / "drop tomorrow's 3pm" → cancel_meeting
- "Set up a 1on1 with X" / "book a 1:1 with Sarah this week" / "I want to meet with Marcus tomorrow" / "request a call with Dana about pipeline" — when X is clearly a TEAMMATE (not a prospect from the list above) → request_one_on_one. Resolve "within" from phrasing: "tomorrow"→tomorrow, "this week"→this_week, "next week"→next_week, a specific weekday/date → that YYYY-MM-DD, no hint → null. Default duration 30 minutes unless they say otherwise.
- "Who should I call today / what should I work on now / who's hottest right now / where should I focus" → pipeline_triage. Default count 5.
- "Snooze X / hide X / pause X / mute X for 2 weeks" → snooze_lead. Map durations: "a day"→1d, "a few days"→3d, "a week"→1w, "2 weeks"→2w, "a month"→1m. If they give a date ("until Monday"), set until_date instead.
- "X is a $12k deal / Acme is worth 50k / Dana would be 8k MRR" → set_deal_value. Strip $ and k (k = thousands → multiply by 1000). currency='USD' unless specified.
- "Give the Dana deal to Sarah / hand off Acme to Marcus / Sarah owns Ben now" → handoff_lead.
- "How do I respond when they say X / what do I say when they push back on Y / give me a comeback for Z" → objection_coach. Set objection to the rep's exact wording of what the prospect said.
- "How's Marcus doing this week / pulse on Dana / give me a read on Sarah / how's Ben tracking" — when X is a TEAMMATE (not a prospect) → rep_pulse.
- "Who closed the most this week / leaderboard / team revenue this month / who's killing it / who's at the top" → leaderboard.
- "Forecast this month / what's our best case for Q2 / where will we land / project the month" → forecast.
- "Why are we losing deals / win-loss / what's killing our deals / patterns in lost calls" → winloss.
- "Tell everyone X / announce X / broadcast X / let the team know X" → announce. audience='team' if they say "the team", 'account' if "everyone"/"the whole company", null otherwise.
- "Who am I behind on / anything I owe people / what replies am I missing / who's waiting on me / inbox zero" → inbox_zero. Default days=3 unless they say a number.
- "How much have I made / commission this month / what did I earn this week / paycheck this quarter" → commission_report. Default period=month unless they say otherwise.
- "Tell Sarah X / ping Marcus about Y / shoot Ben a message that Z / let Dana know W / DM Marcus" — when X is clearly a TEAMMATE (not a prospect from the list above) → dm_member. Capture the message verbatim. NOT for announcements (those are 'announce').
- VOICE-SEND ARMING → arm_voice_send. The rep is telling you they want to send AUDIO but hasn't attached the file yet. Patterns: "I want to send Sarah a voice note", "let me record a quick note for Marcus", "I'll leave Ben a voice memo", "queue up a voice for Sarah", "I have a recording for my manager", "I'm about to record something for the team lead", "send Sarah a voice", "voice memo for Marcus". Set flavor='pitch' if they say "review", "feedback", "coaching", "rip apart", "tear apart", "critique", or they name a lead/deal ("recording of my call with Dana for Marcus to review"). Otherwise flavor='walkie'. NEVER use this when audio is already attached — voice files arm/relay themselves. NEVER guess the recipient: if the name is ambiguous, emit a question intent asking who they meant instead.
- "Tell the managers X / share with the leadership team / let the managers room know Y" → room_post audience="managers". "Tell the owners X / share with leadership / message the execs / owners room" → room_post audience="owners". "Share with the [TeamName] team" → room_post audience="team" team_name="TeamName". The bot will *confirm before sending* — the user does not need to know the audience name verbatim.
- "Goal: X / target: X / I want to do X this week/month" with a number → set_target. Pick the closest metric. If the goal is qualitative ("close more deals", no number), use brain_item with item_type=goal instead.
- For set_target.scope: if the rep says "team goal", "for the team", "for everyone", "for the [Name] team" → scope="team" (set team_name to the team they named, or null to default to their managed team). If they say "account goal", "company-wide", "everyone in the company" → scope="account". Otherwise default scope=null (server treats as personal).
- For set_target.visibility: "managers only / leadership only / hide from reps / private to managers" → visibility="managers". "owners only / just for me and admins / executive only" → visibility="owners". Otherwise null (server treats as 'all').
- "What's my pipeline / how am I doing / show me today / what's on my calendar / how close am I to my goal / how many calls this week" → report (pick the right report_type). lead_history if they ask about a specific person ("show me history with Dana", "what did I last say to Ben").
- "Move Dana to Proposal / put Acme in Discovery / Dana is in Negotiation / move Ben to Closed Won" → move_lead_stage. lead_name = the prospect name, stage_name = the stage they mentioned (server fuzzy-matches it).
- BULK PIPELINE IMPORT → bulk_import_leads. Trigger when ALL of these are true:
   • The message is long (≥ ~400 chars) and structured as a LIST (numbered items, bullets, or repeated "Name:" / "Stage:" / "Phone:" blocks).
   • At least 3 distinct PERSON names appear (first + last name patterns).
   • The rep used trigger language like: "create a pipeline", "build a pipeline", "track these", "track this list", "track these prospects", "pipeline file", "pipeline to track", "structured pipeline", "set up a pipeline", "start a pipeline", "new pipeline", "make a pipeline of", "log all these", "import these", "add all these prospects", "make me a kanban", "build me a board", "build me a tracker", "organize these", "put these in my CRM", or pasted a sheet/CRM dump.
   • Emit ONE intent only — { "kind": "bulk_import_leads", "pipeline_name": "..." }. Do NOT also emit add_lead intents; the server's deep parser will extract every prospect from the raw message. NEVER tell the rep "I haven't created anything yet" or ask which option they want — the server handles it.
   • Infer pipeline_name from message context: "mortgage protection prospects" → "Mortgage Protection Pipeline", "Q2 enterprise leads" → "Q2 Enterprise Pipeline", generic → "Sales Pipeline".
   • IMPORTANT: the rep does NOT need to have set up a pipeline first. The server auto-creates pipeline + stages + leads on the fly. Never block on "you need to set this up first" — just emit the intent.
- COMPLETION REPORTS → complete_task (NEVER brain_item). The rep is telling you they finished something that's already on their list. Patterns:
   • "I finished X" / "done with X" / "completed X" / "knocked out X" / "X is done" / "X are done" / "X was done" / "already did X" / "already finished X" / "already handled X" / "X is handled" / "X are handled" / "X is complete" / "cross off X" / "wipe X off" / "mark X done" / "check X off" / "got X done" / "X taken care of" / "handled X".
   • BULK / OVERDUE completions: "all the overdue tasks are done" / "knocked out all my overdue tasks" / "finished all the due tasks" / "all my tasks are done" / "everything on my list is done" → emit ONE complete_task with query set to "overdue" (if they said overdue/due/past-due) or "all tasks" (if they said all tasks / everything). The server will fetch the real list from the database — do NOT try to name specific tasks here.
   • If the message is multiline and several lines each say "X is done" / "Y is done" / "Z is done", emit ONE complete_task per line.
   • "X is done and assigned to Y" → emit complete_task for X AND a separate handoff_lead for X → Y if Y is a teammate (otherwise just complete_task; the assignment is implicit).
   • NEVER emit brain_item with content like "X is done" or "finished X" — that creates a NEW task, which is the opposite of what the rep wants. The brain_item kind is ONLY for things the rep wants to remember/track going forward, never for reporting completion of something existing.
- "Remind me to …" / generic ideas / unmeasurable goals → brain_item
- MOVE / RESCHEDULE A TASK (not a calendar meeting) → move_task. Patterns: "push the Dana follow-up to Friday", "move my prospecting block to tomorrow", "change due date on the deck task to next Monday", "bump the Acme prep to high priority", "rename 'call Dana' to 'call Dana about pricing'". Set new_due_date / new_content / new_priority based on what changed; leave the others null. The query field captures what the task is about so the server can fuzzy-match.
- ASSIGN A TASK TO A TEAMMATE → assign_task (NOT brain_item, NOT dm_member). Patterns: "have Sarah follow up with Dana by Friday", "assign Marcus to prep the Acme deck", "give the deck task to Sarah", "Sarah owns the Dana followup", "tell Marcus to call Acme tomorrow", "ask Sarah to send Dana the pricing today". Extract member_name (the teammate), content (the task in plain English), due_date (YYYY-MM-DD if mentioned, else null), priority, and timeframe ("today/now/asap"→now, "this week/later/eventually"→later, otherwise null). dm_member is for relaying a message verbatim; assign_task creates an actual task on the teammate's board and asks them to accept.
- DAILY KPI REPORTING → log_kpi (NEVER brain_item, NEVER question). Triggers: any message that pairs numbers with sales-activity nouns OR money with outcome nouns. Patterns:
   • Activity: "made 100 dials today" / "hit 50 calls" / "100 dials, 25 convos, 5 sets" / "knocked 80 doors today" / "set 5 appointments" / "sent 30 emails" / "left 12 voicemails" / "closed 2 deals today" / "had 3 demos" / "ran 4 presentations" / "got 2 referrals" / "sent 5 quotes" / "did 6 follow-ups" / "interviewed 3 candidates".
   • Money: "$5,000 closed today" / "did $2k in revenue" / "made $1,200 in commission" / "$800 paycheck this week" / "closed $15k in business" / "1.5k commission" / "GP today was $400". Map money words to canonical keys: revenue/sales/gross → 'revenue', commission/paychecks/comm → 'commission', GP/gross profit → 'gross_profit'. Set unit='USD' for money metrics. STRIP the dollar sign and commas, parse 'k'=×1000, 'm'/'mm'=×1,000,000.
   • Pack EVERY number+label pair (activity AND money) into the metrics array as ONE log_kpi intent.
   • Use the canonical metric_key list when the label clearly maps (calls/dials → 'dials', convos/conversations/talks → 'conversations', sets/appointments/booked → 'appointments_set', VMs → 'voicemails', NAs → 'no_answers', closes/deals → 'deals_closed', emails → 'emails_sent', texts → 'texts_sent', knocks/doors → 'doors_knocked', revenue → 'revenue', commission → 'commission', demos → 'demos', presentations → 'presentations', referrals → 'referrals', followups/follow-ups → 'follow_ups', quotes → 'quotes_sent', proposals → 'proposals_sent', interviews → 'interviews'). For anything else set key=null and let the server slugify the label.
   • date=null means today. Only fill date when the rep explicitly says "yesterday" / a specific day.
   • mode='increment' if the rep says "add 5 more dials" / "plus 10 calls" / "another $500 commission". Otherwise default null/'set'.
- KPI WIDGET CREATION → create_kpi_card. Triggers: "add X to my dashboard" / "track X as a daily kpi" / "track X weekly" / "track X monthly" / "make a card for X" / "create a kpi widget for X" / "start tracking X every day" — when the rep is asking for a TRACKER to exist (no number being logged). Set period='week' if they say weekly/per-week/each-week, period='month' if monthly/per-month/each-month, otherwise period='day'. If they include a number it's BOTH log_kpi AND create_kpi_card; emit both intents.
- KPI LISTING → list_kpi_cards. Triggers: "show my kpis" / "what kpis am I tracking" / "list my dashboard cards" / "what's on my dashboard".
- FEATURE REQUESTS → feature_request (NEVER brain_item, NEVER "I'll log it for later"). Triggers: "feature request: X" / "you should add X" / "the bot should be able to X" / "I wish the platform did X" / "can you build X" / "please add X to virtual closer" / "send this to admin: X" / "tell jace we need X" / "submit a feature request for X". Capture summary as the rep's wording, context for any extra detail. NEVER tell the rep to "file a feature request elsewhere" — emit this intent and the server will email the admin.
- AI DIALER TRIGGER → place_call. Triggers: "confirm my appointment with X" / "have the AI call X" / "call X about the 2pm" / "dial X for the demo" / "AI dial X at 3" / "have the bot confirm with X tomorrow" / "have the dialer reach out to X for the Friday meeting" / "kick off a confirm call to X" / "send the AI dialer to X". contact_name = the prospect/attendee. when_hint = whatever time wording they used ("today at 2pm", "tomorrow's call", "Friday 3pm") or null if no time mentioned. purpose='reschedule' if they say "reschedule X / push X to a new time / move X". Default purpose='confirm'.
- PRODUCT QUESTIONS → product_help (NOT objection_coach, NOT question). Triggers: questions about Virtual Closer itself — "how much does the dialer cost", "what's the per-minute price", "do you support GoHighLevel", "what CRMs do you integrate with", "how does the roleplay work", "how do I upload training docs", "can the AI read my PDFs", "what does the dialer do", "how do I set up Twilio", "what plans are there", "what's on the dashboard", "how do I customize widgets", "what's in the offer", "can I white-label this". topic = short label of what they asked. The server uses your product knowledge block to answer.
- SEND EMAIL → send_email. Triggers: "email Dana", "shoot X an email", "send X an email about Y", "email Ben and say Z", "send a follow-up email to Acme", "send X an intro email", "draft an email to X". lead_name = the prospect's name. subject = a subject line (generate a good one if not specified). body = the full email body — write it naturally in the rep's voice. to_email only if the rep explicitly stated an address. NEVER use this for DMs to teammates (those are dm_member).
- SEND SMS → send_sms. Triggers: "text X", "shoot X a text", "SMS Ben", "send Dana a quick text about Y", "text X and say Z", "send X a text message". lead_name = the prospect's name. message = the SMS body — keep it short and conversational, rep's voice. to_phone only if the rep explicitly stated a phone number. NEVER use this for voice sends (those are arm_voice_send) or for messages to teammates (those are dm_member).
- MOVE LEAD STAGE → move_lead_stage. Triggers: "move Dana to Proposal", "put Acme in Discovery", "Dana is in Negotiation now", "move Ben to Closed Won", "X is at stage Y", "update Dana's stage to Follow-Up", "push X to Qualified". lead_name = the prospect name, stage_name = the stage they mentioned (server fuzzy-matches). note = any context the rep gave ("plan approved", "they signed").
- One message can produce multiple intents (e.g. "just talked to Dana, she's hot, follow up Thursday about pricing" → log_call + update_lead status hot + schedule_followup)
- If the rep references a prospect by first name only and it uniquely matches the list above, use the full matched name
- Infer priority from urgency language (urgent/asap/today = high)
- Dates: ALWAYS resolve weekday names using the date table above. "today" = the row labelled today; "tomorrow" = the row labelled tomorrow. For a bare weekday name like "Monday", "Thursday": pick the SOONEST matching row that is NOT today (i.e. the next occurrence — never today, never last week). "next Monday" / "this coming Monday" → same rule. "a week from Monday" → 7 days after that row. Never invent a date that isn't in the table for anything within the next 10 days.
- For book_meeting times: if the rep says "3pm" with no timezone, assume their local time and pick a reasonable -05:00 offset (we'll fix it server-side).
- REPLY QUALITY for any "question" reply or "reply_hint" field: write it the way a sharp human sales coach would text their rep — no "Great question!", no "Certainly!", no "Let me know if you have other questions!", no bullet points, max 3 sentences unless the rep explicitly asked for more detail.
- If the message is purely conversational ("hey", "thanks", "what's up"), emit a single "question" intent and nothing else`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<TelegramInterpretation>(text, { intents: [] })
  const intents = Array.isArray(parsed.intents) ? parsed.intents.filter(Boolean) : []
  return { intents, reply_hint: parsed.reply_hint }
}

/**
 * Escalation pass using the smarter model. Called when the fast-path NLU
 * returns nothing actionable (empty intents or only a `question`). Passes
 * full conversational context so Claude can reason about what "that" / "it"
 * refers to, partial phrases, typo-heavy voice-to-text, etc.
 *
 * Uses the same JSON schema as `interpretTelegramMessage` so the results
 * can be executed by the same dispatch loop.
 */
export async function interpretTelegramMessageDeep(
  rawText: string,
  repName: string,
  knownLeads: Array<{ name: string; company: string | null; status: string }>,
  timeZone: string = 'UTC',
  recentContext?: Array<{ role: 'user' | 'bot'; text: string }>,
): Promise<TelegramInterpretation> {
  const now = new Date()
  const { date: today, weekday: todayWeekday } = localDateParts(now, timeZone)
  const dateTable = buildDateTable(today, todayWeekday)
  const leadList = knownLeads
    .slice(0, 30)
    .map((l) => `- ${l.name}${l.company ? ` (${l.company})` : ''} [${l.status}]`)
    .join('\n')

  const contextBlock =
    recentContext && recentContext.length > 0
      ? `Recent conversation (oldest → newest):\n${recentContext
          .map((m) => `${m.role === 'user' ? 'Rep' : 'Bot'}: ${m.text}`)
          .join('\n')}\n\n`
      : ''

  const response = await anthropic.messages.create({
    model: MODEL_SMART,
    max_tokens: 1500,
    system: buildRepContext(repName),
    messages: [
      {
        role: 'user',
        content: `The rep sent a message that the fast-path parser couldn't confidently route.
Your job: reason carefully about what they were actually trying to do — even if the phrasing is
vague, uses voice-to-text typos, refers to something from earlier in the conversation ("that", "it",
"the last one"), or is missing details. If you can figure out the intent, emit it. If you genuinely
can't, emit a question intent with a specific, helpful clarifying question (NOT a generic "I didn't
understand that").

${contextBlock}Reference clock (rep's local timezone is ${timeZone}):
- Today is ${todayWeekday}, ${today}

Date table (use this exactly — do not compute):
${dateTable}

Latest message:

"""
${rawText}
"""

Their existing prospects:
${leadList || '(no leads yet)'}

Respond ONLY with JSON using the same schema as the fast-path parser:

{
  "intents": [
    { "kind": "add_lead", "name": "...", "company": null, "email": null, "status": "warm", "note": null },
    { "kind": "update_lead", "lead_name": "...", "status": null, "note": null, "mark_contacted": false, "email": null, "company": null, "phone": null },
    { "kind": "schedule_followup", "lead_name": "...", "due_date": "YYYY-MM-DD", "content": "...", "priority": "normal" },
    { "kind": "brain_item", "item_type": "task|goal|idea|plan|note", "content": "...", "priority": "normal", "horizon": "day|week|month|quarter|year|none", "due_date": null },
    { "kind": "log_call", "lead_name": "...", "summary": "...", "outcome": null, "next_step": null, "duration_minutes": null },
    { "kind": "book_meeting", "lead_name": null, "contact_name": null, "email": null, "start_iso": "YYYY-MM-DDTHH:MM:SS-05:00", "duration_minutes": 30, "summary": "...", "notes": null },
    { "kind": "complete_task", "query": "short description of what was completed — use 'overdue' for 'all overdue tasks', 'all tasks' for everything" },
    { "kind": "report", "report_type": "pipeline|today|week|calendar|goals|metrics", "lead_name": null },
    { "kind": "log_kpi", "metrics": [{ "key": "dials|conversations|appointments_set|voicemails|no_answers|deals_closed|emails_sent|texts_sent|doors_knocked|null", "label": "the rep's wording", "value": 100, "unit": null }], "date": null, "mode": null, "note": null },
    { "kind": "create_kpi_card", "label": "display name", "metric_key": null, "unit": null, "period": "day", "goal_value": null },
    { "kind": "list_kpi_cards" },
    { "kind": "feature_request", "summary": "what they want", "context": null },
    { "kind": "place_call", "contact_name": "attendee name", "when_hint": null, "purpose": "confirm" },
    { "kind": "product_help", "topic": "pricing|dialer|roleplay|integrations|training_docs|onboarding|..." },
    { "kind": "question", "reply": "specific clarifying question" }
  ],
  "reply_hint": "short natural-language summary of what you did, or null"
}

Key reasoning rules:
- "that" / "it" / "the task" / "this one" → look at the bot's most recent reply in the conversation for what was just created or discussed
- Voice-to-text artifacts: "i need to follow up with dean this week" → schedule_followup; "get back to sarah" → schedule_followup or brain_item task
- Vague completion: "yeah I talked to them" after scheduling a followup → log_call
- If the rep references a lead by first name and it uniquely matches the list, use the full name
- Prefer action intents over question intents — only ask when you truly cannot infer the intent`,
      },
    ],
  })

  const txt = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<TelegramInterpretation>(txt, { intents: [] })
  const intents = Array.isArray(parsed.intents) ? parsed.intents.filter(Boolean) : []
  return { intents, reply_hint: parsed.reply_hint }
}

// ── Coach / report generators ─────────────────────────────────────────────

export type BulkImportLead = {
  name: string
  phone?: string | null
  email?: string | null
  company?: string | null
  state?: string | null
  age?: number | null
  stage_name?: string | null   // "Quotes Needed", "Hard Case", "Senior Structured", etc.
  status?: 'hot' | 'warm' | 'cold' | null
  deal_value?: number | null   // dollars, if a number is mentioned
  priority?: number | null     // 1 = highest, 99 = lowest. Used for ordering.
  notes: string                // condensed multiline summary of all the rep's details
  action_items?: string[]      // ["Generate $200K-$300K term quote", ...]
}

/**
 * Deep parser for the bulk_import_leads intent. Takes the raw pasted message
 * and pulls every prospect out into a structured list. Uses the SMART model
 * because the input is messy (numbered lists, emojis, sub-bullets, varied
 * phrasing) and we only run this once per import.
 *
 * Always returns a non-empty leads array if at least one person can be
 * identified. Returns empty leads if the message isn't actually a list.
 */
export async function extractBulkLeads(
  rawText: string,
  repName: string,
): Promise<{ pipeline_name: string; leads: BulkImportLead[]; suggested_stages: string[] }> {
  const response = await anthropic.messages.create({
    model: MODEL_SMART,
    max_tokens: 4000,
    system: buildRepContext(repName),
    messages: [
      {
        role: 'user',
        content: `The rep just pasted a long, structured list of prospects and asked you to track them in a pipeline. Your job is to PARSE every prospect out of the message into clean structured data — you are not having a conversation. Be exhaustive. Capture every name.

Raw message:
"""
${rawText}
"""

Respond ONLY with JSON:
{
  "pipeline_name": "short name inferred from the content (e.g. 'Mortgage Protection Pipeline', 'Q2 Enterprise Pipeline'). Fallback: 'Sales Pipeline'.",
  "suggested_stages": ["ordered list of unique stage labels appearing in the message — e.g. ['Quotes Needed','Senior Structured','Hard Case']. If no stages mentioned, return ['New','Working','Quoted','Closed']."],
  "leads": [
    {
      "name": "Full Name",
      "phone": "digits-only or formatted, or null",
      "email": "lowercased email or null",
      "company": "company if mentioned or null",
      "state": "US state if mentioned or null",
      "age": null or integer,
      "stage_name": "the stage label this prospect is in (must match one in suggested_stages), or null",
      "status": "hot | warm | cold — infer from priority labels: 'highest priority'/🔥/'hottest' = hot, 'middle'/'standard' = warm, 'complex'/'hard' = warm (still in pipeline), default = warm",
      "deal_value": null or a number in dollars (use the LARGEST quote target if multiple ranges, e.g. '$200K-$300K' → 300000),
      "priority": null or 1-based ordering if the message contains a 'recommended order' / 'priority list' (1 = call first),
      "notes": "Condensed multiline note capturing everything else: age, state, family, mortgage details, health, strategy, beneficiaries. Keep it readable — newlines OK.",
      "action_items": ["Each concrete action the rep needs to take, in imperative form. e.g. 'Generate $200K-$300K 20-year term quote', 'Send IUL upsell info for kids'. Empty array if none."]
    }
  ]
}

Critical rules:
- DO NOT invent prospects. Only include people explicitly named in the message.
- DO NOT skip anyone. If the message has 8 names, return 8 leads.
- DO NOT include phone/email if you have to guess. Null is fine.
- For stages, use the label EXACTLY as written by the rep ('Quotes Needed', not 'quotes-needed' or 'Quotes_Needed'). Strip emojis from stage names ('🟣 Quotes Needed' → 'Quotes Needed').
- 'Recommended Quote Order' / 'Priority' lists set the priority field — preserve the user's ordering.
- If the rep listed everyone under one stage (e.g. all are 'Quotes Needed'), still emit suggested_stages with that one stage.`,
      },
    ],
  })

  const txt = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<{
    pipeline_name?: string
    leads?: BulkImportLead[]
    suggested_stages?: string[]
  }>(txt, {})

  return {
    pipeline_name: parsed.pipeline_name?.trim() || 'Sales Pipeline',
    leads: Array.isArray(parsed.leads) ? parsed.leads.filter((l) => l && typeof l.name === 'string' && l.name.trim()) : [],
    suggested_stages: Array.isArray(parsed.suggested_stages) && parsed.suggested_stages.length
      ? parsed.suggested_stages.map((s) => s.trim()).filter(Boolean)
      : ['New', 'Working', 'Quoted', 'Closed'],
  }
}

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
- If any event has a join_link, include it as a clickable URL on its own line so the rep can tap to join.

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

