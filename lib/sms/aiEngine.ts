// AI SMS conversation engine.
//
// Entry point: handleInboundSms()  — called by the inbound webhook.
//
// Flow per inbound message:
//   1. Dedup via provider_message_id
//   2. Hard opt-out check → kill session + set DNC
//   3. Load session + setter context
//   4. Safety: escalation keyword → notify rep, go silent
//   5. Claude extraction (Haiku): structured signals from message + history
//   6. State machine advance
//   7. Claude response generation (Sonnet): persona-aware reply
//   8. Send via Twilio + log to sms_messages
//
// Feature-gated by SMS_AI_ENABLED=true env var.

import { supabase } from '@/lib/supabase'
import type { AiSalesperson } from '@/types'
import { getTwilioCreds, sendSms } from './twilioClient'

// ── Types ─────────────────────────────────────────────────────────────────

type SmsSession = {
  id: string
  rep_id: string
  ai_salesperson_id: string | null
  lead_id: string | null
  phone: string
  state: string
  discovery: Record<string, unknown>
  engagement_score: string
  appointment_likelihood: number
  last_sentiment: string | null
  buying_signal_count: number
  attempt_count: number
  ai_paused: boolean
  escalation_reason: string | null
  first_response_at: string | null
}

type ExtractionResult = {
  discoveryFields: Record<string, unknown>
  sentiment: 'positive' | 'neutral' | 'negative'
  buyingSignals: string[]
  hesitationSignals: string[]
  wantsAppointment: boolean
  softDismiss: boolean
  optOut: boolean
  needsEscalation: boolean
  userConfused: boolean
}

// ── Regex guards ──────────────────────────────────────────────────────────

const HARD_OPT_OUT_RE = /\b(stop|unsubscribe|cancel\s+texts?|end\s+texts?|quit|remove\s+me|take\s+me\s+off)\b/i
const SOFT_DISMISS_RE = /\b(not\s+interested|i'?m\s+(good|fine|all\s+set)|no\s+thanks|not\s+(right\s+)?now|leave\s+me\s+alone)\b/i
const ESCALATION_RE = /\b(medical\s+advice|legal\s+advice|lawsuit|lawyer|attorney|self[\s-]harm|suicid|hurt\s+myself)\b/i

// ── Main entry ────────────────────────────────────────────────────────────

export async function handleInboundSms(args: {
  repId: string
  from: string   // lead's phone (E.164)
  to: string     // our Twilio number
  body: string
  providerMessageId: string
}): Promise<void> {
  // 1. Dedup: Twilio may retry the webhook
  const { data: existing } = await supabase
    .from('sms_messages')
    .select('id')
    .eq('provider_message_id', args.providerMessageId)
    .maybeSingle()
  if (existing) return

  // 2. Find lead by phone
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, sms_consent, do_not_call, disposition')
    .eq('rep_id', args.repId)
    .eq('phone', args.from)
    .maybeSingle()
  const leadId = (lead as { id: string } | null)?.id ?? null

  // 3. Load session
  const { data: sessionRow } = await supabase
    .from('sms_ai_sessions')
    .select('*')
    .eq('rep_id', args.repId)
    .eq('phone', args.from)
    .maybeSingle()
  const session = sessionRow as SmsSession | null

  // 4. Log inbound before any other processing
  await supabase.from('sms_messages').insert({
    rep_id: args.repId,
    lead_id: leadId,
    session_id: session?.id ?? null,
    direction: 'inbound',
    body: args.body,
    from_phone: args.from,
    to_phone: args.to,
    status: 'delivered',
    is_ai_reply: false,
    provider_message_id: args.providerMessageId,
  })

  // 5. Hard opt-out — highest priority, handle even without a session
  if (HARD_OPT_OUT_RE.test(args.body)) {
    await handleHardOptOut({ repId: args.repId, leadId, phone: args.from, sessionId: session?.id ?? null })
    return
  }

  // No session or terminal → rep sees inbound but AI doesn't reply
  if (!session || session.state === 'opted_out' || session.state === 'appointment_booked') return

  // AI paused or escalated → rep takes over, just update last_response_at
  if (session.ai_paused || session.state === 'escalated') {
    await supabase
      .from('sms_ai_sessions')
      .update({ last_response_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', session.id)
    return
  }

  // 6. Load setter
  const { data: setterRow } = await supabase
    .from('ai_salespeople')
    .select('*')
    .eq('id', session.ai_salesperson_id ?? '')
    .maybeSingle()
  if (!setterRow) return
  const setter = setterRow as unknown as AiSalesperson

  // 7. Escalation keyword check
  if (ESCALATION_RE.test(args.body)) {
    await handleEscalation({ repId: args.repId, session, setter, phone: args.from, reason: 'escalation_keyword' })
    return
  }

  // 8. Load recent history (last 20 messages, oldest first)
  const { data: history } = await supabase
    .from('sms_messages')
    .select('direction, body, is_ai_reply, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false })
    .limit(20)
  const messages = ((history ?? []) as Array<{ direction: string; body: string; is_ai_reply: boolean }>).reverse()

  // 9. Run AI engine
  try {
    await runAiEngine({ repId: args.repId, session, setter, inboundBody: args.body, messages, lead: lead as Record<string, unknown> | null, fromPhone: args.from })
  } catch (err) {
    console.error('[sms-ai] engine error for rep', args.repId, err)
  }
}

// ── Conversation engine ───────────────────────────────────────────────────

async function runAiEngine(args: {
  repId: string
  session: SmsSession
  setter: AiSalesperson
  inboundBody: string
  messages: Array<{ direction: string; body: string; is_ai_reply: boolean }>
  lead: Record<string, unknown> | null
  fromPhone: string
}): Promise<void> {
  const { repId, session, setter, inboundBody, messages, lead, fromPhone } = args

  // Step 1: Extract signals (fast model)
  const extraction = await extractSignals({ setter, inboundBody, messages, session })

  // Step 2: Advance state machine
  const newState = advanceState(session.state, extraction)
  const now = new Date().toISOString()

  // Step 3: Update session scores + state
  const newBuyingCount = session.buying_signal_count + extraction.buyingSignals.length
  const newLikelihood = computeLikelihood(extraction, newBuyingCount)
  const newEngagement = computeEngagement(newLikelihood, extraction.sentiment)

  await supabase
    .from('sms_ai_sessions')
    .update({
      state: newState,
      discovery: { ...session.discovery, ...extraction.discoveryFields },
      last_sentiment: extraction.sentiment,
      buying_signal_count: newBuyingCount,
      appointment_likelihood: newLikelihood,
      engagement_score: newEngagement,
      last_response_at: now,
      first_response_at: session.first_response_at ?? now,
      updated_at: now,
    })
    .eq('id', session.id)

  // Hard opt-out detected by AI (in case regex missed it)
  if (extraction.optOut) {
    await handleHardOptOut({ repId, leadId: session.lead_id, phone: fromPhone, sessionId: session.id })
    return
  }

  // Soft dismissal → one reframe then go dormant
  if (extraction.softDismiss || newState === 'dormant') {
    const reframeBody = setter.sms_scripts?.no_response ?? buildGenericReframe(setter)
    if (reframeBody) {
      await dispatchReply({ repId, session: { ...session, state: newState }, toPhone: fromPhone, body: reframeBody, isAi: true })
    }
    return
  }

  // Step 4: Generate contextual AI reply (quality model)
  const aiReply = await generateReply({
    setter,
    session: { ...session, state: newState, discovery: { ...session.discovery, ...extraction.discoveryFields } },
    messages,
    inboundBody,
    lead,
  })
  if (!aiReply) return

  await dispatchReply({ repId, session, toPhone: fromPhone, body: aiReply, isAi: true })
}

// ── LLM: Extraction ───────────────────────────────────────────────────────

async function extractSignals(args: {
  setter: AiSalesperson
  inboundBody: string
  messages: Array<{ direction: string; body: string }>
  session: SmsSession
}): Promise<ExtractionResult> {
  const { setter, inboundBody, messages, session } = args

  const product = setter.product_intent ?? {}
  const qualifying = setter.call_script?.qualifying ?? []
  const collected = Object.keys(session.discovery)

  const system = `You extract structured signals from an SMS conversation.

Product context: ${product.name ?? 'our product'} — ${product.explanation ?? ''}
Qualifying questions to gather: ${qualifying.join('; ') || 'general interest and timing'}
Already collected: ${collected.length > 0 ? collected.join(', ') : 'nothing yet'}

Output ONLY valid JSON with these fields (no markdown, no extra text):
{
  "discoveryFields": { /* any qualifying info extracted from the latest message */ },
  "sentiment": "positive" | "neutral" | "negative",
  "buyingSignals": ["signal1"],
  "hesitationSignals": ["hesitation1"],
  "wantsAppointment": true | false,
  "softDismiss": true | false,
  "optOut": true | false,
  "needsEscalation": true | false,
  "userConfused": true | false
}`

  const conversationText = messages
    .map((m) => `${m.direction === 'inbound' ? 'LEAD' : 'AI'}: ${m.body}`)
    .join('\n')

  const userPrompt = `Conversation so far:\n${conversationText}\n\nLatest message from lead:\n${inboundBody}`

  try {
    const raw = await callClaude({ system, userMessage: userPrompt, model: 'claude-haiku-4-5-20251001', maxTokens: 400 })
    const parsed = JSON.parse(raw.trim()) as ExtractionResult
    return {
      discoveryFields: parsed.discoveryFields ?? {},
      sentiment: parsed.sentiment ?? 'neutral',
      buyingSignals: parsed.buyingSignals ?? [],
      hesitationSignals: parsed.hesitationSignals ?? [],
      wantsAppointment: Boolean(parsed.wantsAppointment),
      softDismiss: Boolean(parsed.softDismiss),
      optOut: Boolean(parsed.optOut),
      needsEscalation: Boolean(parsed.needsEscalation),
      userConfused: Boolean(parsed.userConfused),
    }
  } catch {
    return {
      discoveryFields: {},
      sentiment: 'neutral',
      buyingSignals: [],
      hesitationSignals: [],
      wantsAppointment: false,
      softDismiss: false,
      optOut: false,
      needsEscalation: false,
      userConfused: false,
    }
  }
}

// ── LLM: Response generation ──────────────────────────────────────────────

async function generateReply(args: {
  setter: AiSalesperson
  session: SmsSession
  messages: Array<{ direction: string; body: string }>
  inboundBody: string
  lead: Record<string, unknown> | null
}): Promise<string | null> {
  const { setter, session, messages, inboundBody, lead } = args

  const persona = setter.voice_persona ?? {}
  const product = setter.product_intent ?? {}
  const qualifying = setter.call_script?.qualifying ?? []
  const objections = setter.objection_responses ?? []
  const collected = Object.entries(session.discovery)
    .map(([k, v]) => `  ✓ ${k}: ${v}`)
    .join('\n')

  const notYetCollected = qualifying.filter(
    (q) => !Object.keys(session.discovery).some((k) => q.toLowerCase().includes(k.toLowerCase())),
  )
  const nextQuestion = notYetCollected[0] ?? null

  const objectionText = objections.length > 0
    ? objections.map((o) => `If "${o.trigger}": ${o.response}`).join('\n')
    : ''

  const system = `You ARE ${persona.ai_name ?? 'a sales assistant'}, ${persona.role_title ?? 'sales representative'}.
You are texting a lead about ${product.name ?? 'our service'}. ${product.explanation ?? ''}

CRITICAL RULES:
- Never reveal you are AI. You are ${persona.ai_name ?? 'a person'}.
- Keep messages SHORT (1–3 sentences max). This is SMS.
- Ask ONE question at a time, never multiple questions.
- Match the lead's energy level and tone.
- Be warm, casual, and human — not salesy or robotic.
- Never use exclamation marks excessively.
- Never say "I understand", "Great!", or "Certainly!".

Product intent: ${product.opt_in_reason ?? ''}
Lead's first name: ${((lead?.name as string) ?? '').split(' ')[0] || ''}

What's been collected:
${collected || '  (nothing yet)'}

Next thing to find out: ${nextQuestion ?? (session.state === 'discovery_complete' ? 'offer to schedule a quick call' : 'general interest')}

${objectionText ? `Objection handling:\n${objectionText}` : ''}`

  const conversationText = messages
    .map((m) => `${m.direction === 'inbound' ? 'LEAD' : 'YOU'}: ${m.body}`)
    .join('\n')

  const userPrompt = `${conversationText}\nLEAD: ${inboundBody}\n\nYou (${persona.ai_name ?? 'You'}):`

  try {
    const reply = await callClaude({ system, userMessage: userPrompt, model: 'claude-sonnet-4-6', maxTokens: 150 })
    const cleaned = reply.trim().replace(/^(You:|AI:|Assistant:)\s*/i, '')
    if (!cleaned || cleaned.length < 5) return null
    if (cleaned.length > 320) return cleaned.slice(0, 317) + '...'
    return cleaned
  } catch (err) {
    console.error('[sms-ai] generateReply failed', err)
    return null
  }
}

// ── State machine ─────────────────────────────────────────────────────────

function advanceState(current: string, extraction: ExtractionResult): string {
  if (extraction.optOut) return 'opted_out'
  if (extraction.needsEscalation) return 'escalated'
  if (extraction.softDismiss && current !== 'appointment_proposed') return 'dormant'

  switch (current) {
    case 'context_confirmed':
      return 'discovery_in_progress'
    case 'discovery_in_progress':
      if (extraction.wantsAppointment) return 'appointment_proposed'
      if (Object.keys(extraction.discoveryFields).length >= 3) return 'discovery_complete'
      return 'discovery_in_progress'
    case 'discovery_complete':
      if (extraction.wantsAppointment) return 'appointment_proposed'
      return 'discovery_complete'
    case 'appointment_proposed':
      if (extraction.wantsAppointment) return 'appointment_booked'
      if (extraction.softDismiss) return 'dormant'
      return 'appointment_proposed'
    default:
      return current
  }
}

function computeLikelihood(extraction: ExtractionResult, buyingCount: number): number {
  let score = 0
  if (extraction.sentiment === 'positive') score += 20
  if (extraction.sentiment === 'negative') score -= 15
  score += Math.min(extraction.buyingSignals.length * 15, 30)
  score += Math.min(buyingCount * 5, 20)
  if (extraction.wantsAppointment) score += 25
  score -= extraction.hesitationSignals.length * 10
  return Math.max(0, Math.min(100, score))
}

function computeEngagement(likelihood: number, sentiment: string): string {
  if (likelihood >= 60 || sentiment === 'positive') return 'high'
  if (likelihood >= 30) return 'medium'
  return 'low'
}

// ── Opt-out / escalation handlers ─────────────────────────────────────────

async function handleHardOptOut(args: {
  repId: string
  leadId: string | null
  phone: string
  sessionId: string | null
}): Promise<void> {
  const now = new Date().toISOString()

  // Kill session
  if (args.sessionId) {
    await supabase
      .from('sms_ai_sessions')
      .update({ state: 'opted_out', updated_at: now })
      .eq('id', args.sessionId)
  }

  // Set sms_consent=false + disposition on lead
  if (args.leadId) {
    await supabase
      .from('leads')
      .update({ sms_consent: false, do_not_call: true, disposition: 'do_not_contact' })
      .eq('id', args.leadId)
      .eq('rep_id', args.repId)
  }

  // Cancel pending SMS followups for this lead
  if (args.leadId) {
    await supabase
      .from('ai_salesperson_followups')
      .update({ status: 'cancelled' })
      .eq('rep_id', args.repId)
      .eq('lead_id', args.leadId)
      .eq('channel', 'sms')
      .eq('status', 'pending')
  }

  // Send farewell reply using Twilio
  const creds = await getTwilioCreds(args.repId)
  if (creds) {
    try {
      await sendSms(creds, args.phone, "You've been unsubscribed. Reply START to opt back in.")
    } catch {
      // Non-fatal
    }
  }
}

async function handleEscalation(args: {
  repId: string
  session: SmsSession
  setter: AiSalesperson
  phone: string
  reason: string
}): Promise<void> {
  const { repId, session, setter, phone, reason } = args
  await supabase
    .from('sms_ai_sessions')
    .update({ state: 'escalated', ai_paused: true, escalation_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', session.id)

  // Safe response to lead
  const persona = setter.voice_persona ?? {}
  const safeLine = `I want to make sure I connect you with the right person. I'll have someone reach out to you shortly.`
  const creds = await getTwilioCreds(repId)
  if (creds) {
    try {
      await sendSms(creds, phone, safeLine)
      await supabase.from('sms_messages').insert({
        rep_id: repId,
        lead_id: session.lead_id,
        session_id: session.id,
        direction: 'outbound',
        body: safeLine,
        from_phone: creds.phoneNumber,
        to_phone: phone,
        status: 'sent',
        is_ai_reply: true,
      })
    } catch { /* non-fatal */ }
  }

  // Notify rep members with Telegram (best-effort)
  void notifyEscalation(repId, persona.ai_name ?? 'AI SMS', phone, reason).catch(() => {})
}

async function notifyEscalation(repId: string, agentName: string, phone: string, reason: string): Promise<void> {
  const { sendTelegramMessage } = await import('@/lib/telegram')
  const { data: members } = await supabase
    .from('members')
    .select('telegram_chat_id, role')
    .eq('rep_id', repId)
    .not('telegram_chat_id', 'is', null)
  for (const m of members ?? []) {
    if (!['owner', 'admin', 'rep'].includes(m.role as string)) continue
    if (!m.telegram_chat_id) continue
    await sendTelegramMessage(
      m.telegram_chat_id as string,
      `⚠️ *${agentName}* SMS conversation escalated.\nLead phone: ${phone}\nReason: ${reason}\nReview in SMS inbox.`,
    ).catch(() => {})
  }
}

// ── Send helper ───────────────────────────────────────────────────────────

async function dispatchReply(args: {
  repId: string
  session: SmsSession
  toPhone: string
  body: string
  isAi: boolean
}): Promise<void> {
  const { repId, session, toPhone, body, isAi } = args
  const creds = await getTwilioCreds(repId)
  if (!creds) {
    console.error('[sms-ai] no Twilio creds for rep', repId)
    return
  }
  try {
    const result = await sendSms(creds, toPhone, body)
    await supabase.from('sms_messages').insert({
      rep_id: repId,
      lead_id: session.lead_id,
      session_id: session.id,
      direction: 'outbound',
      body,
      from_phone: creds.phoneNumber,
      to_phone: toPhone,
      status: 'sent',
      is_ai_reply: isAi,
      provider_message_id: result.sid,
    })
    await supabase
      .from('sms_ai_sessions')
      .update({ last_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', session.id)
  } catch (err) {
    console.error('[sms-ai] dispatchReply failed', err)
    await supabase.from('sms_messages').insert({
      rep_id: repId,
      lead_id: session.lead_id,
      session_id: session.id,
      direction: 'outbound',
      body,
      from_phone: creds.phoneNumber,
      to_phone: toPhone,
      status: 'failed',
      is_ai_reply: isAi,
      error_message: String(err),
    })
  }
}

// ── Outbound: send first message + create session ─────────────────────────
// Called by the SMS cron for each pending ai_salesperson_followups row.

export async function sendFirstSms(args: {
  repId: string
  setterId: string
  leadId: string | null
  phone: string
  followupId: string
  reason: string | null
  callOutcome?: string | null  // 'voicemail' | 'no_answer' — context for opener
}): Promise<{ ok: boolean; reason?: string }> {
  const { repId, setterId, leadId, phone, followupId, reason, callOutcome } = args

  // Verify SMS is enabled
  if (process.env.SMS_AI_ENABLED !== 'true') {
    return { ok: false, reason: 'sms_ai_disabled' }
  }

  // Load credentials
  const creds = await getTwilioCreds(repId)
  if (!creds) return { ok: false, reason: 'no_twilio_creds' }

  // Load setter
  const { data: setterRow } = await supabase
    .from('ai_salespeople')
    .select('*')
    .eq('id', setterId)
    .maybeSingle()
  if (!setterRow) return { ok: false, reason: 'setter_not_found' }
  const setter = setterRow as unknown as AiSalesperson

  if (setter.status !== 'active') return { ok: false, reason: 'setter_not_active' }
  if (!setter.sms_ai_enabled) return { ok: false, reason: 'sms_ai_disabled_for_setter' }

  // Check if an active session already exists for this phone
  const { data: existing } = await supabase
    .from('sms_ai_sessions')
    .select('id, state')
    .eq('rep_id', repId)
    .eq('phone', phone)
    .maybeSingle()
  if (existing && !['dormant', 'opted_out'].includes((existing as { state: string }).state)) {
    return { ok: false, reason: 'active_session_exists' }
  }

  // Load lead context
  let leadName = ''
  if (leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('name, sms_consent, do_not_call, disposition')
      .eq('id', leadId)
      .maybeSingle()
    if ((lead as Record<string, unknown> | null)?.do_not_call === true) return { ok: false, reason: 'do_not_call' }
    if ((lead as Record<string, unknown> | null)?.sms_consent === false) return { ok: false, reason: 'sms_consent_false' }
    const dncDispositions = new Set(['do_not_contact', 'disqualified', 'appointment_set', 'application_approved'])
    if (dncDispositions.has(String((lead as Record<string, unknown> | null)?.disposition ?? ''))) {
      return { ok: false, reason: 'protected_disposition' }
    }
    leadName = String((lead as Record<string, unknown> | null)?.name ?? '').split(' ')[0]
  }

  // Build first message from template or fallback
  const body = buildFirstMessage(setter, leadName, callOutcome ?? null, reason)

  // Send
  let sid: string
  try {
    const result = await sendSms(creds, phone, body)
    sid = result.sid
  } catch (err) {
    return { ok: false, reason: `send_failed: ${String(err)}` }
  }

  // Create or reactivate session
  const sessionUpsertData = {
    rep_id: repId,
    ai_salesperson_id: setterId,
    lead_id: leadId,
    phone,
    state: 'context_confirmed',
    discovery: {},
    engagement_score: 'low',
    appointment_likelihood: 0,
    last_sentiment: null,
    buying_signal_count: 0,
    attempt_count: 1,
    ai_paused: false,
    escalation_reason: null,
    last_contact_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  let sessionId: string
  if (existing) {
    // Reactivate dormant session
    await supabase
      .from('sms_ai_sessions')
      .update(sessionUpsertData)
      .eq('id', (existing as { id: string }).id)
    sessionId = (existing as { id: string }).id
  } else {
    const { data: newSession } = await supabase
      .from('sms_ai_sessions')
      .insert(sessionUpsertData)
      .select('id')
      .single()
    sessionId = (newSession as { id: string }).id
  }

  // Log the outbound message
  await supabase.from('sms_messages').insert({
    rep_id: repId,
    lead_id: leadId,
    session_id: sessionId,
    direction: 'outbound',
    body,
    from_phone: creds.phoneNumber,
    to_phone: phone,
    status: 'sent',
    is_ai_reply: true,
    provider_message_id: sid,
  })

  // Mark the followup row as done
  await supabase
    .from('ai_salesperson_followups')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', followupId)

  return { ok: true }
}

function buildFirstMessage(
  setter: AiSalesperson,
  leadFirstName: string,
  callOutcome: string | null,
  reason: string | null,
): string {
  const name = leadFirstName ? `${leadFirstName}, ` : ''
  const persona = setter.voice_persona ?? {}
  const product = setter.product_intent ?? {}
  const agentName = persona.ai_name ?? 'someone from our team'
  const productName = product.name ?? 'our services'

  // Use configured script if available
  if (callOutcome === 'voicemail' && setter.sms_scripts?.missed) {
    return setter.sms_scripts.missed.replace('{{name}}', leadFirstName).replace('{{product}}', productName)
  }
  if (setter.sms_scripts?.first) {
    return setter.sms_scripts.first.replace('{{name}}', leadFirstName).replace('{{product}}', productName)
  }

  // Fallback based on call context
  if (callOutcome === 'voicemail') {
    return `Hey ${name}this is ${agentName} — just left you a voicemail about ${productName}. Easier to chat over text?`
  }
  if (callOutcome === 'no_answer') {
    return `Hey ${name}this is ${agentName}, tried calling about ${productName}. Is this a better way to reach you?`
  }

  // Generic first touch
  return `Hey ${name}this is ${agentName} reaching out about ${productName}. Is now a good time to connect?`
}

function buildGenericReframe(setter: AiSalesperson): string | null {
  const product = setter.product_intent ?? {}
  const name = setter.voice_persona?.ai_name ?? 'us'
  return `Totally understand — no pressure at all. Just wanted to make sure ${product.name ?? 'this'} wasn't something that could help. Feel free to reach out whenever the time is right.`
}

// ── Claude API ────────────────────────────────────────────────────────────

async function callClaude(args: {
  system: string
  userMessage: string
  model?: string
  maxTokens?: number
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: args.maxTokens ?? 512,
      system: args.system,
      messages: [{ role: 'user', content: args.userMessage }],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Anthropic API error (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
  return data.content.find((c) => c.type === 'text')?.text ?? ''
}
