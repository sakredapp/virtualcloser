/**
 * What this chat already holds, said plainly to the model (Ciao QA 2026-10-18,
 * trust blocker). In a brand-new chat "what did we just talk about?" was
 * answered with a "Q4 recruiting pipeline… Southeast region" discussion that
 * never happened: the chat had no earlier turns, the member had no saved
 * memory, and nothing said so. The model filled the gap.
 *
 * Three pieces, all pure:
 *  - conversationStateLine: goes in the per-turn (uncached) system block and
 *    says how many earlier turns there are, and that nothing else was said;
 *  - claimsPastConversation: spots a reply that describes an earlier talk;
 *  - the retry note and the fixed line runAgent uses when a reply in a chat
 *    with no earlier turns still claims one.
 */

export function conversationStateLine(earlierTurns: number): string {
  if (earlierTurns <= 0) {
    return [
      'CONVERSATION STATE: this is a brand-new chat with no earlier turns. The user message below is the first thing said in it.',
      'You have not talked with them about anything before it, today or any other day. If they ask what you talked about, say plainly that this chat just started.',
      'Facts saved about them (rules, preferences) are things you know about them, never things you discussed. Never invent a past conversation.',
    ].join(' ')
  }
  return [
    `CONVERSATION STATE: the earlier turns of this chat are exactly the ${earlierTurns} message${earlierTurns === 1 ? '' : 's'} above. Nothing else was said in it.`,
    'Never describe a conversation, topic or request that is not in those messages. Facts saved about them are things you know, never things you discussed.',
  ].join(' ')
}

/**
 * Does the reply say the two of them talked about something before? Negations
 * ("we haven't talked about anything yet") do not match.
 */
const PAST_TALK_RE = new RegExp(
  [
    // "we just talked about", "we've discussed", "we were going over"
    String.raw`\bwe(?:'ve| have| had| were)?\s+(?:just\s+|already\s+|earlier\s+|previously\s+|briefly\s+)?(?:talked|discussed|spoke|chatted|went over|were going over|covered|were discussing|were talking|reviewed|looked at)\b`,
    // "earlier today we", "earlier in this chat"
    String.raw`\bearlier (?:today|this morning|this afternoon|in (?:this|our) (?:chat|conversation))\b`,
    // "our earlier conversation", "the previous chat", "our last discussion"
    String.raw`\b(?:our|the|your) (?:earlier|previous|prior|last|recent) (?:conversation|chat|discussion|session|exchange)\b`,
    // "as we discussed", "like we talked about"
    String.raw`\b(?:as|like) (?:we|i) (?:discussed|talked about|mentioned|covered)\b`,
    // "you asked me earlier", "you mentioned earlier"
    String.raw`\byou (?:asked|mentioned|said|told me|brought up)\b[^.?!\n]{0,40}\b(?:earlier|before|previously|this morning)\b`,
  ].join('|'),
  'i',
)

export function claimsPastConversation(text: string): boolean {
  return PAST_TALK_RE.test(text || '')
}

export const PAST_TALK_RETRY_NOTE =
  'Correction: this chat has no earlier turns. Nothing was discussed before the user\'s message, so that reply describes a conversation that did not happen. Rewrite it: say this chat just started, then help with what they asked. Do not mention any earlier topic.'

export const NEW_CHAT_FALLBACK = "This chat just started, so we haven't talked about anything in it yet. What can I help with?"
