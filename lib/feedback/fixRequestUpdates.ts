// Send a client update on a fix_request (Suite CXO "Request a change / report
// an issue") at the member's chosen pace. Rules and wording:
// lib/feedback/fixRequestUpdatesShared.ts.
//
// Channels: an in-app notice from the assistant (cxo_followup_notices, key
// prefix fixreq:, always shown) for every kind; started / progress / done also
// go by email to the member who filed it. Only member-filed reports
// (source 'manual' with a member) get updates. Best-effort: a failure here
// never fails the caller's save.

import { supabase } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { homeUrl, insertNotices, type OpsTenant } from '@/lib/followups/engine'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import type { FollowMember } from '@/lib/followups/shared'
import {
  bodyFor, noticeKey, normalizePace, paceAllows, titleFor,
  type FixRequestUpdateKind,
} from '@/lib/feedback/fixRequestUpdatesShared'

export type FixRequestUpdateResult = { sent: boolean; reason?: string; emailed?: boolean }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export async function sendFixRequestUpdate(
  id: string,
  kind: FixRequestUpdateKind,
  note: string | null,
  now: Date = new Date(),
): Promise<FixRequestUpdateResult> {
  try {
    const { data: row } = await supabase
      .from('fix_requests')
      .select('id, rep_id, member_id, source, status, started_at, last_client_update_at')
      .eq('id', id)
      .maybeSingle()
    const r = row as { id: string; rep_id: string; member_id: string | null; source: string; status: string; started_at: string | null; last_client_update_at: string | null } | null
    if (!r) return { sent: false, reason: 'not_found' }
    if (r.source !== 'manual' || !r.member_id) return { sent: false, reason: 'not_member_filed' }
    if (kind === 'started' && r.started_at) return { sent: false, reason: 'already_started' }

    const [{ data: t }, { data: m }] = await Promise.all([
      supabase.from('reps').select('id, slug, brand, settings, host_aliases, timezone').eq('id', r.rep_id).maybeSingle(),
      supabase.from('members').select('id, rep_id, role, is_active, timezone, display_name, email, settings, home_subdomain').eq('id', r.member_id).maybeSingle(),
    ])
    const tenant = t as OpsTenant | null
    const member = m as (FollowMember & { home_subdomain?: string | null }) | null
    if (!tenant || !member || member.is_active === false) return { sent: false, reason: 'no_member' }

    const pace = normalizePace((member.settings as Record<string, unknown> | null | undefined)?.ticket_update_pace)
    const gate = paceAllows(kind, pace, r.last_client_update_at, now)
    if (!gate.ok) return { sent: false, reason: gate.reason }

    const title = titleFor(kind, r.id)
    const body = bodyFor(kind, note, pace)
    const href = isEmployeeOnlyMember(member, tenant) ? '/dashboard/me' : '/dashboard'
    const fresh = await insertNotices([{
      rep_id: r.rep_id, member_id: member.id, key: noticeKey(kind, r.id, now), kind: 'report',
      // item_kind must pass cxo_followup_notices_item_kind_check (request|card|meeting|report|approval|praise).
      item_kind: 'report', item_id: r.id, title, body, href, due_date: null,
    }])
    if (!fresh.length) return { sent: false, reason: 'duplicate' }

    let emailed = false
    if (kind !== 'ack' && member.email) {
      const link = homeUrl(tenant, member) + href
      const res = await sendEmail({
        to: member.email,
        subject: title,
        html: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#1C1B1A"><p>${esc(body)}</p><p><a href="${esc(link)}" style="color:#1C1B1A;font-weight:600">Open Suite CXO</a></p></div>`,
        text: `${body}\n\n${link}`,
        brand: 'cxo',
      }).catch((e) => ({ ok: false, error: String(e) }))
      emailed = !!res.ok
      if (emailed) await supabase.from('cxo_followup_notices').update({ emailed_at: now.toISOString() }).eq('id', fresh[0].id)
    }

    const patch: Record<string, unknown> = { last_client_update_at: now.toISOString(), updated_at: now.toISOString() }
    if (kind === 'started') patch.started_at = now.toISOString()
    await supabase.from('fix_requests').update(patch).eq('id', r.id)
    return { sent: true, emailed }
  } catch (e) {
    console.error('[fix-request-update]', kind, e instanceof Error ? e.message : String(e))
    return { sent: false, reason: 'error' }
  }
}
