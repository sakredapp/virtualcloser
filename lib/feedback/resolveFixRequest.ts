// Resolve a fix-request (the dev marks it done after shipping the fix). Always
// clears the matching "known limitation" rule from the education brain so the
// bot stops saying it's coming. Notifies the reporter ONLY when they directly
// asked for it (source 'manual' — the request box or the report_issue tool);
// inferred issues never trigger a proactive ping.

import { supabase } from '@/lib/supabase'
import { sendTelegramMessage } from '@/lib/telegram'
import type { BrandKey } from '@/lib/brand'

function sanitize(s: string): string {
  return s.replace(/[*_`]/g, '')
}

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

  // Notify ONLY for direct requests (source 'manual'), unless explicitly suppressed.
  let notified = false
  const shouldNotify = opts.notify !== false && r.source === 'manual' && Boolean(r.member_id) && Boolean(r.rep_id)
  if (shouldNotify) {
    const { data: mem } = await supabase
      .from('members')
      .select('telegram_chat_id')
      .eq('id', r.member_id as string)
      .maybeSingle()
    const chatId = (mem as { telegram_chat_id?: string | null } | null)?.telegram_chat_id
    if (chatId) {
      const { data: rep } = await supabase.from('reps').select('brand').eq('id', r.rep_id as string).maybeSingle()
      const brand = (((rep as { brand?: string } | null)?.brand) === 'cxo' ? 'cxo' : 'virtualcloser') as BrandKey
      const text = `✅ Update — the change you asked for is live now:\n${sanitize(message ?? r.body)}`
      const res = await sendTelegramMessage(chatId, text, { brand })
      notified = res.ok
    }
  }

  return { ok: true, notified, clearedRules }
}
