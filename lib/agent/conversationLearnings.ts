// Conversation-level learning — mines a whole chat history (not just one
// message) for durable patterns: recurring preferences/corrections the bot
// should adopt, and capability gaps the dev team should fix. The per-message
// `remember` tool catches explicit feedback in the moment; this catches the
// patterns that only show up across a conversation (repeated friction, things
// the user keeps asking for that the bot can't do).
//
// Runs weekly per exec from the exec-brief cron. High-precision by design.

import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { addManualGuidance, captureIssue, listGuidance, type GuidanceKind, type GuidanceScope } from '@/lib/plaud/guidance'
import { type FixRequestSeverity } from '@/lib/feedback/fixRequests'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'
const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5'
const GAP_AREA = 'telegram (auto-detected)'

type HistoryEntry = { role: string; content: string }

/**
 * Real-time safety net: when the assistant couldn't do what the user wanted,
 * detect the missing capability and log it (deduped vs recently-known gaps).
 * Catches gaps the agent didn't self-report via report_issue. Cheap (one Haiku
 * call), gated upstream to inability replies. Returns true if a gap was logged.
 */
export async function detectCapabilityGap(input: {
  repId: string
  claudeKey?: string | null
  userMessage: string
  assistantReply: string
  memberId?: string | null
  createdBy?: string | null
}): Promise<boolean> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('fix_requests')
    .select('body')
    .eq('rep_id', input.repId)
    .eq('area', GAP_AREA)
    .gte('created_at', since)
    .limit(20)
  const known = ((data ?? []) as Array<{ body: string }>).map((r) => r.body)
  const knownList = known.length > 0 ? known.map((b) => `  - ${b}`).join('\n') : '  (none)'

  const system = `Decide if, in this exchange, the user wanted the assistant to DO something it genuinely CANNOT (a missing product capability the team should build). Be conservative.

Return STRICT JSON: {"gap": <null OR a one-line description of the missing capability the user wanted>}

Return gap null if: the assistant fulfilled the request, it was a one-off the assistant handled, it's a user mistake, or it duplicates a known gap below.

Known gaps (don't duplicate):
${knownList}`
  const user = `USER: ${input.userMessage}\nASSISTANT: ${input.assistantReply}`.slice(0, 4000)

  try {
    const res = await runWithClaudeKey(input.claudeKey, () =>
      getAnthropic().messages.create({ model: MODEL_FAST, max_tokens: 200, system, messages: [{ role: 'user', content: user }] }),
    )
    const text = res.content.find((b) => b.type === 'text')
    const raw = text && text.type === 'text' ? text.text : ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return false
    const obj = JSON.parse(m[0]) as { gap?: unknown }
    const gap = typeof obj.gap === 'string' && obj.gap.trim() ? obj.gap.trim() : null
    if (!gap) return false
    await captureIssue({
      repId: input.repId,
      memberId: input.memberId ?? null,
      source: 'auto',
      body: gap,
      area: GAP_AREA,
      createdBy: input.createdBy ?? null,
    })
    return true
  } catch (err) {
    console.warn('[gap-detect] failed', String(err).slice(0, 160))
    return false
  }
}

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
{"rules": [{"rule": "<imperative <=160 chars>", "kind": "avoid|prefer|correction|fact", "scope": "planner|both", "subject": <null OR the person/group this rule is about — "CFO", "the board", "Maria">}], "gaps": [{"summary": "<a capability the user wanted that the assistant couldn't do, or repeatedly got wrong>", "severity": "low|normal|high"}]}

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
      const subject = typeof r.subject === 'string' && r.subject.trim() ? r.subject.trim() : null
      const row = await addManualGuidance(input.repId, rule, scope, kind, subject)
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
