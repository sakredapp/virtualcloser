// Markdown body generators for Plaud agent docs.
//
// The planner emits a create_doc tool call with a title, doc_kind, and a
// short brief of what the doc should contain. This module takes that
// proposal plus the transcript and asks Claude (Haiku — body work doesn't
// need Sonnet) to produce the actual markdown that Drive will convert to a
// Google Doc.
//
// Each kind has its own prompt shape because the deliverables are
// genuinely different artifacts: a word-track playbook reads nothing like
// an exec decision memo.

import { getAnthropic } from '@/lib/anthropic'

const MODEL = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5'
const MAX_TOKENS = 2048

export type DocKind = 'training' | 'exec_memo' | 'action_summary' | 'resource'

export type GenerateDocInput = {
  title: string
  brief: string
  doc_kind: DocKind
  transcript: string
  summary: string | null
  meeting_date_iso: string
}

const SYSTEM_PROMPTS: Record<DocKind, string> = {
  training: `You produce internal sales/operations training documents. Output clean markdown with these sections in order: Context, Key Talking Points, Word Tracks (verbatim phrases the rep should use), Objection Handling (each objection as ### subsection with the response), Closing / Next Move. Be specific to what was actually discussed — do not generate generic sales advice. Use direct quotes from the transcript where they capture the right phrasing. Keep total length under ~800 words.`,
  exec_memo: `You produce executive decision memos for the recording owner's reference. Output clean markdown with these sections in order: Meeting Context (1-2 sentences), Decisions Made (bulleted), Open Questions (bulleted), Action Items (each as "- [ ] [owner if mentioned]: action — due date if mentioned"), Recommended Next Step (2-3 sentences on what to do first). Be specific. No fluff. Don't invent decisions that weren't made.`,
  action_summary: `You produce a tight one-page action summary of a meeting. Output clean markdown with these sections: Summary (3-5 sentences), Action Items (bulleted with owner if mentioned), Key Quotes (3-5 most useful direct quotes from the transcript), Follow-Ups (anything that needs another meeting or external dependency). Be concise.`,
  resource: `You produce a custom resource document explicitly requested during the meeting. Output clean markdown. Lead with the title as an H1. Structure depends on what was requested — a comparison, a how-to, a list of options, a checklist, etc. Mirror the format the requester implied. Be specific and useful, not generic.`,
}

/**
 * Generate the markdown body for a Drive Doc. Returns null on failure so the
 * caller can mark the action failed without crashing the rest of the batch.
 */
export async function generateDocMarkdown(input: GenerateDocInput): Promise<string | null> {
  const system = SYSTEM_PROMPTS[input.doc_kind]
  const userMessage = [
    `Doc title: ${input.title}`,
    `Doc kind: ${input.doc_kind}`,
    `Meeting date: ${input.meeting_date_iso.slice(0, 10)}`,
    '',
    `Brief (what the planner agent decided this doc should be):`,
    input.brief,
    '',
    input.summary ? `Existing summary:\n${input.summary}\n` : '',
    `Transcript:`,
    input.transcript.slice(0, 16000),
  ].filter(Boolean).join('\n')

  try {
    const res = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userMessage }],
    })
    const block = res.content[0]
    if (!block || block.type !== 'text') return null
    const text = block.text.trim()
    if (!text) return null
    // Prepend an H1 title so Drive's auto-conversion gives the Doc a heading.
    if (text.startsWith('#')) return text
    return `# ${input.title}\n\n${text}`
  } catch (err) {
    console.error('[plaud-doc] generation failed', err)
    return null
  }
}
