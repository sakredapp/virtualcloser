import type { BrainItemHorizon, BrainItemType } from '@/types'
import { getAI } from './ai'
import { loadGuidance, renderGuidance } from './plaud/guidance'
import { getBrand } from './brand'
import { textModelId } from '@/lib/aiProvider'

// Two-tier model strategy. Override individually via env if needed.
// Cheap default for high-volume extraction/classification/routing.
// Premium model for outputs the rep actually reads (emails, briefings).
// Use `||` not `??` so empty-string env vars fall through to defaults.
const MODEL_FAST = textModelId()
const MODEL_SMART = textModelId()

function buildRepContext(repName?: string): string {
  const name = repName ?? process.env.REP_NAME ?? 'the sales rep'
  return `
You are the Virtual Closer — ${name}'s personal AI assistant, working
inside the app's Mira chat.

What that means in practice:
  1. You help ${name} close more deals — analyzing leads, drafting outreach,
     logging calls, booking meetings, flagging what needs attention.
  2. ${name} speaks to you in plain English. They never have to learn slash
     commands or @-tags.
  3. Voice memos for coaching: reps pitch a manager (kind=pitch) and the
     manager reviews it in the app and leaves feedback (kind=feedback).

Be direct, practical, and sound like a knowledgeable sales coach — not a robot.
Default to action over questions.

VOICE — applied to every piece of text you generate that a rep or client will actually read:
- Match energy: short terse input = short terse output. Never be more formal than the person you're addressing.
- Never open with filler: "Great!", "Absolutely!", "Of course!", "Sure!", "Happy to help!", "Certainly!", "That's a great question!", "I'd be happy to...".
- Never close with: "Let me know if you have any questions!" or "Feel free to reach out!".
- One question per message. Always at the end, never at the start.
- No bullet lists in conversational SMS or chat replies. Prose only.
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
- Mira chat: this assistant. Reps speak in plain English to log activity, manage leads, book meetings, log KPIs, ask product questions.
- Dashboard widgets: rep can show/hide and drag-reorder via the ⚙ Customize button (saved per-member).
- Onboarding: admin sets the client up at /admin/clients/[id] → pastes Vapi API key (or we use the platform key), Twilio creds (optional), GHL/HubSpot keys. Master Vapi assistants get cloned per client and re-provisioned automatically when the rep edits prompts or uploads new training docs.

Use this knowledge to answer rep questions about the platform via the product_help intent. Don't make stuff up — if asked something not covered above, say so plainly and emit a question intent.
`.trim()
}

// CXO Suite variant of the legacy fallback classifier persona. Same JSON
// intent schema and behavioral rules — only the identity and product
// knowledge change so a CXO executive never gets a reply that names "Virtual
// Closer" or quotes the AI-dialer pricing. Reached only on fallback turns
// (the primary path is the brand-aware runAgent persona).
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
 * product questions in Mira chat) where the rep just needs a short
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
  const response = await getAI().messages.create({
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

  const response = await getAI().messages.create({
    model: MODEL_FAST,
    max_tokens: 300,
    system: buildRepContext(),
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
  const response = await getAI().messages.create({
    model: MODEL_SMART,
    max_tokens: 500,
    system: buildRepContext(),
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

  const response = await getAI().messages.create({
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

// ── Project planner ───────────────────────────────────────────────────────

export type PlannedStep = string

export type PlannedTask = {
  title: string
  description?: string | null
  /** Owner name as written in the source doc (e.g. "Brad"). Matched to a
   *  member downstream — never trusted as an ID. */
  owner_hint?: string | null
  /** Free-text estimate as written ("15 min", "3 hours", "Ongoing"). */
  time_estimate?: string | null
  steps: PlannedStep[]
}

export type PlannedSection = {
  title: string
  subtitle?: string | null
  tasks: PlannedTask[]
}

export type ProjectPlan = {
  name: string
  description: string
  sections: PlannedSection[]
}

/**
 * Turn a prompt or an extracted document (launch plan, playbook, brief) into a
 * structured project plan: sections → tasks (owner + time estimate) →
 * checkable action steps. Mirrors how a doc like the Career Navigator launch
 * plan reads. Uses the smart model since this output is the spine of a project
 * the user will work from for weeks.
 */
export async function generateProjectPlan(
  source: string,
  opts?: { repName?: string; titleHint?: string },
): Promise<ProjectPlan> {
  const today = new Date().toISOString().slice(0, 10)

  const response = await getAI().messages.create({
    model: MODEL_SMART,
    max_tokens: 8000,
    system: buildRepContext(opts?.repName),
    messages: [
      {
        role: 'user',
        content: `Today is ${today}. Turn the following into an actionable project plan.${
          opts?.titleHint ? ` Suggested title: "${opts.titleHint}".` : ''
        }

It may be a short instruction ("plan our Q3 product launch") or a full document
(a launch plan, playbook, brief). Either way, produce a plan a team can execute
and check off step by step.

Rules:
- Break the work into SECTIONS (logical phases or days — e.g. "Day 1 — Foundation", "Phase 1 — Research"). If the source already has sections/days, preserve them and their order.
- Under each section, list TASKS. Each task is a concrete deliverable with a short title.
- For each task, if the source names an owner (a person's name), put it in "owner_hint" exactly as written. If no owner is named, use null. Never invent names.
- For each task, capture a "time_estimate" if the source gives one ("15 min", "3 hours", "Ongoing"); otherwise null.
- Under each task, list "steps" — the granular action items someone checks off. Keep each step one short imperative line. If a task has no sub-steps, use an empty array.
- If the source is a one-line prompt, design a sensible plan yourself (3-6 sections, real tasks and steps).

Respond ONLY with JSON in this exact shape:

{
  "name": "project name",
  "description": "one or two sentence summary of the goal",
  "sections": [
    {
      "title": "section title",
      "subtitle": "optional one-line description or null",
      "tasks": [
        {
          "title": "task title",
          "description": "optional context or null",
          "owner_hint": "Name or null",
          "time_estimate": "e.g. 15 min, or null",
          "steps": ["action item", "action item"]
        }
      ]
    }
  ]
}

Source:
"""
${source.slice(0, 80000)}
"""`,
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<ProjectPlan>(text, { name: '', description: '', sections: [] })

  // Defensive: coerce to valid, non-empty shapes so a malformed model
  // response can't blow up the insert path.
  const sections: PlannedSection[] = Array.isArray(parsed.sections)
    ? parsed.sections
        .filter((s) => s && typeof s.title === 'string' && s.title.trim())
        .map((s) => ({
          title: s.title.trim(),
          subtitle: typeof s.subtitle === 'string' && s.subtitle.trim() ? s.subtitle.trim() : null,
          tasks: Array.isArray(s.tasks)
            ? s.tasks
                .filter((t) => t && typeof t.title === 'string' && t.title.trim())
                .map((t) => ({
                  title: t.title.trim(),
                  description:
                    typeof t.description === 'string' && t.description.trim()
                      ? t.description.trim()
                      : null,
                  owner_hint:
                    typeof t.owner_hint === 'string' && t.owner_hint.trim()
                      ? t.owner_hint.trim()
                      : null,
                  time_estimate:
                    typeof t.time_estimate === 'string' && t.time_estimate.trim()
                      ? t.time_estimate.trim()
                      : null,
                  steps: Array.isArray(t.steps)
                    ? t.steps
                        .filter((st): st is string => typeof st === 'string' && st.trim().length > 0)
                        .map((st) => st.trim())
                    : [],
                }))
            : [],
        }))
    : []

  return {
    name: (parsed.name ?? '').trim() || opts?.titleHint?.trim() || 'Untitled project',
    description: (parsed.description ?? '').trim(),
    sections,
  }
}

/**
 * Before building a plan, ask up to 4 short clarifying questions that would
 * materially change it (scope, deadline, owners, constraints, budget,
 * audience). Returns [] when the brief is already detailed enough. Powers the
 * "guided build" intake flow in the Projects tab.
 */
export async function proposeProjectQuestions(
  source: string,
  opts?: { repName?: string },
): Promise<string[]> {
  const response = await getAI().messages.create({
    model: MODEL_FAST,
    max_tokens: 500,
    system: buildRepContext(opts?.repName),
    messages: [
      {
        role: 'user',
        content: `The user wants to create a project from this brief:
"""
${source.slice(0, 8000)}
"""

Ask up to 4 SHORT clarifying questions whose answers would materially change the plan — things like scope, deadline/timeline, who owns what, budget, audience, or hard constraints. Skip anything the brief already answers. If it's already detailed enough to plan well, return fewer questions or an empty list.

Respond ONLY with JSON: { "questions": ["question one", "question two"] }`,
      },
    ],
  })
  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  const parsed = parseJsonResponse<{ questions: string[] }>(text, { questions: [] })
  return Array.isArray(parsed.questions)
    ? parsed.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 4).map((q) => q.trim())
    : []
}

// ── Mira natural-language intents ──────────────────────────────

export type MiraIntent =
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
      lead_name: string  // a lead, a partner, or a team member — the server resolves in that order
      subject: string
      body: string
      to_email?: string | null  // optional: rep stated it explicitly
      recipient_kind?: 'lead' | 'partner' | 'member' | null  // optional hint when the rep said which
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
  | {
      // Build a full project plan (sections → tasks → checkable steps) and save
      // it to the Projects tab. Use when the rep says things like "make a
      // project to launch X", "build me a plan/playbook/checklist for Y",
      // "turn this into a project". `brief` is what they want built, lightly
      // cleaned; `title` is a short name if they gave one.
      kind: 'create_project'
      brief: string
      title?: string | null
    }

export type MiraInterpretation = {
  intents: MiraIntent[]
  reply_hint?: string
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
  const response = await getAI().messages.create({
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
 * Turn structured data into a short, plain-text chat-ready summary.
 * Always returns a non-empty string.
 */
export async function generateReport(
  reportType: string,
  data: unknown,
  repName: string,
): Promise<string> {
  try {
    const response = await getAI().messages.create({
      model: MODEL_SMART,
      max_tokens: 600,
      system: buildRepContext(repName),
      messages: [
        {
          role: 'user',
          content: `Write a brief chat-ready ${reportType} update for the rep.
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

// ---------------------------------------------------------------------------
// Email triage
// ---------------------------------------------------------------------------

export type EmailTriageResult = {
  priority: 'urgent' | 'high' | 'normal' | 'low' | 'noise'
  category: 'client' | 'sales' | 'vendor' | 'internal' | 'personal' | 'newsletter' | 'noise' | 'other'
  needs_reply: boolean
  reasoning: string
}

export type EmailMessageForAI = {
  direction: 'inbound' | 'outbound'
  from: string
  fromName?: string | null
  to?: string[]
  subject?: string | null
  body: string | null
  sentAt?: string | null
}

function trimBody(body: string | null | undefined, maxChars: number): string {
  if (!body) return ''
  const cleaned = body.replace(/\r\n/g, '\n').trim()
  if (cleaned.length <= maxChars) return cleaned
  return cleaned.slice(0, maxChars) + '\n[...truncated]'
}

function renderThread(messages: EmailMessageForAI[], perMessageChars: number): string {
  return messages
    .map((m, i) => {
      const sentBy = m.direction === 'outbound' ? 'ME' : (m.fromName ? `${m.fromName} <${m.from}>` : m.from)
      const date = m.sentAt ? ` (${m.sentAt})` : ''
      return `--- Message ${i + 1} from ${sentBy}${date} ---\nSubject: ${m.subject ?? ''}\n${trimBody(m.body, perMessageChars)}`
    })
    .join('\n\n')
}

/**
 * Classify an inbound email thread. Cheap model, runs on every newly-synced
 * thread.
 *
 * Conventions:
 *  - "urgent" = real time-pressure (client paying us; outage; deadline today);
 *    use sparingly so it stays meaningful.
 *  - "noise" = newsletters, marketing, transactional notifications that
 *    don't need attention. needs_reply=false.
 *  - needs_reply only true when the last message is INBOUND and the sender
 *    actually expects a response (not just an FYI, not just a confirmation
 *    they already got).
 */
export async function triageEmail(input: {
  repName: string
  repEmail: string | null
  messages: EmailMessageForAI[]
  matchedLead?: { name: string; company: string; status: string } | null
}): Promise<EmailTriageResult> {
  const fallback: EmailTriageResult = {
    priority: 'normal',
    category: 'other',
    needs_reply: false,
    reasoning: 'fallback — classifier did not return valid JSON',
  }

  if (input.messages.length === 0) return fallback

  const lastInbound = [...input.messages].reverse().find((m) => m.direction === 'inbound')
  if (!lastInbound) {
    return {
      priority: 'low',
      category: 'other',
      needs_reply: false,
      reasoning: 'thread has no inbound messages',
    }
  }

  const threadText = renderThread(input.messages.slice(-6), 1500)
  const leadHint = input.matchedLead
    ? `\nMatched CRM lead: ${input.matchedLead.name} at ${input.matchedLead.company} (status: ${input.matchedLead.status})`
    : ''

  try {
    const response = await getAI().messages.create({
      model: MODEL_FAST,
      max_tokens: 350,
      system: buildRepContext(),
      messages: [
        {
          role: 'user',
          content: `Classify this email thread for ${input.repName} (${input.repEmail ?? 'unknown email'}).

Respond ONLY with JSON: {"priority":"urgent|high|normal|low|noise","category":"client|sales|vendor|internal|personal|newsletter|noise|other","needs_reply":true|false,"reasoning":"one sentence"}

THREAD (oldest first):
${threadText}${leadHint}

Rules:
- urgent = real time-pressure: paying client with active issue, outage, today-deadline, missed-meeting recovery. Use sparingly.
- high = important and time-sensitive within 1-2 days: hot prospect asking for next step, contract/signature requested, client escalation, "by Friday".
- normal = real work but no urgency: prospect follow-up, vendor question, internal coordination, scheduling.
- low = informational but worth seeing: FYIs, status updates, calendar invites already accepted.
- noise = newsletters, drip marketing, transactional receipts, automated notifications. needs_reply=false.
- needs_reply: true ONLY if the latest message is INBOUND AND the sender expects a response from the rep. False for FYIs, "thanks!" confirmations, auto-replies, and anything the rep already answered.
- category: client = existing paying customer; sales = prospect/lead; vendor = a service the rep pays; internal = rep's own team; personal = friends/family/non-work; newsletter = bulk marketing; noise = automated; other = unclear.
- reasoning: ONE short sentence. What signal drove the priority + needs_reply call.`,
        },
      ],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
    return parseJsonResponse<EmailTriageResult>(text, fallback)
  } catch (err) {
    console.error('[claude] triageEmail failed', err)
    return fallback
  }
}

export type AvailableSlot = { startIso: string; endIso: string }

/**
 * Format a list of free calendar slots for the LLM. Times are rendered in the
 * rep's timezone with weekday + 12-hour clock so the model can quote them
 * directly back to the recipient.
 */
function renderAvailability(
  slots: AvailableSlot[],
  tz: string,
): string {
  if (slots.length === 0) return ''
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const tzShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? tz
  const lines = slots.map((s) => {
    const start = fmt.format(new Date(s.startIso))
    const endFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    const end = endFmt.format(new Date(s.endIso))
    return `  • ${start}–${end} ${tzShort}`
  })
  return `\n\nREP'S AVAILABLE SLOTS (next 7 business days, ${tzShort}, source: Google Calendar FreeBusy):\n${lines.join('\n')}`
}

/**
 * Draft a reply to an inbound email thread in the rep's voice.
 *
 * Returns just the new reply body — no quoted history (Gmail collapses
 * the previous messages automatically). Subject is the original with
 * a "Re: " prefix unless the original already starts with "Re:".
 *
 * If availability is provided, the model is told to ONLY propose meeting
 * times from the supplied list — this prevents the classic LLM failure of
 * inventing a time that conflicts with the rep's actual calendar.
 */
export async function draftEmailReply(input: {
  repName: string
  repEmail: string | null
  messages: EmailMessageForAI[]
  matchedLead?: { name: string; company: string; status: string; notes?: string | null } | null
  styleNote?: string | null // e.g. "shorter", "warmer", "more direct"
  availability?: { slots: AvailableSlot[]; timezone: string } | null
  /** When set, learned email-style rules for this rep are injected so drafts honor past corrections. */
  repId?: string | null
}): Promise<{ subject: string; body: string }> {
  const fallbackSubject = (() => {
    const last = input.messages[input.messages.length - 1]
    const subj = last?.subject ?? 'your email'
    return /^re:/i.test(subj) ? subj : `Re: ${subj}`
  })()
  const fallback = {
    subject: fallbackSubject,
    body: `Hi,\n\nThanks for the note — circling back shortly with a real reply.\n\n${input.repName}`,
  }

  if (input.messages.length === 0) return fallback

  const threadText = renderThread(input.messages.slice(-8), 2500)
  const leadHint = input.matchedLead
    ? `\nMatched CRM lead: ${input.matchedLead.name} at ${input.matchedLead.company} (status: ${input.matchedLead.status})${input.matchedLead.notes ? `\nLead notes: ${input.matchedLead.notes}` : ''}`
    : ''
  const styleLine = input.styleNote ? `\nUser-requested style adjustment: ${input.styleNote}` : ''
  // Learned email-style rules (from past "make it shorter/warmer" regenerates),
  // so every future draft honors corrections instead of repeating them.
  const learnedLine = input.repId
    ? renderGuidance(await loadGuidance(input.repId, 'email'))
    : ''
  const availabilityBlock =
    input.availability && input.availability.slots.length > 0
      ? renderAvailability(input.availability.slots, input.availability.timezone)
      : ''
  const availabilityRule = input.availability
    ? input.availability.slots.length > 0
      ? `\n- IF (and only if) proposing a meeting time, choose from the REP'S AVAILABLE SLOTS block above. NEVER invent a time that isn't in that list — they conflict with the rep's calendar.\n- If the recipient asked for a specific time and that time is NOT in the available slots, say so and offer the nearest 1–2 alternatives from the list.`
      : `\n- The rep has NO open slots in the next 7 business days. Do NOT propose a specific time — instead offer to find time the following week or ask the recipient for their preferred week.`
    : ''

  try {
    const response = await getAI().messages.create({
      model: MODEL_SMART,
      max_tokens: 700,
      system: buildRepContext(),
      messages: [
        {
          role: 'user',
          content: `Draft a reply for ${input.repName} (${input.repEmail ?? 'unknown email'}) to the LAST inbound message in this thread.

Respond ONLY with JSON: {"subject":"...","body":"..."}

THREAD (oldest first):
${threadText}${leadHint}${styleLine}${learnedLine}${availabilityBlock}

Guidelines:
- Reply specifically to the LAST inbound message — reference its actual content, not the thread in general.
- 3-6 sentences. Shorter when the original is short.
- Subject: keep the existing subject with "Re: " prefix if not already present. Do not invent a new subject.
- First-person, contractions, direct. Match the sender's tone (formal vs casual).
- One clear next step at the end — propose a time, a decision, a follow-up — never a bare "let me know".
- NEVER open with: "I hope this email finds you well", "Thanks for reaching out", "Just following up", "Circling back".
- NEVER close with: "Let me know if you have any questions" or "Feel free to reach out".
- Do NOT quote or paraphrase the prior thread in the body — Gmail shows the history automatically.
- Do NOT use bullet points unless the sender used them.
- Sign off with just "${input.repName}" on its own line. No "Best," / "Cheers," / "Warmly,".${availabilityRule}`,
        },
      ],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
    return parseJsonResponse<{ subject: string; body: string }>(text, fallback)
  } catch (err) {
    console.error('[claude] draftEmailReply failed', err)
    return fallback
  }
}

