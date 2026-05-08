/**
 * Lead Campaign Engine
 *
 * The core orchestrator that:
 *  - starts a campaign for a lead (startCampaign)
 *  - processes all due steps on every tick (runCampaignTick)
 *  - handles call/SMS outcomes to update state (handleCallOutcome, handleSmsReply)
 *  - stops a campaign early (stopCampaign)
 *
 * Called every 30s by the Hetzner worker or every 60s by a Vercel Cron.
 * All DB operations are idempotent — double-ticking a campaign is safe.
 */

import { supabase } from '@/lib/supabase'
import { getTwilioCreds, sendSms } from '@/lib/sms/twilioClient'
import { getTemplate } from './templates'
import { pickLocalNumber } from './localPresence'
import {
  ruleBasedDecision,
  aiDecision,
  classifySmsReply,
  type TouchpointOutcome,
  type NextAction,
} from './aiDecision'
import type { AiSalesperson } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────

export type LeadCampaign = {
  id: string
  rep_id: string
  ai_salesperson_id: string | null
  lead_id: string
  template_key: string
  status: 'active' | 'paused' | 'completed' | 'stopped' | 'failed'
  current_step: number
  max_steps: number
  next_action_at: string | null
  last_action_at: string | null
  last_action_type: string | null
  last_outcome: string | null
  paused_until: string | null
  context: Record<string, unknown>
  stop_reason: string | null
  created_at: string
  updated_at: string
}

export type StartCampaignArgs = {
  repId: string
  aiSalespersonId: string
  leadId: string
  templateKey: string
  context?: Record<string, unknown>   // e.g. { customer_name, state, current_premium }
}

export type CampaignTickResult = {
  processed: number
  skipped: number
  errors: number
}

// ── Start ─────────────────────────────────────────────────────────────────

export async function startCampaign(args: StartCampaignArgs): Promise<{ ok: boolean; campaignId?: string; reason?: string }> {
  const template = getTemplate(args.templateKey)
  if (!template) return { ok: false, reason: `unknown_template:${args.templateKey}` }

  // Check lead's current disposition — don't start if already stopped
  const { data: lead } = await supabase
    .from('crm_leads')
    .select('disposition, phone')
    .eq('id', args.leadId)
    .maybeSingle()

  if (!lead) {
    // Try the leads table as fallback
    const { data: rawLead } = await supabase
      .from('leads')
      .select('phone')
      .eq('id', args.leadId)
      .maybeSingle()
    if (!rawLead) return { ok: false, reason: 'lead_not_found' }
  }

  const disp = (lead as { disposition?: string | null } | null)?.disposition
  if (disp && template.stop_dispositions.includes(disp)) {
    return { ok: false, reason: `lead_disposition_blocks_campaign:${disp}` }
  }

  // Upsert — if active campaign already exists, skip silently
  const { data, error } = await supabase
    .from('lead_campaigns')
    .insert({
      rep_id: args.repId,
      ai_salesperson_id: args.aiSalespersonId,
      lead_id: args.leadId,
      template_key: args.templateKey,
      status: 'active',
      current_step: 0,
      max_steps: template.steps.length,
      next_action_at: new Date().toISOString(),   // fire step 1 immediately on next tick
      context: args.context ?? {},
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = unique_violation (active campaign already exists)
    if (error.code === '23505') return { ok: false, reason: 'campaign_already_active' }
    return { ok: false, reason: error.message }
  }

  return { ok: true, campaignId: data.id }
}

// ── Stop ──────────────────────────────────────────────────────────────────

export async function stopCampaign(
  campaignId: string,
  reason: string,
  finalStatus: 'completed' | 'stopped' | 'failed' = 'stopped',
): Promise<void> {
  await supabase
    .from('lead_campaigns')
    .update({ status: finalStatus, stop_reason: reason, next_action_at: null })
    .eq('id', campaignId)
}

// ── Tick ──────────────────────────────────────────────────────────────────
// Process all campaigns with next_action_at <= now().
// Designed to be called every 30–60 seconds.

export async function runCampaignTick(repId?: string): Promise<CampaignTickResult> {
  const result: CampaignTickResult = { processed: 0, skipped: 0, errors: 0 }

  let query = supabase
    .from('lead_campaigns')
    .select('*')
    .eq('status', 'active')
    .lte('next_action_at', new Date().toISOString())
    .order('next_action_at', { ascending: true })
    .limit(50)   // process max 50 per tick to avoid timeouts

  if (repId) query = query.eq('rep_id', repId)

  const { data: due, error } = await query
  if (error || !due?.length) return result

  for (const row of due as LeadCampaign[]) {
    try {
      const processed = await processCampaignStep(row)
      if (processed) result.processed++
      else result.skipped++
    } catch (err) {
      console.error('[campaign] step error', { campaignId: row.id, err })
      result.errors++
      // Mark failed after 3 consecutive errors — check error_count in context
      const errCount = ((row.context.error_count as number) ?? 0) + 1
      if (errCount >= 3) {
        await stopCampaign(row.id, 'max_errors_reached', 'failed')
      } else {
        await supabase
          .from('lead_campaigns')
          .update({
            context: { ...row.context, error_count: errCount },
            next_action_at: new Date(Date.now() + 5 * 60_000).toISOString(), // retry in 5 min
          })
          .eq('id', row.id)
      }
    }
  }

  return result
}

// ── Process a single campaign step ────────────────────────────────────────

async function processCampaignStep(campaign: LeadCampaign): Promise<boolean> {
  const template = getTemplate(campaign.template_key)
  if (!template) {
    await stopCampaign(campaign.id, 'unknown_template', 'failed')
    return false
  }

  const nextStepIndex = campaign.current_step   // 0-indexed into template.steps
  if (nextStepIndex >= template.steps.length) {
    await stopCampaign(campaign.id, 'all_steps_completed', 'completed')
    return false
  }

  const step = template.steps[nextStepIndex]

  // Load lead
  const lead = await getLeadForCampaign(campaign.lead_id, campaign.rep_id)
  if (!lead) {
    await stopCampaign(campaign.id, 'lead_not_found', 'failed')
    return false
  }

  // Check stop dispositions
  if (lead.disposition && template.stop_dispositions.includes(lead.disposition)) {
    const isSuccess = template.success_dispositions.includes(lead.disposition)
    await stopCampaign(campaign.id, `disposition:${lead.disposition}`, isSuccess ? 'completed' : 'stopped')
    await logEvent(campaign, step.step, 'system', null, 'stopped', `Lead disposition ${lead.disposition}`)
    return true
  }

  // Load setter
  const setter = await getSetterForCampaign(campaign.ai_salesperson_id)
  if (!setter) {
    await stopCampaign(campaign.id, 'setter_not_found', 'failed')
    return false
  }

  // Execute the step
  const context = { ...campaign.context, ...lead }

  let channelRefId: string | null = null
  let outcome: string = 'sent'

  if (step.action === 'sms') {
    const smsResult = await executeSmsStep(campaign, step, setter, lead, context)
    channelRefId = smsResult.messageId ?? null
    outcome = smsResult.ok ? 'sms_sent' : `sms_failed:${smsResult.reason}`
  } else if (step.action === 'call') {
    const callResult = await executeCallStep(campaign, step, setter, lead)
    channelRefId = callResult.callId ?? null
    outcome = callResult.ok ? 'call_queued' : `call_failed:${callResult.reason}`
  }

  // Log the event
  await logEvent(campaign, step.step, step.action, channelRefId, outcome, step.label ?? null)

  // Advance campaign state
  const isLastStep = nextStepIndex + 1 >= template.steps.length
  if (isLastStep) {
    await supabase
      .from('lead_campaigns')
      .update({
        status: 'completed',
        current_step: nextStepIndex + 1,
        last_action_at: new Date().toISOString(),
        last_action_type: step.action,
        last_outcome: outcome,
        next_action_at: null,
        stop_reason: 'all_steps_completed',
      })
      .eq('id', campaign.id)
  } else {
    const nextStep = template.steps[nextStepIndex + 1]
    const nextAt = new Date(Date.now() + nextStep.delay_min * 60_000).toISOString()
    await supabase
      .from('lead_campaigns')
      .update({
        current_step: nextStepIndex + 1,
        last_action_at: new Date().toISOString(),
        last_action_type: step.action,
        last_outcome: outcome,
        next_action_at: nextAt,
        context: { ...campaign.context, error_count: 0 },
      })
      .eq('id', campaign.id)
  }

  return true
}

// ── SMS execution ─────────────────────────────────────────────────────────

async function executeSmsStep(
  campaign: LeadCampaign,
  step: { step: number; sms_script?: string },
  setter: AiSalesperson,
  lead: LeadData,
  context: Record<string, unknown>,
): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
  const creds = await getTwilioCreds(campaign.rep_id)
  if (!creds) return { ok: false, reason: 'no_twilio_creds' }
  if (!setter.phone_number) return { ok: false, reason: 'setter_has_no_phone' }
  if (!lead.phone) return { ok: false, reason: 'lead_has_no_phone' }

  // Get the SMS template text
  const scriptKey = step.sms_script ?? 'first'
  const rawTemplate = (setter.sms_scripts as Record<string, string>)?.[scriptKey]
  if (!rawTemplate) return { ok: false, reason: `no_sms_script:${scriptKey}` }

  // Fill in template variables
  const body = fillTemplate(rawTemplate, context)

  try {
    const result = await sendSms(creds, lead.phone, body)
    return { ok: true, messageId: result.sid }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'sms_send_failed' }
  }
}

// ── Call execution ────────────────────────────────────────────────────────
// Inserts a dialer queue row — the existing queue processor picks it up.

async function executeCallStep(
  campaign: LeadCampaign,
  step: { step: number },
  setter: AiSalesperson,
  lead: LeadData,
): Promise<{ ok: boolean; callId?: string; reason?: string }> {
  if (!lead.phone) return { ok: false, reason: 'lead_has_no_phone' }

  // Pick a local presence number (same area code as lead) if pool exists
  const localNumber = await pickLocalNumber(campaign.rep_id, lead.phone).catch(() => null)

  const { data, error } = await supabase
    .from('dialer_queue')
    .insert({
      rep_id: campaign.rep_id,
      lead_id: campaign.lead_id,
      ai_salesperson_id: campaign.ai_salesperson_id,
      dialer_mode: 'appointment_setter',
      status: 'pending',
      phone: lead.phone,
      attempt_count: 0,
      max_attempts: 1,
      scheduled_for: new Date().toISOString(),
      context: {
        campaign_id: campaign.id,
        campaign_step: step.step,
        local_presence_number: localNumber?.e164 ?? null,
        local_presence_trunk: localNumber?.trunk_sid ?? null,
        ...campaign.context,
      },
    })
    .select('id')
    .single()

  if (error) return { ok: false, reason: error.message }
  return { ok: true, callId: data.id }
}

// ── Outcome handlers ──────────────────────────────────────────────────────
// Called by webhooks after a touchpoint completes.

export async function handleCallOutcome(args: {
  campaignId: string
  callId: string
  outcome: TouchpointOutcome
  disposition?: string        // disposition applied to the lead by the AI caller
}): Promise<void> {
  const { data: campaign } = await supabase
    .from('lead_campaigns')
    .select('*')
    .eq('id', args.campaignId)
    .eq('status', 'active')
    .maybeSingle()

  if (!campaign) return

  const c = campaign as LeadCampaign
  const template = getTemplate(c.template_key)
  if (!template) return

  // Check stop/success dispositions first
  if (args.disposition) {
    if (template.stop_dispositions.includes(args.disposition) || template.success_dispositions.includes(args.disposition)) {
      const isSuccess = template.success_dispositions.includes(args.disposition)
      await stopCampaign(c.id, `disposition:${args.disposition}`, isSuccess ? 'completed' : 'stopped')
      await logEvent(c, c.current_step, 'webhook', args.callId, args.disposition, 'Call outcome disposition')
      return
    }
  }

  // Rule-based decision first
  const ruleDecision = ruleBasedDecision(args.outcome, c.current_step, c.max_steps)

  if (ruleDecision) {
    await applyDecision(c, ruleDecision, args.callId, 'call')
  }
  // If rule returns null, the campaign continues on its normal schedule (no change)
}

export async function handleSmsReply(args: {
  repId: string
  phone: string
  replyText: string
}): Promise<void> {
  // Find the active campaign for this phone number
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('rep_id', args.repId)
    .eq('phone', args.phone)
    .maybeSingle()

  if (!lead) return

  const { data: campaign } = await supabase
    .from('lead_campaigns')
    .select('*')
    .eq('rep_id', args.repId)
    .eq('lead_id', (lead as { id: string }).id)
    .eq('status', 'active')
    .maybeSingle()

  if (!campaign) return

  const c = campaign as LeadCampaign
  const outcome = classifySmsReply(args.replyText)

  // Rule-based first
  const ruleDecision = ruleBasedDecision(outcome, c.current_step, c.max_steps)
  if (ruleDecision) {
    await applyDecision(c, ruleDecision, null, 'sms')
    await logEvent(c, c.current_step, 'webhook', null, outcome, `SMS reply: "${args.replyText.slice(0, 100)}"`)
    return
  }

  // Ambiguous — ask Claude
  const recentEvents = await getRecentEventSummary(c.id)
  const aiResult = await aiDecision({
    leadName: (c.context.customer_name as string) ?? 'Unknown',
    leadPhone: args.phone,
    state: (c.context.state as string) ?? '',
    campaignKey: c.template_key,
    currentStep: c.current_step,
    maxSteps: c.max_steps,
    lastOutcome: outcome,
    replyText: args.replyText,
    recentEventSummary: recentEvents,
  })

  await applyDecision(c, aiResult, null, 'sms')
  await logEvent(c, c.current_step, 'ai_decision', null, outcome, `Claude: ${aiResult.reason}`)
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function applyDecision(
  campaign: LeadCampaign,
  decision: NextAction,
  channelRefId: string | null,
  triggerType: 'sms' | 'call',
): Promise<void> {
  if (decision.action === 'stop') {
    await stopCampaign(campaign.id, decision.reason)
    return
  }

  const nextAt = new Date(Date.now() + decision.delay_min * 60_000).toISOString()

  if (decision.skip_to_step !== undefined) {
    await supabase
      .from('lead_campaigns')
      .update({ current_step: decision.skip_to_step - 1, next_action_at: nextAt })
      .eq('id', campaign.id)
  } else if (decision.action === 'pause') {
    await supabase
      .from('lead_campaigns')
      .update({ paused_until: nextAt, next_action_at: nextAt })
      .eq('id', campaign.id)
  } else {
    // High urgency — override next_action_at to fire sooner
    if (decision.urgency === 'high') {
      await supabase
        .from('lead_campaigns')
        .update({ next_action_at: nextAt })
        .eq('id', campaign.id)
    }
  }
}

async function logEvent(
  campaign: LeadCampaign,
  step: number,
  actionType: string,
  channelRefId: string | null,
  outcome: string,
  notes: string | null,
): Promise<void> {
  await supabase.from('lead_campaign_events').insert({
    campaign_id: campaign.id,
    rep_id: campaign.rep_id,
    lead_id: campaign.lead_id,
    step,
    action_type: actionType,
    channel_ref_id: channelRefId,
    outcome,
    notes,
  })
}

async function getRecentEventSummary(campaignId: string): Promise<string> {
  const { data } = await supabase
    .from('lead_campaign_events')
    .select('step, action_type, outcome, notes, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!data?.length) return 'No previous activity.'
  return (data as { step: number; action_type: string; outcome: string | null; notes: string | null; created_at: string }[])
    .map((e) => `Step ${e.step} [${e.action_type}] → ${e.outcome ?? 'unknown'}: ${e.notes ?? ''}`)
    .join('\n')
}

type LeadData = {
  phone: string | null
  disposition: string | null
  name?: string | null
}

async function getLeadForCampaign(leadId: string, repId: string): Promise<LeadData | null> {
  const { data } = await supabase
    .from('leads')
    .select('phone, first_name, last_name')
    .eq('id', leadId)
    .eq('rep_id', repId)
    .maybeSingle()

  if (!data) return null
  const d = data as { phone: string | null; first_name?: string | null; last_name?: string | null }

  // Also get disposition from crm_leads if available
  const { data: crmData } = await supabase
    .from('crm_leads')
    .select('disposition')
    .eq('id', leadId)
    .maybeSingle()

  return {
    phone: d.phone,
    disposition: (crmData as { disposition?: string | null } | null)?.disposition ?? null,
    name: [d.first_name, d.last_name].filter(Boolean).join(' ') || null,
  }
}

async function getSetterForCampaign(setterId: string | null): Promise<AiSalesperson | null> {
  if (!setterId) return null
  const { data } = await supabase
    .from('ai_salespeople')
    .select('*')
    .eq('id', setterId)
    .maybeSingle()
  return (data as AiSalesperson) ?? null
}

function fillTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key]
    return val != null ? String(val) : `{{${key}}}`
  })
}
