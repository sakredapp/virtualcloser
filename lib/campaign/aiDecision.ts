/**
 * AI Decision Engine — Claude decides what to do next for a lead after
 * each campaign touchpoint (call outcome, SMS reply, webhook event).
 *
 * The default engine is rule-based (fast, no API cost). Claude is called
 * only when there's ambiguous signal — an SMS reply with unknown intent,
 * or a call that ended without a clear outcome.
 */

import Anthropic from '@anthropic-ai/sdk'

export type TouchpointOutcome =
  | 'voicemail'
  | 'answered_booked'
  | 'answered_not_interested'
  | 'answered_callback'
  | 'answered_no_close'     // answered but didn't book
  | 'no_answer'
  | 'sms_sent'
  | 'sms_replied_positive'  // replied with interest / question
  | 'sms_replied_negative'  // replied with stop / not interested
  | 'sms_replied_callback'  // replied asking to call back / different time
  | 'sms_no_reply'

export type NextAction = {
  action: 'sms' | 'call' | 'pause' | 'stop'
  delay_min: number
  reason: string
  urgency: 'normal' | 'high'
  skip_to_step?: number
}

// ── Rule-based fast path ──────────────────────────────────────────────────
// Handles the 95% of cases that don't need AI reasoning.

export function ruleBasedDecision(
  outcome: TouchpointOutcome,
  currentStep: number,
  maxSteps: number,
): NextAction | null {
  switch (outcome) {
    case 'answered_booked':
      return { action: 'stop', delay_min: 0, reason: 'Lead booked — campaign complete.', urgency: 'normal' }

    case 'answered_not_interested':
      return { action: 'stop', delay_min: 0, reason: 'Lead said not interested on call.', urgency: 'normal' }

    case 'sms_replied_negative':
      return { action: 'stop', delay_min: 0, reason: 'Lead replied STOP / not interested via SMS.', urgency: 'normal' }

    case 'answered_callback':
      // They asked to be called back — try again in 3h, bump priority
      return { action: 'call', delay_min: 180, reason: 'Lead asked to be called back.', urgency: 'high' }

    case 'sms_replied_callback':
      return { action: 'call', delay_min: 60, reason: 'Lead replied asking us to call.', urgency: 'high' }

    case 'voicemail':
    case 'no_answer':
    case 'sms_sent':
    case 'sms_no_reply':
    case 'answered_no_close':
      // Let the template sequence drive the next step
      return null

    case 'sms_replied_positive':
      // Positive reply — try to call ASAP, don't wait for template schedule
      return { action: 'call', delay_min: 5, reason: 'Lead replied positively to SMS — calling immediately.', urgency: 'high' }
  }
}

// ── Claude-powered decision for ambiguous cases ───────────────────────────

export async function aiDecision(args: {
  leadName: string
  leadPhone: string
  state: string
  campaignKey: string
  currentStep: number
  maxSteps: number
  lastOutcome: TouchpointOutcome | string
  replyText?: string          // if outcome is sms_replied_*
  recentEventSummary: string  // last 3–5 events as plain text
}): Promise<NextAction> {
  const client = new Anthropic()

  const prompt = `You are an AI campaign manager for a health insurance sales team. A lead has just had a touchpoint and you need to decide what to do next.

Lead: ${args.leadName} in ${args.state}
Campaign: ${args.campaignKey} (step ${args.currentStep} of ${args.maxSteps})
Last outcome: ${args.lastOutcome}
${args.replyText ? `Reply text from lead: "${args.replyText}"` : ''}

Recent activity:
${args.recentEventSummary}

Decide the next action. Options:
- sms: send an SMS
- call: place an AI dial
- pause: wait without action (specify delay)
- stop: end the campaign (lead is lost or booked)

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "action": "sms" | "call" | "pause" | "stop",
  "delay_min": <minutes to wait before action, 0 for immediate>,
  "reason": "<one sentence explaining the decision>",
  "urgency": "normal" | "high"
}`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const parsed = JSON.parse(text) as NextAction
    return parsed
  } catch {
    // Fallback: continue with default delay
    return {
      action: 'sms',
      delay_min: 1440,
      reason: 'AI decision failed — using default 24h follow-up.',
      urgency: 'normal',
    }
  }
}

// ── Classify incoming SMS reply ───────────────────────────────────────────
// Maps raw SMS text to a structured outcome key.

const STOP_WORDS = ['stop', 'unsubscribe', 'no thanks', 'not interested', 'remove me', 'dont contact', "don't contact"]
const POSITIVE_WORDS = ['yes', 'interested', 'tell me more', 'how much', 'what', 'sounds good', 'ok', 'sure', 'info', 'call me', 'more info']
const CALLBACK_WORDS = ['call me', 'call back', 'try me', 'reach me', 'better time', 'later today', 'tomorrow']

export function classifySmsReply(text: string): TouchpointOutcome {
  const lower = text.toLowerCase()
  if (STOP_WORDS.some((w) => lower.includes(w))) return 'sms_replied_negative'
  if (CALLBACK_WORDS.some((w) => lower.includes(w))) return 'sms_replied_callback'
  if (POSITIVE_WORDS.some((w) => lower.includes(w))) return 'sms_replied_positive'
  // Unknown intent — treat as positive (reply at all is a warm signal)
  return 'sms_replied_positive'
}
