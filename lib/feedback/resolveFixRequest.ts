// Resolve a fix-request (the dev marks it done after shipping the fix). Always
// clears the matching "known limitation" rule from the education brain so the
// bot stops saying it's coming. The resolution message is stored on the row
// for the app to show; nothing is pushed to anyone.

import { supabase } from '@/lib/supabase'

export async function resolveFixRequest(
  id: string,
  opts: { message?: string; notify?: boolean },
): Promise<{ ok: boolean; notified: boolean; clearedRules: number; error?: string }> {
  const { data: row } = await supabase
    .from('fix_requests')
    .select('id, rep_id, member_id, body, source, status')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { ok: false, notified: false, clearedRules: 0, error: 'not found' }
  const r = row as {
    id: string
    rep_id: string | null
    member_id: string | null
    body: string
    source: string
    status: string
  }
  const message = (opts.message ?? '').trim() || null

  await supabase
    .from('fix_requests')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution_message: message, updated_at: new Date().toISOString() })
    .eq('id', id)

  // Always: clear the "known limitation" gap rule(s) — it's fixed now, so the
  // bot should stop telling people it's flagged-and-coming.
  let clearedRules = 0
  if (r.rep_id) {
    const { data: gaps } = await supabase
      .from('plaud_agent_guidance')
      .select('id, rule')
      .eq('rep_id', r.rep_id)
      .eq('active', true)
      .eq('source_kind', 'gap')
    const needle = r.body.slice(0, 80)
    for (const g of (gaps ?? []) as Array<{ id: string; rule: string }>) {
      if (!g.rule.includes(needle)) continue
      const { error } = await supabase
        .from('plaud_agent_guidance')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', g.id)
      if (!error) clearedRules++
    }
  }

  return { ok: true, notified: false, clearedRules }
}
