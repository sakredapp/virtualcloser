// Transcript-driven post-call disposition classifier.
//
// Runs after a terminal RevRing webhook (status=completed) and writes a
// granular disposition to voice_calls.final_disposition that's richer than
// the hangupCause-derived `outcome`. Drives follow-up routing on upstream
// CRMs — e.g. SakredCRM uses this to decide who gets re-queued vs. SMS-
// nurtured vs. marked DNC.
//
// Vocabulary (must stay stable — upstream CRMs switch on these strings):
//   qualified_booked      — prospect agreed to a specific follow-up slot
//   qualified_callback    — prospect interested, asked for callback
//   not_qualified         — declined / opted out / doesn't fit
//   voicemail_left        — AMD hit voicemail, message left
//   contacted_no_outcome  — live conversation, ambiguous result
//
// Resilient: any failure path (Claude error, parse failure, empty
// transcript) returns null and the caller silently falls back to the
// hangupCause-derived outcome. Classifier failure must NEVER break the
// disposition pushback.

import { generateText } from '@/lib/claude'

export type FinalDisposition =
  | 'qualified_booked'
  | 'qualified_callback'
  | 'not_qualified'
  | 'voicemail_left'
  | 'contacted_no_outcome'

const VALID_DISPOSITIONS: ReadonlySet<string> = new Set([
  'qualified_booked',
  'qualified_callback',
  'not_qualified',
  'voicemail_left',
  'contacted_no_outcome',
])

export type ClassifyInput = {
  transcript: string
  hangupCause?: string | null
  /** Whatever was passed to the agent — customer_name, state, etc. */
  callVariables?: Record<string, unknown> | null
  /** Optional post-call summary from runPostCallAnalysis — boosts classifier accuracy. */
  summary?: string | null
  /** Hint outcome from the hangupCause mapping (voicemail / connected / no_answer). */
  hintOutcome?: string | null
}

export type ClassifyResult = {
  disposition: FinalDisposition
  reasoning: string
  confidence: number
}

const MIN_TRANSCRIPT_CHARS = 40

export async function classifyPostCallDisposition(
  input: ClassifyInput,
): Promise<ClassifyResult | null> {
  // VOICEMAIL_DETECTED is NOT a hard short-circuit. RevRing's AMD trips on
  // iPhone Call Screening ("Please record your name and reason for calling…")
  // which is a live human, not a voicemail. We need the classifier to read
  // the transcript and distinguish:
  //   (a) Genuine voicemail — agent talks, no real human responses
  //   (b) iPhone screening false positive — actual human responses after
  //       the screening prompt, possibly real qualifying questions answered
  //   (c) Mid-conversation VM (user handed off to VM mid-call)
  //
  // The only true short-circuit is "no transcript at all", where there's
  // nothing for the model to read.
  if (!input.transcript || input.transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
    if (input.hangupCause === 'VOICEMAIL_DETECTED') {
      return {
        disposition: 'voicemail_left',
        reasoning: 'AMD detected voicemail and no transcript was captured.',
        confidence: 0.85,
      }
    }
    return null
  }

  const cv = (input.callVariables ?? {}) as Record<string, unknown>
  const customerName = (cv.customer_name as string | undefined) ?? (cv.first_name as string | undefined) ?? 'the prospect'
  const state        = (cv.state as string | undefined) ?? 'unknown'

  const summaryBlock = input.summary
    ? `\n\nPOST-CALL SUMMARY (from a separate model run):\n${input.summary.slice(0, 1500)}\n`
    : ''

  const prompt = [
    'You are classifying a sales-call transcript for a health-insurance AI dialer (Rachel) calling consumer prospects.',
    '',
    'Pick EXACTLY ONE disposition and return ONLY a JSON object — no other text.',
    '',
    'Dispositions:',
    '- "qualified_booked"      — prospect agreed to a SPECIFIC follow-up time with the licensed agent (e.g. "Tuesday at 2pm", or Rachel called the book_appointment tool and got confirmation).',
    '- "qualified_callback"    — prospect was interested or engaged in qualifying questions, asked to be called back at another time, but did NOT confirm a specific booked slot.',
    '- "not_qualified"         — prospect declined, said not interested, asked to be removed/added to DNC, refused to share info, hung up immediately, or clearly doesn\'t fit (e.g. already on free Medicaid, under 18, not in the US).',
    '- "voicemail_left"        — call reached a real voicemail (NOT iPhone call screening — see below). The transcript shows ONLY Rachel speaking with no genuine human back-and-forth, OR a generic VM greeting like "you\'ve reached… please leave a message after the beep" followed by Rachel\'s message.',
    '- "contacted_no_outcome"  — there WAS a real conversation with a live human, but the outcome doesn\'t match qualified/not_qualified above (technical issue, hold-and-never-returned, mid-conversation hangup, or call ended in screening).',
    '',
    'IMPORTANT — iPhone Call Screening false positive:',
    'RevRing\'s AMD often trips on iPhone Call Screening, which sounds like a voicemail but is actually a live person screening their calls. Telltale signs of screening (NOT voicemail):',
    '  • Phrases like "Please record your name and reason for calling", "If you record your name, I\'ll see if this person is available", or "I\'ll see if this person is available"',
    '  • A REAL human response after Rachel\'s opener (e.g. "Thanks, Rachel", "Please stay on the line", "Yes I can talk")',
    '  • Substantive back-and-forth in the transcript after the screening prompt — qualifying answers, questions, etc.',
    'When you see screening followed by real conversation, classify by what the human did, NOT as voicemail_left. If the human eventually became unavailable (e.g. "This person is not available, leave a message"), prefer "contacted_no_outcome" if any real qualifying exchange happened first.',
    '',
    `Customer name: ${customerName}`,
    `State: ${state}`,
    `Hangup cause (from RevRing): ${input.hangupCause ?? 'unknown'}`,
    '(Hangup cause is a hint, not authoritative — AMD has false positives on iPhone screening.)',
    summaryBlock,
    'TRANSCRIPT (oldest first):',
    input.transcript.slice(0, 12000),
    '',
    'Return JSON shape:',
    '{"disposition": "<one of the 5>", "reasoning": "<one short sentence quoting or paraphrasing the key signal>", "confidence": <0.0 to 1.0>}',
  ].join('\n')

  let raw: string
  try {
    raw = await generateText({ prompt, maxTokens: 200 })
  } catch (err) {
    console.error('[postCallClassify] generateText threw', err)
    return null
  }

  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: { disposition?: unknown; reasoning?: unknown; confidence?: unknown }
  try {
    parsed = JSON.parse(stripped) as typeof parsed
  } catch {
    console.warn('[postCallClassify] parse failure', stripped.slice(0, 120))
    return null
  }

  const dispRaw = typeof parsed.disposition === 'string' ? parsed.disposition.trim().toLowerCase() : ''
  if (!VALID_DISPOSITIONS.has(dispRaw)) {
    console.warn('[postCallClassify] unknown disposition from model', dispRaw)
    return null
  }
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5
  const reasoning  = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : ''

  return {
    disposition: dispRaw as FinalDisposition,
    reasoning,
    confidence,
  }
}
