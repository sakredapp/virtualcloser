// Plaud Agent tick — plans + executes actions for new Plaud notes.
//
// Runs inside the Hetzner worker every Nth tick (see hetzner-worker/index.ts).
// Two passes per note:
//   1. Plan — Claude tool-use produces a list of proposed actions, persisted
//      as plaud_actions rows.
//   2. Execute — safe kinds (create_task, create_doc, update_sheet,
//      notify_member) run immediately. People-touching kinds (send_email,
//      create_calendar_event) stay pending until Spencer taps approve in
//      the dashboard.
//
// Gating: PLAUD_AGENT_REP_IDS env (same shape as EMAIL_TRIAGE_REP_IDS).

import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import {
  createCalendarEvent,
  mirrorLeadToSheet,
  getSheetCrmConfig,
} from '@/lib/google'
import {
  createGoogleDocFromMarkdown,
  findOrCreateDriveFolder,
} from '@/lib/google/drive'
import {
  PLAUD_TOOLS,
  PLAUD_TOOL_NAMES,
  PEOPLE_TOUCHING_KINDS,
  type PlaudActionKind,
} from '@/lib/plaud/agentTools'
import {
  loadDirectory,
  resolveRecipient,
  type DirectoryEntry,
} from '@/lib/plaud/directory'
import { generateDocMarkdown, type DocKind } from '@/lib/plaud/docGenerators'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL_PLANNER = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'
const NOTES_PER_TICK = 5
const MIN_TRANSCRIPT_CHARS = 300
const MIN_DURATION_SECONDS = 18

// ── Gating ───────────────────────────────────────────────────────────────

export function plaudAgentEnabledReps(): Set<string> | null {
  const raw = process.env.PLAUD_AGENT_REP_IDS
  if (!raw) return new Set(['__off__'])
  const trimmed = raw.trim()
  if (trimmed === '*') return null
  return new Set(trimmed.split(',').map((s) => s.trim()).filter(Boolean))
}

// ── Types ────────────────────────────────────────────────────────────────

type PlaudNoteRow = {
  id: string
  rep_id: string
  title: string
  transcript: string | null
  summary: string | null
  occurred_at: string
  duration_seconds: number | null
}

type RepRow = { id: string; display_name: string; timezone: string | null }

type ProposedAction = {
  kind: PlaudActionKind
  payload: Record<string, unknown>
  reasoning: string | null
  recipient_name: string | null
  recipient_email: string | null
  resolved_member_id: string | null
  resolved_contact_id: string | null
  recipient_unresolved: boolean
}

type ClassificationResult = {
  triage_class: 'trash' | 'action' | 'training' | 'executive' | 'unclear'
  reasoning: string
}

export type PlaudAgentTickResult = {
  processed: number
  classified: Record<string, number>
  actions_proposed: number
  actions_executed: number
  actions_failed: number
  errors: number
}

// ── Top-level entry point ────────────────────────────────────────────────

export async function runPlaudAgentTick(): Promise<PlaudAgentTickResult> {
  const allowList = plaudAgentEnabledReps()
  const result: PlaudAgentTickResult = {
    processed: 0,
    classified: { trash: 0, action: 0, training: 0, executive: 0, unclear: 0 },
    actions_proposed: 0,
    actions_executed: 0,
    actions_failed: 0,
    errors: 0,
  }

  let q = supabase
    .from('plaud_notes')
    .select('id, rep_id, title, transcript, summary, occurred_at, duration_seconds')
    .is('triage_class', null)
    .order('occurred_at', { ascending: true })
    .limit(NOTES_PER_TICK)
  if (allowList) q = q.in('rep_id', Array.from(allowList))

  const { data, error } = await q
  if (error) {
    console.error('[plaud-agent] fetch failed', error.message)
    return { ...result, errors: 1 }
  }

  const notes = (data ?? []) as PlaudNoteRow[]
  for (const note of notes) {
    try {
      const noteResult = await processNote(note)
      result.processed++
      result.classified[noteResult.classification] =
        (result.classified[noteResult.classification] ?? 0) + 1
      result.actions_proposed += noteResult.actions_proposed
      result.actions_executed += noteResult.actions_executed
      result.actions_failed += noteResult.actions_failed
    } catch (err) {
      result.errors++
      console.error('[plaud-agent] note failed', note.id, err)
      // Still mark triaged so we don't reprocess forever.
      await supabase
        .from('plaud_notes')
        .update({
          triage_class: 'unclear',
          triage_reasoning: `agent crash: ${String(err).slice(0, 200)}`,
          triaged_at: new Date().toISOString(),
        })
        .eq('id', note.id)
    }
  }

  return result
}

// ── Per-note processing ──────────────────────────────────────────────────

type NoteResult = {
  classification: string
  actions_proposed: number
  actions_executed: number
  actions_failed: number
}

async function processNote(note: PlaudNoteRow): Promise<NoteResult> {
  // Hard filter for trash before spending any tokens.
  if (
    (note.duration_seconds !== null && note.duration_seconds < MIN_DURATION_SECONDS) ||
    (note.transcript ?? '').trim().length < MIN_TRANSCRIPT_CHARS
  ) {
    await supabase
      .from('plaud_notes')
      .update({
        triage_class: 'trash',
        triage_reasoning: 'below minimum duration / transcript length',
        triage_model: MODEL_PLANNER,
        triaged_at: new Date().toISOString(),
      })
      .eq('id', note.id)
    return { classification: 'trash', actions_proposed: 0, actions_executed: 0, actions_failed: 0 }
  }

  const rep = await loadRep(note.rep_id)
  const directory = await loadDirectory(note.rep_id)

  // Plan: classification + tool-use actions in one call.
  const plan = await planNote(note, rep, directory)

  // Persist classification immediately so the note exits the queue even if
  // the action persistence fails downstream.
  await supabase
    .from('plaud_notes')
    .update({
      triage_class: plan.classification.triage_class,
      triage_reasoning: plan.classification.reasoning,
      triage_model: MODEL_PLANNER,
      triaged_at: new Date().toISOString(),
    })
    .eq('id', note.id)

  // If trash, stop here — no actions worth executing.
  if (plan.classification.triage_class === 'trash' || plan.actions.length === 0) {
    return {
      classification: plan.classification.triage_class,
      actions_proposed: 0,
      actions_executed: 0,
      actions_failed: 0,
    }
  }

  // Persist proposed actions.
  const actionIds = await persistActions(note, plan.actions)

  // Executor pass over the actions we just persisted.
  let executed = 0
  let failed = 0
  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]
    const actionId = actionIds[i]
    if (!actionId) continue

    const shouldAutoExecute =
      !PEOPLE_TOUCHING_KINDS.has(action.kind) && !action.recipient_unresolved
    if (!shouldAutoExecute) continue

    const ok = await executeAction(actionId, action, note, rep)
    if (ok) executed++
    else failed++
  }

  return {
    classification: plan.classification.triage_class,
    actions_proposed: plan.actions.length,
    actions_executed: executed,
    actions_failed: failed,
  }
}

async function loadRep(repId: string): Promise<RepRow> {
  const { data } = await supabase
    .from('reps')
    .select('id, display_name, timezone')
    .eq('id', repId)
    .maybeSingle()
  return (data as RepRow | null) ?? { id: repId, display_name: repId, timezone: null }
}

// ── Planner ──────────────────────────────────────────────────────────────

type PlannerResult = {
  classification: ClassificationResult
  actions: ProposedAction[]
}

function buildSystemPrompt(rep: RepRow, directory: DirectoryEntry[]): string {
  const dirLines = directory.slice(0, 60).map((d) => {
    const aliasPart = d.aliases.length > 0 ? ` (aliases: ${d.aliases.join(', ')})` : ''
    const rolePart = d.role ? ` — ${d.role}` : ''
    const emailPart = d.email ? ` <${d.email}>` : ''
    const tag = d.source === 'member' ? '[team]' : '[contact]'
    return `${tag} ${d.display_name}${aliasPart}${rolePart}${emailPart}`
  }).join('\n')

  return `You are an executive assistant agent for ${rep.display_name}. You receive transcripts of meetings, calls, and voice notes from a Plaud recorder.

Your job, in two parts:

1. CLASSIFY the recording into exactly one of:
   - trash — junk audio, accidental, less than ~30s of useful content
   - action — call where concrete next steps were discussed (sales, ops, follow-ups)
   - training — content best preserved as a training resource (word tracks, scripts, SOPs)
   - executive — leadership/strategy meeting with decisions, next moves
   - unclear — useful but doesn't fit the above

2. PROPOSE ACTIONS by calling the provided tools. Be opinionated and useful — propose what an excellent EA would do. Examples:
   - "Send Lauren the vendor list by Friday" → create_task (assignee=Lauren) AND send_email (recipient=Lauren) with the draft
   - "Let's get a sync with Jordan next week" → create_calendar_event (attendees=Jordan)
   - "I want a one-pager on our objection handling for this script" → create_doc (doc_kind=training)
   - Exec meeting with 5 decisions → create_doc (doc_kind=exec_memo) AND create_task per decision owner

Rules:
- For tasks the recording owner needs to do themselves, use create_task with assignee="self".
- ONLY use names from the DIRECTORY below. If a name is mentioned that's not in the directory, still propose the action but put the name in recipient; the system flags it for the user to add to the directory.
- Don't invent emails — names are fine, the system resolves them.
- For dates, only fill due_hint / start_iso if the transcript actually states timing. Don't invent.
- The recording owner's timezone is ${rep.timezone ?? 'America/New_York'} — use it for any calendar event ISO strings.
- Don't propose duplicate actions. One create_task per distinct task.
- For trash, return your classification + reasoning AND propose zero actions.

After all tool calls, you MUST emit a final text block with this exact JSON shape on its own line (no markdown fences):
{"triage_class":"<class>","reasoning":"<one sentence>"}

DIRECTORY:
${dirLines || '(empty — propose actions with names; the user will resolve them)'}`
}

async function planNote(
  note: PlaudNoteRow,
  rep: RepRow,
  directory: DirectoryEntry[],
): Promise<PlannerResult> {
  const system = buildSystemPrompt(rep, directory)
  const userMessage = [
    `Recording title: ${note.title}`,
    `Recorded at: ${note.occurred_at}`,
    note.duration_seconds ? `Duration: ${note.duration_seconds}s` : '',
    note.summary ? `\nExisting summary:\n${note.summary}` : '',
    `\nTranscript:\n${(note.transcript ?? '').slice(0, 18000)}`,
  ].filter(Boolean).join('\n')

  const res = await anthropic.messages.create({
    model: MODEL_PLANNER,
    max_tokens: 4096,
    system,
    tools: PLAUD_TOOLS,
    messages: [{ role: 'user', content: userMessage }],
  })

  // Extract proposed actions from tool_use blocks + the trailing JSON
  // classification line from the final text block.
  const proposed: ProposedAction[] = []
  let classification: ClassificationResult = { triage_class: 'unclear', reasoning: '' }

  for (const block of res.content) {
    if (block.type === 'tool_use') {
      if (!PLAUD_TOOL_NAMES.has(block.name as PlaudActionKind)) continue
      const input = (block.input ?? {}) as Record<string, unknown>
      proposed.push(buildProposedAction(block.name as PlaudActionKind, input, directory))
    } else if (block.type === 'text') {
      const parsed = extractClassificationJson(block.text)
      if (parsed) classification = parsed
    }
  }

  // Fallback: if the planner forgot to emit the JSON, infer from actions.
  if (!classification.reasoning) {
    classification = inferClassificationFromActions(proposed)
  }

  return { classification, actions: proposed }
}

function extractClassificationJson(text: string): ClassificationResult | null {
  const match = text.match(/\{[^{}]*"triage_class"[^{}]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { triage_class?: string; reasoning?: string }
    const cls = parsed.triage_class
    if (cls === 'trash' || cls === 'action' || cls === 'training' || cls === 'executive' || cls === 'unclear') {
      return { triage_class: cls, reasoning: (parsed.reasoning ?? '').slice(0, 500) }
    }
  } catch { /* fall through */ }
  return null
}

function inferClassificationFromActions(actions: ProposedAction[]): ClassificationResult {
  if (actions.length === 0) return { triage_class: 'trash', reasoning: 'no actions proposed' }
  const hasDoc = actions.some((a) => a.kind === 'create_doc')
  const docKinds = actions
    .filter((a) => a.kind === 'create_doc')
    .map((a) => String(a.payload.doc_kind ?? ''))
  if (docKinds.includes('exec_memo')) return { triage_class: 'executive', reasoning: 'exec memo proposed' }
  if (docKinds.includes('training')) return { triage_class: 'training', reasoning: 'training doc proposed' }
  if (hasDoc || actions.length > 0) return { triage_class: 'action', reasoning: 'action items proposed' }
  return { triage_class: 'unclear', reasoning: 'no clear classification' }
}

function buildProposedAction(
  kind: PlaudActionKind,
  input: Record<string, unknown>,
  directory: DirectoryEntry[],
): ProposedAction {
  const recipientName = pickRecipientName(kind, input)
  let resolved_member_id: string | null = null
  let resolved_contact_id: string | null = null
  let recipient_email: string | null = null
  let recipient_unresolved = false

  if (recipientName) {
    // "self" → assignee = recording owner; the executor maps this to
    // owner_member_id=null on brain_items (which keeps it on the rep's own queue).
    if (recipientName.toLowerCase() === 'self') {
      // Treat as resolved with no member id — falls through to rep-level work.
    } else {
      const r = resolveRecipient(recipientName, directory)
      if (r.matched) {
        resolved_member_id = r.member_id
        resolved_contact_id = r.contact_id
        recipient_email = r.email
      } else {
        recipient_unresolved = true
      }
    }
  }

  return {
    kind,
    payload: input,
    reasoning: typeof input.reason === 'string' ? input.reason : null,
    recipient_name: recipientName,
    recipient_email,
    resolved_member_id,
    resolved_contact_id,
    recipient_unresolved,
  }
}

function pickRecipientName(kind: PlaudActionKind, input: Record<string, unknown>): string | null {
  // Each tool puts the recipient under a different key — flatten here so
  // downstream resolution + executor logic doesn't care about kind.
  if (kind === 'create_task') return strOrNull(input.assignee)
  if (kind === 'send_email') return strOrNull(input.recipient)
  if (kind === 'create_calendar_event') {
    const att = input.attendees
    if (Array.isArray(att) && att.length > 0) return strOrNull(att[0])
    return null
  }
  if (kind === 'update_sheet') return strOrNull(input.contact)
  if (kind === 'notify_member') return strOrNull(input.recipient)
  return null
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// ── Persistence ──────────────────────────────────────────────────────────

async function persistActions(
  note: PlaudNoteRow,
  actions: ProposedAction[],
): Promise<Array<string | null>> {
  if (actions.length === 0) return []
  const rows = actions.map((a) => ({
    note_id: note.id,
    rep_id: note.rep_id,
    kind: a.kind,
    payload: {
      ...a.payload,
      recipient_unresolved: a.recipient_unresolved ? a.recipient_name : undefined,
    },
    target_member_id: a.resolved_member_id,
    target_contact_id: a.resolved_contact_id,
    target_email: a.recipient_email,
    reasoning: a.reasoning,
    status: 'pending' as const,
  }))
  const { data, error } = await supabase
    .from('plaud_actions')
    .insert(rows)
    .select('id')
  if (error) {
    console.error('[plaud-agent] persist actions failed', error.message)
    return new Array(actions.length).fill(null)
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  // Pad in case the insert returned fewer rows for some reason.
  while (ids.length < actions.length) ids.push(null as unknown as string)
  return ids
}

// ── Executor ─────────────────────────────────────────────────────────────

export async function executeAction(
  actionId: string,
  action: ProposedAction,
  note: PlaudNoteRow,
  rep: RepRow,
): Promise<boolean> {
  try {
    const result = await runActionByKind(action, note, rep)
    await supabase
      .from('plaud_actions')
      .update({
        status: 'executed',
        auto_executed: true,
        result,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', actionId)
    return true
  } catch (err) {
    console.error('[plaud-agent] execute failed', action.kind, err)
    await supabase
      .from('plaud_actions')
      .update({
        status: 'failed',
        error: String(err).slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', actionId)
    return false
  }
}

async function runActionByKind(
  action: ProposedAction,
  note: PlaudNoteRow,
  rep: RepRow,
): Promise<Record<string, unknown>> {
  switch (action.kind) {
    case 'create_task':
      return execCreateTask(action, note)
    case 'create_doc':
      return execCreateDoc(action, note, rep)
    case 'update_sheet':
      return execUpdateSheet(action, note)
    case 'notify_member':
      return execNotifyMember(action, note)
    case 'send_email':
    case 'create_calendar_event':
      // Approval flow handles these — should not reach here during auto-execute.
      // Called from the approval API route directly.
      if (action.kind === 'send_email') return execSendEmail(action, note, rep)
      return execCreateCalendarEvent(action, note, rep)
  }
}

async function execCreateTask(
  action: ProposedAction,
  note: PlaudNoteRow,
): Promise<Record<string, unknown>> {
  const content = String(action.payload.content ?? '').trim()
  if (!content) throw new Error('create_task missing content')
  const priorityRaw = String(action.payload.priority ?? 'normal').toLowerCase()
  const priority = ['low', 'normal', 'high'].includes(priorityRaw) ? priorityRaw : 'normal'
  const dueHint = strOrNull(action.payload.due_hint)
  const taskContent = dueHint ? `${content} (${dueHint})` : content

  const { data, error } = await supabase
    .from('brain_items')
    .insert({
      rep_id: note.rep_id,
      item_type: 'task' as const,
      content: taskContent,
      priority: priority as 'low' | 'normal' | 'high',
      horizon: 'week' as const,
      status: 'open' as const,
      owner_member_id: action.resolved_member_id,
    })
    .select('id')
    .single()
  if (error) throw new Error(`brain_items insert: ${error.message}`)
  return { brain_item_id: (data as { id: string }).id }
}

async function execCreateDoc(
  action: ProposedAction,
  note: PlaudNoteRow,
  rep: RepRow,
): Promise<Record<string, unknown>> {
  const title = String(action.payload.title ?? '').trim() || note.title
  const docKindRaw = String(action.payload.doc_kind ?? 'resource')
  const docKind: DocKind = (['training', 'exec_memo', 'action_summary', 'resource'].includes(docKindRaw)
    ? docKindRaw
    : 'resource') as DocKind
  const brief = String(action.payload.brief ?? '').trim() || `${docKind} doc for: ${note.title}`

  const markdown = await generateDocMarkdown({
    title,
    brief,
    doc_kind: docKind,
    transcript: note.transcript ?? '',
    summary: note.summary,
    meeting_date_iso: note.occurred_at,
  })
  if (!markdown) throw new Error('doc body generation returned empty')

  const folderId = await ensureFolderForKind(rep.id, docKind)
  const result = await createGoogleDocFromMarkdown(rep.id, {
    title,
    markdown,
    folderId,
  })
  if (!result.ok) {
    // Surface scope-missing as a specific, actionable error so the UI can
    // tell Spencer to reconnect Google rather than showing a generic null.
    if (result.error === 'scope_missing') {
      throw new Error('Google Drive scope not granted — reconnect Google in Integrations')
    }
    if (result.error === 'not_connected') {
      throw new Error('Google account not connected — connect in Integrations')
    }
    if (result.error === 'unauthorized') {
      throw new Error('Google authorization expired — reconnect Google in Integrations')
    }
    if (result.error === 'rate_limited') {
      throw new Error('Drive rate-limited — will retry on next tick')
    }
    throw new Error(`Drive Doc create failed (status ${result.status ?? 'unknown'})`)
  }
  return {
    drive_file_id: result.value.id,
    drive_url: result.value.webViewLink,
    doc_kind: docKind,
    title,
  }
}

async function execUpdateSheet(
  action: ProposedAction,
  note: PlaudNoteRow,
): Promise<Record<string, unknown>> {
  const cfg = await getSheetCrmConfig(note.rep_id)
  if (!cfg) throw new Error('rep has no Google Sheet CRM linked')
  const contactName = strOrNull(action.payload.contact) ?? ''
  const result = await mirrorLeadToSheet(note.rep_id, {
    name: contactName,
    email: action.recipient_email,
    status: strOrNull(action.payload.status),
    notes: strOrNull(action.payload.notes),
    next_step: strOrNull(action.payload.next_step),
    last_contact: note.occurred_at,
    source: 'plaud',
  })
  if (!result) throw new Error('sheet upsert failed')
  return { sheet_op: result, contact: contactName }
}

async function execNotifyMember(
  action: ProposedAction,
  note: PlaudNoteRow,
): Promise<Record<string, unknown>> {
  if (!action.resolved_member_id) throw new Error('notify_member requires a resolved member')
  const message = String(action.payload.message ?? '').trim()
  if (!message) throw new Error('notify_member missing message')
  const { data, error } = await supabase
    .from('brain_items')
    .insert({
      rep_id: note.rep_id,
      item_type: 'note' as const,
      content: `[from Plaud: ${note.title}] ${message}`,
      priority: 'normal' as const,
      horizon: 'day' as const,
      status: 'open' as const,
      owner_member_id: action.resolved_member_id,
    })
    .select('id')
    .single()
  if (error) throw new Error(`notify insert: ${error.message}`)
  return { brain_item_id: (data as { id: string }).id }
}

// People-touching executors — called by the approval API route, NOT during
// the auto-execute pass.

export async function execSendEmail(
  action: ProposedAction,
  note: PlaudNoteRow,
  rep: RepRow,
): Promise<Record<string, unknown>> {
  const { sendGmailMessage } = await import('@/lib/google')
  if (!action.recipient_email) throw new Error('send_email has no resolved recipient email')
  const subject = String(action.payload.subject ?? `Following up — ${note.title}`)
  const body = String(action.payload.body ?? '').trim()
  if (!body) throw new Error('send_email missing body')
  const res = await sendGmailMessage(rep.id, {
    to: action.recipient_email,
    subject,
    body,
  })
  if (!res.ok) throw new Error(`gmail send failed: ${res.error ?? 'unknown'}`)
  return { gmail_message_id: res.messageId, to: action.recipient_email, subject }
}

export async function execCreateCalendarEvent(
  action: ProposedAction,
  note: PlaudNoteRow,
  rep: RepRow,
): Promise<Record<string, unknown>> {
  const startIso = strOrNull(action.payload.start_iso)
  if (!startIso) throw new Error('create_calendar_event requires start_iso')
  const endIso = strOrNull(action.payload.end_iso) ?? undefined
  const title = String(action.payload.title ?? note.title)
  const description = strOrNull(action.payload.description) ?? ''
  const attendeesRaw = action.payload.attendees
  const attendeeEmails: Array<{ email: string }> = []
  if (Array.isArray(attendeesRaw)) {
    for (const a of attendeesRaw) {
      if (typeof a === 'string' && a.includes('@')) attendeeEmails.push({ email: a })
    }
  }
  if (action.recipient_email && !attendeeEmails.some((a) => a.email === action.recipient_email)) {
    attendeeEmails.push({ email: action.recipient_email })
  }

  const event = await createCalendarEvent({
    repId: rep.id,
    summary: title,
    description,
    startIso,
    endIso,
    timezone: rep.timezone ?? 'America/New_York',
    attendees: attendeeEmails,
  })
  if (!event) throw new Error('calendar event create returned null')
  return { event_id: event.id, html_link: event.htmlLink }
}

// ── Folder bootstrap ─────────────────────────────────────────────────────

const FOLDER_NAMES: Record<DocKind, string> = {
  training: 'Plaud — Training Library',
  exec_memo: 'Plaud — Exec Memos',
  action_summary: 'Plaud — Action Summaries',
  resource: 'Plaud — Resources',
}

const SETTINGS_COL: Record<DocKind, 'training_folder_id' | 'exec_folder_id' | 'action_folder_id' | 'resource_folder_id'> = {
  training: 'training_folder_id',
  exec_memo: 'exec_folder_id',
  action_summary: 'action_folder_id',
  resource: 'resource_folder_id',
}

async function ensureFolderForKind(repId: string, kind: DocKind): Promise<string | null> {
  const col = SETTINGS_COL[kind]
  // Read current setting.
  const { data: existing } = await supabase
    .from('plaud_settings')
    .select(col)
    .eq('rep_id', repId)
    .maybeSingle()
  const currentValue = existing ? (existing as Record<string, string | null>)[col] : null
  if (currentValue) return currentValue

  // Create folder + persist id.
  const folder = await findOrCreateDriveFolder(repId, FOLDER_NAMES[kind])
  if (!folder) return null

  // Upsert: row may not exist yet for this rep.
  const update: Record<string, unknown> = { rep_id: repId, [col]: folder.id, updated_at: new Date().toISOString() }
  const { error } = await supabase
    .from('plaud_settings')
    .upsert(update, { onConflict: 'rep_id' })
  if (error) console.error('[plaud-agent] plaud_settings upsert failed', error.message)
  return folder.id
}

// Re-export key helpers used by approval API routes so they don't need to
// re-derive note/rep context themselves.
export async function loadActionContext(actionId: string): Promise<{
  action: ProposedAction
  note: PlaudNoteRow
  rep: RepRow
} | null> {
  const { data: row } = await supabase
    .from('plaud_actions')
    .select('id, note_id, rep_id, kind, payload, target_member_id, target_contact_id, target_email, reasoning')
    .eq('id', actionId)
    .maybeSingle()
  if (!row) return null
  const r = row as {
    id: string
    note_id: string
    rep_id: string
    kind: PlaudActionKind
    payload: Record<string, unknown>
    target_member_id: string | null
    target_contact_id: string | null
    target_email: string | null
    reasoning: string | null
  }
  const { data: noteRow } = await supabase
    .from('plaud_notes')
    .select('id, rep_id, title, transcript, summary, occurred_at, duration_seconds')
    .eq('id', r.note_id)
    .maybeSingle()
  if (!noteRow) return null
  const rep = await loadRep(r.rep_id)
  const action: ProposedAction = {
    kind: r.kind,
    payload: r.payload,
    reasoning: r.reasoning,
    recipient_name:
      typeof r.payload?.recipient === 'string'
        ? (r.payload.recipient as string)
        : null,
    recipient_email: r.target_email,
    resolved_member_id: r.target_member_id,
    resolved_contact_id: r.target_contact_id,
    recipient_unresolved: Boolean(r.payload?.recipient_unresolved),
  }
  return { action, note: noteRow as PlaudNoteRow, rep }
}
