/**
 * Confirm before write (owner 10-18, Pinnacle release blocker). Pure, no I/O.
 *
 * In the Suite CXO app, anything Ciao does that writes to Google or reaches
 * another person is never run in the turn that asks for it. The tool call is
 * turned into a proposal with the exact details (title, time with timezone,
 * attendees, repeat rule; or recipient and text). The server shows it and
 * stores it as one pending record for that person and conversation, good for
 * PENDING_TTL_MS. Only a plain yes in their NEXT message runs exactly that
 * stored proposal. Anything else (a no, a change, a new question) drops it.
 *
 * This is enforced in code (lib/ops/agentGate.runToolWithOps never hands a
 * gated call to its handler unless ctx.userConfirmed, which only the server's
 * replay of a stored proposal sets), so a model that says "booked" or sets
 * confirmed: true on its own still writes nothing.
 *
 * Internal actions on the person's own things (their to-dos, reminders,
 * drafts, notes) are not gated and run straight away.
 *
 * Slack keeps its own hold (lib/ops/agentGate.holdFromSlack): there the yes
 * is given in the app.
 */
import { SLACK_HELD_INTENT_KINDS } from '@/lib/ops/approvalsShared'

/** Tools that write to Google or reach another person. */
export const GATED_TOOLS: ReadonlySet<string> = new Set([
  'create_calendar_event',
  'update_calendar_event',
  'cancel_calendar_event',
  'schedule_call_with_partner',
  'send_partner_message',
  'reply_to_thread',
  'send_member_message',
  'reply_member_message',
  'give_praise',
  'add_talking_point',
  'decide_approval',
  'leadership_agenda',
  'create_sheet_report',
])

/** Mira dispatcher intents (delegate_intents) that book, change, send or hand off. */
export const GATED_INTENT_KINDS: ReadonlySet<string> = SLACK_HELD_INTENT_KINDS

/** Is this exact call a write that needs the person's yes? */
export function isGatedCall(name: string, args: Record<string, unknown>): boolean {
  if (!GATED_TOOLS.has(name)) return false
  // A reply drafted into their own Gmail is a draft; only a send is gated.
  if (name === 'reply_to_thread') return String(args.mode ?? '').toLowerCase() === 'send'
  // Only putting the agenda on the invite reaches people; draft/edit/raise/mark/candidates are internal.
  if (name === 'leadership_agenda') return String(args.action ?? '') === 'add_to_invite'
  return true
}

export function gateApplies(ctx: { tenant: { brand?: string | null }; channel?: string }): boolean {
  return (ctx.tenant.brand ?? 'virtualcloser') === 'cxo' && ctx.channel !== 'slack'
}

/** How long a proposal waits for the yes. */
export const PENDING_TTL_MS = 15 * 60_000

export type PendingAction =
  | { kind: 'tool'; tool: string; args: Record<string, unknown>; summary: string }
  | { kind: 'intent'; intent: Record<string, unknown>; summary: string }

export type PendingRecord = {
  id: string
  conversation_id: string | null
  actions: PendingAction[]
  proposal: string
  expires_at: string
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Every phrase that alone means yes. Several can follow each other ("yes go ahead"). */
const YES_PHRASES: string[][] = [
  'yes', 'yeah', 'yea', 'yep', 'yup', 'y', 'ya', 'ok', 'okay', 'k', 'sure', 'confirm', 'confirmed', 'correct', 'perfect',
  'great', 'approve', 'approved', 'absolutely', 'definitely', 'please', 'thanks', 'thank you', 'go', 'go ahead', 'go for it',
  'do it', 'do that', 'please do', 'book it', 'book that', 'send it', 'send that', 'send', 'book', 'sounds good', 'looks good',
  'that works', 'works for me', 'all good', 'lets do it', 'lets go', 'make it so', 'ship it', 'yes please', 'approve it',
  'post it', 'add it', 'ciao', 'it', 'that', 'that one',
].map((p) => p.split(' '))

/** Phrases that carry no yes on their own; a message made only of these is not a yes ("book it" is a yes, "book" or "it" alone is not). */
const FILLER = new Set(['please', 'thanks', 'thank you', 'ciao', 'it', 'that', 'that one', 'go', 'send', 'book', 'great'])

/**
 * A plain yes to the proposal on screen, and nothing else. "Yes, but make it
 * 3pm" is not a yes: it is a change, so the proposal is dropped and Ciao
 * re-proposes.
 */
export function isAffirmative(text: string): boolean {
  const w = words(text)
  if (!w.length || w.length > 8) return false
  let i = 0
  let real = false
  while (i < w.length) {
    let best = 0
    for (const p of YES_PHRASES) {
      if (p.length > best && p.every((t, k) => w[i + k] === t)) best = p.length
    }
    if (!best) return false
    if (!FILLER.has(w.slice(i, i + best).join(' '))) real = true
    i += best
  }
  return real
}

const NO_PHRASES: string[][] = [
  'no', 'nope', 'nah', 'n', 'cancel', 'cancel that', 'dont', 'do not', 'dont do it', 'do not do it', 'stop', 'never mind', 'nevermind',
  'no thanks', 'no thank you', 'hold off', 'wait', 'not now', 'forget it', 'scratch that', 'leave it', 'skip it', 'skip',
  'please', 'thanks', 'thank you', 'ciao', 'it', 'that',
].map((p) => p.split(' '))
const NO_FILLER = new Set(['please', 'thanks', 'thank', 'you', 'ciao', 'it', 'that'])

/** A plain no ("no", "cancel", "don't", "never mind"). */
export function isNegative(text: string): boolean {
  const w = words(text)
  if (!w.length || w.length > 6) return false
  let i = 0
  let real = false
  while (i < w.length) {
    let best = 0
    for (const p of NO_PHRASES) {
      if (p.length > best && p.every((t, k) => w[i + k] === t)) best = p.length
    }
    if (!best) return false
    if (w.slice(i, i + best).some((t) => !NO_FILLER.has(t))) real = true
    i += best
  }
  return real
}

export type PendingDecision =
  /** No proposal waiting: run the turn normally. */
  | 'none'
  /** A plain yes in time, same conversation: run exactly the stored actions. */
  | 'execute'
  /** A yes, but too late: run nothing, say so. */
  | 'expired'
  /** A plain no: drop it, run nothing, say so. */
  | 'cancel'
  /** Anything else: drop it and run the turn normally. */
  | 'drop'

export function decidePending(row: Pick<PendingRecord, 'conversation_id' | 'expires_at'> | null, text: string, conversationId: string | null, nowMs: number): PendingDecision {
  if (!row) return 'none'
  if ((row.conversation_id ?? null) !== (conversationId ?? null)) return 'drop'
  if (isAffirmative(text)) return Date.parse(row.expires_at) > nowMs ? 'execute' : 'expired'
  if (isNegative(text)) return 'cancel'
  return 'drop'
}

export const CONFIRM_ASK = 'Reply yes to go ahead, or tell me what to change.'
export const NOT_DONE_LINE = 'Okay, I did not do it. Nothing was changed or sent.'
export const EXPIRED_LINE = 'That proposal timed out, so I did not do it. Nothing was changed or sent. Ask again and I will set it up fresh.'

/** The reply the person sees: exactly what will happen, then the ask. */
export function proposalText(actions: PendingAction[]): string {
  if (!actions.length) return ''
  const head = actions.length === 1 ? 'Here is what I will do. Nothing is done yet:' : `Here are the ${actions.length} things I will do. Nothing is done yet:`
  const body = actions.map((a, i) => (actions.length === 1 ? a.summary : `${i + 1}. ${a.summary.replace(/\n/g, '\n   ')}`)).join('\n\n')
  return `${head}\n\n${body}\n\n${CONFIRM_ASK}`
}

/** One line for a held dispatcher intent. */
export function intentSummary(intent: Record<string, unknown>, fmt: (iso: string) => string): string {
  const s = (k: string) => (typeof intent[k] === 'string' ? String(intent[k]).trim() : '')
  const who = s('lead_name') || s('contact_name')
  const mins = Number(intent.duration_minutes ?? intent.new_duration_minutes) || 30
  switch (intent.kind) {
    case 'book_meeting':
      return [`Book "${s('summary') || 'Meeting'}"`, `When: ${s('start_iso') ? fmt(s('start_iso')) : 'no time given'} (${mins} min)`, who ? `With: ${who}${s('email') ? ` <${s('email')}>` : ''}` : '', s('email') ? `Invite goes to ${s('email')}` : ''].filter(Boolean).join('\n')
    case 'reschedule_meeting':
      return [`Move the meeting with ${who || 'them'}${s('original_when') ? ` (${s('original_when')})` : ''}`, `New time: ${s('new_start_iso') ? fmt(s('new_start_iso')) : 'no time given'} (${mins} min)`, 'Attendees are told.'].join('\n')
    case 'cancel_meeting':
      return [`Cancel the meeting with ${who || 'them'}${s('original_when') ? ` (${s('original_when')})` : ''}`, 'Attendees are told.'].join('\n')
    case 'send_email':
      return [`Email ${who || s('to_email') || 'them'}${s('to_email') ? ` <${s('to_email')}>` : ''}`, `Subject: ${s('subject')}`, `Message:\n${s('body')}`].join('\n')
    case 'handoff_lead':
      return `Hand ${s('lead_name') || 'the lead'} to ${s('to_member_name') || 'a teammate'}.`
    default:
      return `Run ${String(intent.kind)}.`
  }
}

/** The prompt rules that match the gate (Suite CXO). */
export const CONFIRM_GATE_RULES: string[] = [
  '- Anything that writes to Google or reaches another person (create, change or cancel a calendar event, an invite, an email, a message to a coworker or partner, praise, a 1:1 talking point, an approval decision, a new Google Sheet) is never done in the same turn. Call the tool with the exact details; the app shows them a proposal and runs it only after their yes in their next message. Never say it is done, booked or sent until a tool result says so.',
  '- "Book it" / "send it" in their first message still gets the proposal first. That is the rule, not a question: do not ask "are you sure" yourself.',
  '- Find and book ("find a time with Dana next week and book it"): first offer the open times (propose_choice), wait for their pick, then call the write tool with that start; the proposal and yes follow.',
  '- Their own things (their to-dos, reminders, notes, drafts that stay with them) run straight away; say plainly that you did it.',
]
