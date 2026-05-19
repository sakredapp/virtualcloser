// Gmail triage tick — classify newly-synced threads and (when warranted)
// draft a reply for Spencer to approve.
//
// Runs after the sync tick. Picks up email_threads.status='new', classifies
// via Claude, writes priority + category + needs_reply + reasoning back to
// the thread, and inserts a draft into email_drafts when needs_reply is true.

import { supabase } from '@/lib/supabase'
import { draftEmailReply, triageEmail, type EmailMessageForAI } from '@/lib/claude'
import { enabledReps } from '@/lib/email/syncTick'
import { loadCalendarContext } from '@/lib/email/calendarContext'

const BATCH_SIZE = 10

type ThreadRow = {
  id: string
  rep_id: string
  owner_member_id: string | null
  gmail_thread_id: string
  subject: string | null
  from_address: string | null
  from_name: string | null
  message_count: number
}

type MessageRow = {
  direction: 'inbound' | 'outbound' | null
  from_address: string | null
  to_addresses: string[] | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  sent_at: string | null
}

type RepRow = {
  id: string
  display_name: string | null
  slug: string | null
  timezone: string | null
}

type LeadRow = {
  id: string
  name: string
  company: string | null
  status: string
  notes: string | null
}

export type ThreadTriageResult = {
  threadId: string
  priority: string | null
  needsReply: boolean
  draftCreated: boolean
  error?: string
}

export type TriageTickResult = {
  processed: number
  drafted: number
  errors: number
  threads: ThreadTriageResult[]
}

function htmlToText(html: string | null): string | null {
  if (!html) return null
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function loadMessages(threadId: string): Promise<EmailMessageForAI[]> {
  const { data } = await supabase
    .from('email_messages')
    .select('direction, from_address, to_addresses, subject, body_text, body_html, sent_at')
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })
  return ((data ?? []) as MessageRow[]).map((m) => ({
    direction: (m.direction ?? 'inbound') as 'inbound' | 'outbound',
    from: m.from_address ?? '',
    to: m.to_addresses ?? [],
    subject: m.subject,
    body: m.body_text ?? htmlToText(m.body_html),
    sentAt: m.sent_at,
  }))
}

async function loadRepInfo(
  repId: string,
): Promise<{ name: string; email: string | null; timezone: string }> {
  const { data: rep } = await supabase
    .from('reps')
    .select('id, display_name, slug, timezone')
    .eq('id', repId)
    .maybeSingle()
  const r = rep as RepRow | null

  // Best-effort: pick the email from the rep's tenant-level Google connection.
  let email: string | null = null
  const { data: token } = await supabase
    .from('google_tokens')
    .select('email')
    .eq('rep_id', repId)
    .is('member_id', null)
    .maybeSingle()
  if (token) email = (token as { email: string | null }).email
  return {
    name: r?.display_name ?? r?.slug ?? 'the rep',
    email,
    timezone: r?.timezone ?? 'America/New_York',
  }
}

async function matchLead(
  repId: string,
  fromAddress: string | null,
): Promise<LeadRow | null> {
  if (!fromAddress) return null
  const { data } = await supabase
    .from('leads')
    .select('id, name, company, status, notes')
    .eq('rep_id', repId)
    .ilike('email', fromAddress)
    .limit(1)
    .maybeSingle()
  return (data as LeadRow | null) ?? null
}

async function processThread(thread: ThreadRow): Promise<ThreadTriageResult> {
  const messages = await loadMessages(thread.id)
  if (messages.length === 0) {
    await supabase
      .from('email_threads')
      .update({ status: 'triaged', updated_at: new Date().toISOString() })
      .eq('id', thread.id)
    return { threadId: thread.id, priority: null, needsReply: false, draftCreated: false }
  }

  const rep = await loadRepInfo(thread.rep_id)
  const lead = await matchLead(thread.rep_id, thread.from_address)

  const triage = await triageEmail({
    repName: rep.name,
    repEmail: rep.email,
    messages,
    matchedLead: lead
      ? { name: lead.name, company: lead.company ?? '', status: lead.status }
      : null,
  })

  // If the latest message is outbound (rep already replied) we record the
  // triage but never create a draft.
  const lastInboundIndex = [...messages].reverse().findIndex((m) => m.direction === 'inbound')
  const latestIsOutbound = messages[messages.length - 1].direction === 'outbound'
  const shouldDraft = triage.needs_reply && lastInboundIndex !== -1 && !latestIsOutbound &&
    triage.priority !== 'noise' && triage.category !== 'noise' && triage.category !== 'newsletter'

  let draftCreated = false
  let newStatus: 'triaged' | 'drafted' = 'triaged'

  if (shouldDraft) {
    // Make sure no pending draft already exists for this thread.
    const { data: existingDraft } = await supabase
      .from('email_drafts')
      .select('id')
      .eq('thread_id', thread.id)
      .eq('status', 'pending')
      .maybeSingle()

    if (!existingDraft) {
      // Pull free-slot availability so the model can propose times that
      // actually fit on the rep's calendar instead of inventing them.
      const availability = await loadCalendarContext(
        thread.rep_id,
        thread.owner_member_id,
        rep.timezone,
      )
      const drafted = await draftEmailReply({
        repName: rep.name,
        repEmail: rep.email,
        messages,
        matchedLead: lead
          ? { name: lead.name, company: lead.company ?? '', status: lead.status, notes: lead.notes }
          : null,
        availability,
      })
      const { error: draftErr } = await supabase.from('email_drafts').insert({
        thread_id: thread.id,
        rep_id: thread.rep_id,
        owner_member_id: thread.owner_member_id,
        subject: drafted.subject,
        body: drafted.body,
        model_used: process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5',
        status: 'pending',
      })
      if (draftErr) {
        console.error('[gmail-triage] insert draft failed', draftErr.message)
      } else {
        draftCreated = true
        newStatus = 'drafted'
      }
    } else {
      newStatus = 'drafted'
    }
  }

  // Auto-link the matched lead so the inbox UI can deep-link to /leads/[id].
  const updateFields: Record<string, unknown> = {
    priority: triage.priority,
    category: triage.category,
    needs_reply: triage.needs_reply,
    reasoning: triage.reasoning,
    status: newStatus,
    updated_at: new Date().toISOString(),
  }
  if (lead) updateFields.lead_id = lead.id

  await supabase.from('email_threads').update(updateFields).eq('id', thread.id)

  return {
    threadId: thread.id,
    priority: triage.priority,
    needsReply: triage.needs_reply,
    draftCreated,
  }
}

export async function runGmailTriageTick(): Promise<TriageTickResult> {
  const allowList = enabledReps()

  let q = supabase
    .from('email_threads')
    .select('id, rep_id, owner_member_id, gmail_thread_id, subject, from_address, from_name, message_count')
    .eq('status', 'new')
    .order('last_message_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (allowList) q = q.in('rep_id', Array.from(allowList))

  const { data, error } = await q
  if (error) {
    console.error('[gmail-triage] fetch threads failed', error.message)
    return { processed: 0, drafted: 0, errors: 1, threads: [] }
  }

  const threads = (data ?? []) as ThreadRow[]
  const results: ThreadTriageResult[] = []
  let drafted = 0
  let errors = 0

  for (const thread of threads) {
    try {
      const r = await processThread(thread)
      results.push(r)
      if (r.draftCreated) drafted++
    } catch (err) {
      errors++
      console.error('[gmail-triage] thread failed', thread.id, err)
      results.push({
        threadId: thread.id,
        priority: null,
        needsReply: false,
        draftCreated: false,
        error: String(err),
      })
    }
  }

  return { processed: threads.length, drafted, errors, threads: results }
}
