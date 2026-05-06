// Post-call analysis. Runs after Vapi end-of-call-report writes the
// transcript to voice_calls. Produces:
//   - ai_summary      : 2-3 sentence plain-English recap
//   - ai_next_action  : one short line ("Follow up Tuesday at 10am")
// And, when the outcome is negative (no_answer/voicemail/cancelled/
// reschedule_requested), drops a brain_item follow-up task so nothing
// falls through.
//
// Settings live on each tenant's DialerSettings — both summary and
// follow-up-task generation can be turned off per tenant.

import { generateText } from '@/lib/claude'
import { supabase } from '@/lib/supabase'
import { getDialerSettings } from './dialerSettings'
import { sendTelegramMessage } from '@/lib/telegram'

type RunPostCallArgs = {
  voiceCallId: string
  repId: string
  meetingId: string | null
  leadId?: string | null
  outcome: string | null
  transcript: string | null
  attendeeName: string | null
  scheduledAtIso: string | null
  newScheduledAtIso?: string | null
}

const NEGATIVE_OUTCOMES = new Set(['no_answer', 'voicemail', 'cancelled', 'reschedule_requested', 'failed'])

export async function runPostCallAnalysis(args: RunPostCallArgs): Promise<void> {
  const settings = await getDialerSettings(args.repId)

  // Pull rep name for personalization on summary.
  const { data: rep } = await supabase
    .from('reps')
    .select('display_name, business_name')
    .eq('id', args.repId)
    .maybeSingle()
  const repName = (rep?.display_name as string | null) || (rep?.business_name as string | null) || null

  // 1. AI summary (only if transcript exists + tenant enabled it).
  let summary: string | null = null
  let nextAction: string | null = null
  if (settings.enable_post_call_summary && args.transcript && args.transcript.length > 40) {
    try {
      const prompt = buildSummaryPrompt(args, args.transcript)
      const raw = await generateText({ prompt, repName: repName ?? undefined, maxTokens: 240 })
      const parsed = parseSummary(raw)
      summary = parsed.summary
      nextAction = parsed.next_action
      if (summary || nextAction) {
        await supabase
          .from('voice_calls')
          .update({
            ai_summary: summary,
            ai_next_action: nextAction,
          })
          .eq('id', args.voiceCallId)
      }
    } catch (err) {
      console.error('[post-call] summary failed', err)
    }
  }

  // 2. Follow-up brain_item for negative outcomes.
  if (
    settings.enable_followup_tasks &&
    args.outcome &&
    NEGATIVE_OUTCOMES.has(args.outcome)
  ) {
    try {
      const taskContent = buildFollowupTask(args, nextAction)
      const dueDate = computeFollowupDate(args.outcome, args.scheduledAtIso)
      await supabase.from('brain_items').insert({
        rep_id: args.repId,
        item_type: 'task',
        content: taskContent,
        priority: args.outcome === 'cancelled' ? 'high' : 'normal',
        horizon: 'day',
        due_date: dueDate,
      })
    } catch (err) {
      console.error('[post-call] followup task failed', err)
    }
  }

  // 3. Telegram nudge with the AI summary so the rep gets context, not just
  // a thumbs-up emoji.
  if (summary) {
    try {
      const { data: members } = await supabase
        .from('members')
        .select('telegram_chat_id, role')
        .eq('rep_id', args.repId)
        .not('telegram_chat_id', 'is', null)
      const recipients = (members ?? []).filter((m) =>
        ['owner', 'admin', 'rep'].includes(m.role as string),
      )
      const name = args.attendeeName ?? 'lead'
      const lines = [`Call recap — ${name}:`, summary]
      if (nextAction) lines.push(`Next: ${nextAction}`)
      const text = lines.join('\n')
      for (const m of recipients) {
        const chatId = m.telegram_chat_id as string | null
        if (!chatId) continue
        await sendTelegramMessage(chatId, text).catch(() => {})
      }
    } catch (err) {
      console.error('[post-call] telegram recap failed', err)
    }
  }

  // 4. Push AI summary as a note on the GHL contact (only if lead has a
  //    crm_contact_id already — avoids creating phantom contacts).
  if (summary && args.leadId) {
    try {
      const { data: lead } = await supabase
        .from('leads')
        .select('crm_contact_id')
        .eq('id', args.leadId)
        .eq('rep_id', args.repId)
        .maybeSingle()
      const contactId = (lead as { crm_contact_id: string | null } | null)?.crm_contact_id
      if (contactId) {
        const { makeAgentCRMForRep } = await import('@/lib/agentcrm')
        const crm = await makeAgentCRMForRep(args.repId)
        if (crm) {
          const noteLines = [`Call recap${args.attendeeName ? ` — ${args.attendeeName}` : ''}:`, summary]
          if (nextAction) noteLines.push(`Next: ${nextAction}`)
          await crm.addNote(contactId, noteLines.join('\n')).catch((err: unknown) => {
            console.error('[post-call] GHL note push failed', err)
          })
        }
      }
    } catch (err) {
      console.error('[post-call] GHL note lookup failed', err)
    }
  }
}

function buildSummaryPrompt(args: RunPostCallArgs, transcript: string): string {
  const ctxLines: string[] = []
  if (args.attendeeName) ctxLines.push(`Lead: ${args.attendeeName}`)
  if (args.scheduledAtIso) ctxLines.push(`Original meeting: ${args.scheduledAtIso}`)
  if (args.newScheduledAtIso && args.newScheduledAtIso !== args.scheduledAtIso) {
    ctxLines.push(`New meeting time: ${args.newScheduledAtIso}`)
  }
  if (args.outcome) ctxLines.push(`Disposition: ${args.outcome}`)
  const ctx = ctxLines.join('\n')

  const trimmed = transcript.length > 6000 ? transcript.slice(0, 6000) + '\n…' : transcript

  return [
    'An AI confirmation/reschedule call just ended. Read the transcript and respond ONLY with raw JSON of shape:',
    '{ "summary": "2-3 plain sentences of what happened", "next_action": "one short imperative line, or null if no action needed" }',
    'Be concrete. Reference times, objections, names. No marketing fluff.',
    '',
    'CONTEXT:',
    ctx,
    '',
    'TRANSCRIPT:',
    trimmed,
  ].join('\n')
}

function parseSummary(raw: string): { summary: string | null; next_action: string | null } {
  const text = raw.trim()
  // Strip markdown code fences if present.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(stripped) as { summary?: unknown; next_action?: unknown }
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null
    const nextRaw = parsed.next_action
    const next_action =
      typeof nextRaw === 'string' && nextRaw.trim() && nextRaw.trim().toLowerCase() !== 'null'
        ? nextRaw.trim()
        : null
    return { summary, next_action }
  } catch {
    // Fallback: treat the whole reply as the summary.
    return { summary: stripped.slice(0, 600) || null, next_action: null }
  }
}

function buildFollowupTask(args: RunPostCallArgs, nextAction: string | null): string {
  const name = args.attendeeName ?? 'lead'
  switch (args.outcome) {
    case 'no_answer':
      return `Follow up with ${name} — confirmation call had no answer. ${nextAction ?? 'Try again or text them.'}`
    case 'voicemail':
      return `Follow up with ${name} — left voicemail on confirmation call. ${nextAction ?? 'Send a short follow-up text.'}`
    case 'reschedule_requested':
      return `Manual reschedule needed for ${name} — AI couldn't book a new time on call. ${nextAction ?? 'Call them and pick a slot.'}`
    case 'cancelled':
      return `${name} cancelled the appointment. ${nextAction ?? 'Decide whether to re-engage or close the lead.'}`
    case 'failed':
      return `Confirmation call to ${name} failed (system error). ${nextAction ?? 'Try a manual call.'}`
    default:
      return `Follow up with ${name}. ${nextAction ?? ''}`.trim()
  }
}

function computeFollowupDate(outcome: string, scheduledAtIso: string | null): string {
  // Sensible defaults: cancel/reschedule tasks are due today, voicemail/no-
  // answer due tomorrow.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (outcome === 'cancelled' || outcome === 'reschedule_requested') {
    return today.toISOString().slice(0, 10)
  }
  const tomorrow = new Date(today.getTime() + 86400_000)
  // If the original meeting is sooner than tomorrow, due today instead.
  if (scheduledAtIso && new Date(scheduledAtIso).getTime() < tomorrow.getTime()) {
    return today.toISOString().slice(0, 10)
  }
  return tomorrow.toISOString().slice(0, 10)
}
