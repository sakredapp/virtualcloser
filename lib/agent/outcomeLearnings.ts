// Learn from outcomes — the AI teaches itself from what the exec actually DOES,
// not what they say. If they dismiss most of a given kind of prepared action,
// the note-agent should propose it more selectively. Pure statistics over
// plaud_actions outcomes; no LLM, deterministic, deduped by source_kind so it
// updates rather than piling up. Runs weekly from the exec-brief cron.

import { supabase } from '@/lib/supabase'

const LOOKBACK_DAYS = 30
const MIN_VOLUME = 4 // need enough samples before drawing a conclusion
const DISMISS_THRESHOLD = 0.6 // dismissed ≥60% → propose more selectively

const KIND_LABEL: Record<string, string> = {
  send_email: 'email',
  create_calendar_event: 'calendar-event',
  create_task: 'task',
  create_doc: 'doc',
  update_sheet: 'sheet-update',
  notify_member: 'internal-note',
}

export async function analyzeActionOutcomes(input: { repId: string }): Promise<{ rules: number }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('plaud_actions')
    .select('kind, status')
    .eq('rep_id', input.repId)
    .gte('created_at', since)
    .limit(1000)
  const rows = (data ?? []) as Array<{ kind: string; status: string }>
  if (rows.length < MIN_VOLUME) return { rules: 0 }

  const byKind = new Map<string, { total: number; dismissed: number }>()
  for (const r of rows) {
    const k = byKind.get(r.kind) ?? { total: 0, dismissed: 0 }
    k.total++
    if (r.status === 'dismissed') k.dismissed++
    byKind.set(r.kind, k)
  }

  // Existing outcome rules — keyed by source_kind so we don't duplicate weekly.
  const { data: existing } = await supabase
    .from('plaud_agent_guidance')
    .select('source_kind')
    .eq('rep_id', input.repId)
    .eq('active', true)
    .like('source_kind', 'outcome:%')
  const existingKinds = new Set(((existing ?? []) as Array<{ source_kind: string | null }>).map((e) => e.source_kind))

  let rules = 0
  for (const [kind, c] of byKind) {
    if (c.total < MIN_VOLUME) continue
    const sourceKind = `outcome:${kind}`
    if (existingKinds.has(sourceKind)) continue
    if (c.dismissed / c.total >= DISMISS_THRESHOLD) {
      const label = KIND_LABEL[kind] ?? kind
      const rule = `Be selective proposing ${label} actions — ${c.dismissed} of the last ${c.total} were dismissed. Only propose a ${label} when the recording clearly calls for it.`
      const { error } = await supabase.from('plaud_agent_guidance').insert({
        rep_id: input.repId,
        scope: 'note_agent',
        kind: 'avoid',
        rule: rule.slice(0, 400),
        source: 'action',
        source_kind: sourceKind,
      })
      if (!error) rules++
    }
  }
  return { rules }
}

// ── Learn from recommendation outcomes ────────────────────────────────────

// Core exec signals never get suppressed even if dismissed — they're too
// important to silence on behavior alone.
const NEVER_SUPPRESS = new Set(['pending_approvals', 'call_followup', 'revenue_pace', 'placement_rate'])
const REC_DISMISS_THRESHOLD = 0.7

/**
 * If the exec consistently dismisses a kind of recommendation, suppress it
 * (30-day TTL — re-tested after). The overseer stops nagging about what they
 * ignore. Pure stats over the recommendations table.
 */
export async function analyzeRecommendationOutcomes(input: { repId: string }): Promise<{ suppressed: number }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('recommendations')
    .select('kind, status')
    .eq('rep_id', input.repId)
    .gte('created_at', since)
    .in('status', ['acted', 'dismissed'])
    .limit(1000)
  const rows = (data ?? []) as Array<{ kind: string; status: string }>
  if (rows.length < MIN_VOLUME) return { suppressed: 0 }

  const byKind = new Map<string, { resolved: number; dismissed: number }>()
  for (const r of rows) {
    if (NEVER_SUPPRESS.has(r.kind)) continue
    const k = byKind.get(r.kind) ?? { resolved: 0, dismissed: 0 }
    k.resolved++
    if (r.status === 'dismissed') k.dismissed++
    byKind.set(r.kind, k)
  }

  let suppressed = 0
  const now = new Date().toISOString()
  for (const [kind, c] of byKind) {
    if (c.resolved < MIN_VOLUME) continue
    if (c.dismissed / c.resolved >= REC_DISMISS_THRESHOLD) {
      const { error } = await supabase
        .from('recommendation_suppressions')
        .upsert({ rep_id: input.repId, kind, created_at: now }, { onConflict: 'rep_id,kind' })
      if (!error) suppressed++
    }
  }
  return { suppressed }
}
