/**
 * Honesty guard for Ciao (QA 2026-10-18, gap 2): the assistant must never say
 * it added, sent, scheduled or saved something unless a tool actually did it
 * in this turn.
 *
 * Pure helpers, no I/O. runAgent uses them at the final answer:
 *   1. it records every action tool that came back successful (or queued for
 *      approval) this turn;
 *   2. if the reply CLAIMS an action and none ran, it gives the model ONE
 *      corrective turn (call the tool, or rewrite without the claim);
 *   3. if the rewrite still claims it, a plain line is appended so the person
 *      is never told something happened that did not.
 *
 * The claim detector only reads the opening and closing paragraphs of the
 * reply, so a drafted email body in the middle ("I've attached the deck")
 * is not mistaken for the assistant's own claim.
 */

/** Tools that change something outside the conversation. */
const ACTION_TOOLS = new Set<string>([
  'remember', 'forget', 'report_issue', 'delegate_intents',
  'send_member_message', 'reply_member_message', 'reply_to_thread',
  'add_partner', 'update_partner', 'compose_partner_message', 'send_partner_message',
  'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner',
  'set_employee_quota', 'update_employee', 'log_time_off', 'give_praise', 'add_talking_point',
  'add_my_todo', 'complete_my_todo', 'set_recurring_report', 'cancel_recurring_report', 'pause_my_nudges',
  'create_sheet_report', 'create_doc', 'decide_approval', 'board_update', 'leadership_agenda', 'decision_log',
])

const ACTION_PREFIX_RE = /^(add|set|send|create|update|cancel|complete|log|give|reply|schedule|pause|decide|approve|reject|delete|mark|move|compose|book|save|remind|snooze|assign)_/

export function isActionTool(name: string): boolean {
  return ACTION_TOOLS.has(name) || ACTION_PREFIX_RE.test(name)
}

/**
 * Did this tool call actually do (or queue) something? A refusal, an error, an
 * `ok: false` result, or a "needs your confirmation first" preview does not count.
 * Read-only modes of mixed tools (e.g. board_update action=list) do not count.
 */
export function actionSucceeded(name: string, input: Record<string, unknown> | undefined, resultText: string, isError = false): boolean {
  if (!isActionTool(name) || isError) return false
  const action = String(input?.action ?? '').toLowerCase()
  if (action && /^(list|get|read|show|view|search|status|preview)$/.test(action)) return false
  let parsed: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(resultText) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
  } catch {
    // Plain-text result: count it unless it reads as a failure.
    return !/^\s*(error|failed|could not|couldn't|not sent|not saved)\b/i.test(resultText)
  }
  if (!parsed) return true
  // Queued for an approver (lib/ops/agentGate): the tool did queue it.
  if (parsed.queued === true) return true
  if (parsed.error && parsed.ok !== true) return false
  if (parsed.ok === false) return false
  if (parsed.needs_confirmation === true || parsed.preview === true) return false
  return true
}

// Sentence-initial past participles that announce a finished action.
// ("Set" / "Put" are left out of the sentence-start list: as imperatives they
// are advice, not claims. "I've set ..." is still caught below.)
const DONE_WORDS = 'added|sent|scheduled|booked|saved|logged|created|updated|cancel(?:l)?ed|moved|marked|emailed|texted|messaged|drafted|recorded|noted|filed|queued|approved|rejected|declined|removed|deleted|completed|invited|shared|posted|forwarded|replied|rescheduled|changed|submitted'
const DID_WORDS = `${DONE_WORDS}|set|put|gone ahead and \\w+`

const STARTS_DONE_RE = new RegExp(`^(?:[-*]\\s*)?(?:${DONE_WORDS})\\b`, 'i')
const DONE_ALONE_RE = /^(?:all\s+)?done\b/i
const I_DID_RE = new RegExp(`\\bI(?:'ve| have| just| went ahead and)\\s+(?:just\\s+|now\\s+|already\\s+|also\\s+)?(?:${DID_WORDS})\\b`, 'i')
const PASSIVE_RE = new RegExp(`\\b(?:(?:has|have)\\s+(?:now\\s+|just\\s+)?been|(?:is|are)\\s+now)\\s+(?:${DID_WORDS})\\b`, 'i')
const PASSIVE_SUBJECT_RE = /(?:^|\b)(?:it|this|that|they|(?:the|your|his|her|their|[A-Z][a-z]+'s)\s+(?:\w+\s+){0,2}(?:invite|event|meeting|call|reminder|email|message|note|quota|target|goal|todo|task|update|draft|change|request|follow-?up|praise|time off|report|partner|contact|record))\s*$/i

/** Words that make a sentence an offer or a plan, not a claim. */
const HEDGE_RE = /\b(can|could|will|would|shall|should|want me to|'ll|ready to|once you|if you|when you|after you|let me know|draft(?:ed)? below|here(?:'s| is) (?:a|the) draft)\b/i

function edgeParagraphs(text: string): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paras.length <= 2) return paras
  return [paras[0], paras[paras.length - 1]]
}

function sentences(p: string): string[] {
  return p.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
}

/** Does the assistant's own voice claim it carried out an action? */
export function claimsAction(text: string): boolean {
  if (!text || !text.trim()) return false
  for (const para of edgeParagraphs(text)) {
    for (const s of sentences(para)) {
      if (s.endsWith('?')) continue
      if (/^["'>]/.test(s)) continue // quoted draft text
      const hedged = HEDGE_RE.test(s)
      if (!hedged && (STARTS_DONE_RE.test(s) || DONE_ALONE_RE.test(s))) return true
      if (!hedged && I_DID_RE.test(s)) return true
      if (!hedged) {
        const m = PASSIVE_RE.exec(s)
        if (m && PASSIVE_SUBJECT_RE.test(s.slice(0, m.index))) return true
      }
    }
  }
  return false
}

/** The note runAgent sends back when the reply claims an action no tool did. */
export const UNBACKED_CLAIM_NOTE =
  'System check (the user never sees this message): your draft reply says something was added, sent, scheduled or saved, but no tool did that in this turn. ' +
  'Either call the right tool now, or rewrite the reply so it says plainly that nothing has been saved or sent yet ' +
  '(offer to do it, or show the draft). Never say it is done unless a tool result says so. ' +
  'Then write your whole answer to the user\'s last message again from scratch, as if this check never happened: do not mention this check, ' +
  'do not say "now", "actually" or "to be clear", and do not talk about what earlier replies did.'

/** Appended when the corrective turn still claims an action. */
export const UNBACKED_CLAIM_FLAG = 'To be clear: nothing has been saved or sent yet. Say the word and I will do it.'
