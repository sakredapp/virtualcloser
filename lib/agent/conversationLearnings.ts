// Conversation-level learning — mines a whole chat history (not just one
// message) for durable patterns: recurring preferences/corrections the bot
// should adopt, and capability gaps the dev team should fix. The per-message
// `remember` tool catches explicit feedback in the moment; this catches the
// patterns that only show up across a conversation (repeated friction, things
// the user keeps asking for that the bot can't do).
//
// Runs weekly per exec from the exec-brief cron. High-precision by design.

import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { addManualGuidance, captureIssue, listGuidance, type GuidanceKind, type GuidanceScope } from '@/lib/plaud/guidance'
import { type FixRequestSeverity } from '@/lib/feedback/fixRequests'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'

type HistoryEntry = { role: string; content: string }

export async function analyzeConversations(input: {
  repId: string
  claudeKey?: string | null
  memberId?: string | null
  createdBy?: string | null
  history: HistoryEntry[]
}): Promise<{ rules: number; gaps: number }> {
  const history = (input.history ?? []).filter((h) => h && typeof h.content === 'string')
  if (history.length < 6) return { rules: 0, gaps: 0 } // need a real conversation

  const transcript = history
    .slice(-50)
    .map((h) => `${h.role === 'user' ? 'USER' : 'ASSISTANT'}: ${h.content}`)
    .join('\n')
    .slice(0, 12000)

  const existing = (await listGuidance(input.repId)).filter((r) => r.active).map((r) => r.rule)
  const existingList = existing.length > 0 ? existing.map((r) => `  - ${r}`).join('\n') : '  (none)'

  const system = `You review a transcript between a user and their AI executive assistant (Telegram) and extract LASTING learnings. Be conservative and high-precision — only durable, recurring things, never one-offs.

Return STRICT JSON on one line:
{"rules": [{"rule": "<imperative <=160 chars>", "kind": "avoid|prefer|correction|fact", "scope": "planner|both"}], "gaps": [{"summary": "<a capability the user wanted that the assistant couldn't do, or repeatedly got wrong>", "severity": "low|normal|high"}]}

- rules (max 4): durable preferences/corrections the assistant should adopt going forward. Skip anything already covered by the existing rules below.
- gaps (max 3): product/capability problems for the dev team — things the user asked for that the bot couldn't do, or repeatedly failed at. NOT user mistakes, NOT one-offs.
- If nothing durable stands out, return {"rules": [], "gaps": []}.

EXISTING RULES (don't duplicate):
${existingList}`

  try {
    const res = await runWithClaudeKey(input.claudeKey, () =>
      getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 700,
        system,
        messages: [{ role: 'user', content: transcript }],
      }),
    )
    const text = res.content.find((b) => b.type === 'text')
    const raw = text && text.type === 'text' ? text.text : ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return { rules: 0, gaps: 0 }
    const obj = JSON.parse(m[0]) as { rules?: Array<Record<string, unknown>>; gaps?: Array<Record<string, unknown>> }

    const existingLower = new Set(existing.map((r) => r.toLowerCase()))
    let rules = 0
    for (const r of (obj.rules ?? []).slice(0, 4)) {
      const rule = typeof r.rule === 'string' ? r.rule.trim() : ''
      if (!rule || existingLower.has(rule.toLowerCase())) continue
      const kind = (['avoid', 'prefer', 'correction', 'fact'].includes(String(r.kind)) ? r.kind : 'prefer') as GuidanceKind
      const scope = (['planner', 'both'].includes(String(r.scope)) ? r.scope : 'both') as GuidanceScope
      const row = await addManualGuidance(input.repId, rule, scope, kind)
      if (row) rules++
    }

    let gaps = 0
    for (const g of (obj.gaps ?? []).slice(0, 3)) {
      const summary = typeof g.summary === 'string' ? g.summary.trim() : ''
      if (!summary) continue
      const severity = (['low', 'normal', 'high'].includes(String(g.severity)) ? g.severity : 'normal') as FixRequestSeverity
      await captureIssue({
        repId: input.repId,
        memberId: input.memberId ?? null,
        source: 'auto',
        body: summary,
        area: 'telegram (conversation analysis)',
        severity,
        createdBy: input.createdBy ?? null,
      })
      gaps++
    }
    return { rules, gaps }
  } catch (err) {
    console.warn('[conv-analysis] failed', String(err).slice(0, 160))
    return { rules: 0, gaps: 0 }
  }
}
