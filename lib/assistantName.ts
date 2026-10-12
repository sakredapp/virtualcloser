/**
 * The AI assistant's visible name. THE one place to change it.
 *
 * No imports on purpose: `lib/brand.ts` pulls in `next/headers`, so client
 * components cannot read the name from there. Client and server code both read
 * it from here; `lib/brand.ts` reads it too (`CXO_SUITE.assistantName`,
 * `AGENT_NAME`), so there is still a single source.
 *
 * This is only the name people see and the name the assistant calls herself.
 * Code identifiers, routes (`/api/mira/ask`), events (`mira:ask`), CSS classes
 * and stored keys keep their `mira` spelling and must not be derived from it.
 */

/** Suite CXO: every executive and employee surface, the public site and the agent prompts. */
export const ASSISTANT_NAME = 'Ciao'

/** Virtual Closer (the sales-rep product) keeps its own name. */
export const VC_ASSISTANT_NAME = 'Mira'
