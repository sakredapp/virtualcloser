// Claude tool schemas for the Plaud agent.
//
// The planner gives Claude the transcript + a compact directory and asks it
// to call one of these tools per action. We don't actually execute anything
// in the tool — Claude's tool_use blocks are *proposals*, which the planner
// persists as plaud_actions rows. The executor then runs them (or queues
// them for approval).
//
// Tool input schemas are intentionally permissive about "recipient" — the
// agent can name a person ("Lauren"), give an email, or both. lib/plaud/
// directory.ts handles resolution after the fact.

import type Anthropic from '@anthropic-ai/sdk'

export const PLAUD_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'create_task',
    description:
      'Create a task / todo item. Use this for concrete next steps a person needs to do — your boss, an assistant, a teammate. If the task is for a specific person, set assignee.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The task itself, written as a clear imperative ("Send vendor comparison to Lauren by Friday").' },
        assignee: { type: 'string', description: 'Name from the provided directory, or "self" if the task is for the recording owner. Omit for unassigned.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Use high only when the transcript clearly conveys urgency.' },
        due_hint: { type: 'string', description: 'Free-text due date if mentioned ("by Friday", "next week", "EOD"). Don\'t invent one.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'create_doc',
    description:
      'Generate a Google Doc deliverable from the transcript. Use this for: training material (word tracks, SOPs, playbooks), executive decision memos, action summaries, custom resources mentioned in the meeting. The doc body will be generated separately from your guidance — provide a clear title and a short brief of what the doc should contain.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, descriptive Doc title (will show in Drive).' },
        doc_kind: {
          type: 'string',
          enum: ['training', 'exec_memo', 'action_summary', 'resource'],
          description: 'training=word-track/SOP/playbook, exec_memo=decisions + next steps from an executive meeting, action_summary=1-page recap, resource=custom resource explicitly requested in the meeting.',
        },
        brief: { type: 'string', description: 'One paragraph describing what the doc should cover. The body generator will use this to write the actual content from the transcript.' },
      },
      required: ['title', 'doc_kind', 'brief'],
    },
  },
  {
    name: 'send_email',
    description:
      'Draft an email to send. ALWAYS QUEUED FOR HUMAN APPROVAL — never auto-sends. Use when the transcript implies an email needs to go out (follow-up, intro, status, ask).',
    input_schema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Name from the directory, or an email address.' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body. Write in the recording owner\'s voice. Don\'t over-format.' },
        reason: { type: 'string', description: 'Why this email exists — used to caption the draft in the approval UI.' },
      },
      required: ['recipient', 'subject', 'body'],
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'Propose a Google Calendar event. ALWAYS QUEUED FOR HUMAN APPROVAL. Use when the transcript explicitly schedules a future meeting/sync/check-in.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_iso: { type: 'string', description: 'ISO 8601 with timezone offset, e.g. 2026-05-22T14:00:00-04:00. Use the recording owner\'s timezone if not stated.' },
        end_iso: { type: 'string', description: 'ISO 8601 with timezone offset. Default 30min after start if not specified.' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Names from directory or email addresses.' },
        description: { type: 'string', description: 'Short context for the event (purpose, agenda).' },
        location: { type: 'string', description: 'Optional — physical location, Zoom link, etc. if mentioned.' },
      },
      required: ['title', 'start_iso'],
    },
  },
  {
    name: 'update_sheet',
    description:
      'Update the rep\'s linked Google Sheet CRM with information about a contact discussed in the meeting. Use for status changes ("we should mark them hot"), notes, next steps. Skip if the rep doesn\'t have a sheet linked.',
    input_schema: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Name or email of the contact in the sheet.' },
        status: { type: 'string', description: 'hot | warm | cold | dormant — only if the transcript implies it.' },
        notes: { type: 'string', description: 'Note to append to the contact (will not overwrite existing notes).' },
        next_step: { type: 'string', description: 'The next thing the rep needs to do with this contact.' },
      },
      required: ['contact'],
    },
  },
  {
    name: 'notify_member',
    description:
      'Internal-only ping to a team member about something they should know from the meeting. Use sparingly — only when there\'s a piece of information the member needs but a task or email would be heavier than warranted.',
    input_schema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Name from directory (must resolve to a member, not an external contact).' },
        message: { type: 'string', description: 'Short message — one or two sentences.' },
      },
      required: ['recipient', 'message'],
    },
  },
]

// Static set of tool names — used by the planner to validate Claude's
// output before persisting. Kept in sync with PLAUD_TOOLS above.
export const PLAUD_TOOL_NAMES = new Set([
  'create_task',
  'create_doc',
  'send_email',
  'create_calendar_event',
  'update_sheet',
  'notify_member',
] as const)

export type PlaudToolName =
  | 'create_task'
  | 'create_doc'
  | 'send_email'
  | 'create_calendar_event'
  | 'update_sheet'
  | 'notify_member'

// Action kinds stored in plaud_actions.kind. Same names as the tool names
// for traceability.
export type PlaudActionKind = PlaudToolName

// Which kinds touch a human outside the rep's org → always require approval,
// never auto-execute even if Spencer flips the plaud_settings flag in v1.
export const PEOPLE_TOUCHING_KINDS: ReadonlySet<PlaudActionKind> = new Set([
  'send_email',
  'create_calendar_event',
])
