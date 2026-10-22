/**
 * Settings › Your assistant: an exec adds or removes their own assistant.
 * The assistant gets their own login (role 'assistant') linked to this exec
 * and sets their own password from a link (the reset-password flow, 7 days).
 *
 * One copy of the rules, used by the Settings form
 * (app/dashboard/settings/assistantActions.ts) and by Ciao / MCP through the
 * settings registry (lib/settings/registry.ts). Returns a result; never redirects.
 */
import { supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/client-password'
import { generateNonce } from '@/lib/random'
import { createMember, logAuditEvent, updateMember } from '@/lib/members'
import { sendEmail, assistantInviteEmail } from '@/lib/email'
import { getBrand, type BrandKey } from '@/lib/brand'
import { canHaveAssistant, canLinkAssistant } from '@/lib/assistantsShared'
import type { Member } from '@/types'

const LINK_DAYS = 7
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type TenantLike = { id: string; brand?: string | null }
type Exec = Pick<Member, 'id' | 'rep_id' | 'role' | 'is_active' | 'display_name' | 'email'> & { acting_assistant?: Member['acting_assistant'] }

export type ExecAssistantResult = { ok: true; assistantId: string; email: string; emailed?: boolean } | { ok: false; error: string }

export async function addExecAssistant(tenant: TenantLike, exec: Exec, input: { email: unknown; displayName: unknown; sendEmail?: boolean; source?: string }): Promise<ExecAssistantResult> {
  if (exec.acting_assistant || !canHaveAssistant(exec, tenant.id)) return { ok: false, error: 'Only an executive can add an assistant.' }
  const email = String(input.email ?? '').trim().toLowerCase()
  const displayName = String(input.displayName ?? '').trim().slice(0, 120)
  const sendNow = input.sendEmail === true
  if (!displayName || !EMAIL_RE.test(email)) return { ok: false, error: 'Add their name and a working email.' }

  // Every login with this email, any org, any status: sign-in is by email
  // alone, so one email can only ever be one login.
  const { data: rows, error } = await supabase.from('members').select('id, rep_id, role, is_active').ilike('email', email).limit(5)
  if (error) throw error
  const all = (rows ?? []) as Array<{ id: string; rep_id: string; role: string; is_active: boolean }>
  const other = all.find((r) => r.rep_id !== tenant.id) ?? null
  const existing = all.find((r) => r.rep_id === tenant.id) ?? null
  const check = canLinkAssistant(other ?? existing, tenant.id, exec.id, (other ?? existing)?.id ?? null)
  if (!check.ok) return { ok: false, error: check.reason }

  const token = generateNonce(32)
  const expires = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString()
  let assistantId: string
  if (existing) {
    await updateMember(existing.id, { is_active: true, display_name: displayName })
    assistantId = existing.id
  } else {
    // A random password nobody knows; they choose their own from the link.
    const m = await createMember({ repId: tenant.id, email, displayName, role: 'assistant', passwordHash: await hashPassword(generateNonce(24)), invitedBy: exec.id })
    assistantId = m.id
  }
  const { data: who } = await supabase.from('members').select('last_login_at').eq('id', assistantId).maybeSingle()
  const fresh = !(who as { last_login_at?: string | null } | null)?.last_login_at
  // Only a login that has never been used gets a fresh set-password link.
  if (fresh) {
    await supabase.from('members').update({ password_reset_token: token, password_reset_expires_at: expires }).eq('id', assistantId)
  }

  const { data: link } = await supabase.from('cxo_exec_assistants').select('id').eq('exec_member_id', exec.id).eq('assistant_member_id', assistantId).maybeSingle()
  if (link) {
    await supabase.from('cxo_exec_assistants').update({ is_active: true, removed_at: null }).eq('id', (link as { id: string }).id)
  } else {
    const { error: lErr } = await supabase.from('cxo_exec_assistants').insert({ rep_id: tenant.id, exec_member_id: exec.id, assistant_member_id: assistantId, created_by: exec.id })
    if (lErr) throw lErr
  }

  void logAuditEvent({ repId: tenant.id, memberId: exec.id, action: 'member.invite', entityType: 'member', entityId: assistantId, diff: { email, role: 'assistant', display_name: displayName, source: input.source ?? 'settings_exec_assistant', emailed: sendNow } })

  let sent = false
  if (sendNow && fresh) {
    const brandKey = (tenant.brand ?? 'virtualcloser') as BrandKey
    const url = `https://${getBrand(brandKey).rootDomain}/reset-password?token=${token}`
    try {
      const tpl = assistantInviteEmail({ toEmail: email, displayName, execName: exec.display_name || exec.email, setUrl: url, brand: brandKey })
      await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, brand: brandKey })
      sent = true
    } catch (err) {
      console.error('[exec assistant] email failed', err)
    }
  }
  return { ok: true, assistantId, email, emailed: sent }
}

/** Remove (deactivate) an assistant from this exec. Their login stays on only while another exec still has them. */
export async function removeExecAssistant(tenant: TenantLike, exec: Exec, assistantIdRaw: unknown, source = 'settings_exec_assistant'): Promise<ExecAssistantResult> {
  if (exec.acting_assistant || !canHaveAssistant(exec, tenant.id)) return { ok: false, error: 'Only an executive can remove an assistant.' }
  const assistantId = String(assistantIdRaw ?? '')
  const { data: link } = await supabase
    .from('cxo_exec_assistants')
    .select('id')
    .eq('rep_id', tenant.id)
    .eq('exec_member_id', exec.id)
    .eq('assistant_member_id', assistantId)
    .eq('is_active', true)
    .maybeSingle()
  if (!link) return { ok: false, error: 'They are not your assistant.' }
  await supabase.from('cxo_exec_assistants').update({ is_active: false, removed_at: new Date().toISOString() }).eq('id', (link as { id: string }).id)
  const { count } = await supabase.from('cxo_exec_assistants').select('id', { count: 'exact', head: true }).eq('assistant_member_id', assistantId).eq('is_active', true)
  const { data: a } = await supabase.from('members').select('email, role').eq('id', assistantId).maybeSingle()
  if (!count && (a as { role?: string } | null)?.role === 'assistant') {
    await updateMember(assistantId, { is_active: false })
    await supabase.from('members').update({ password_reset_token: null, password_reset_expires_at: null }).eq('id', assistantId)
  }
  void logAuditEvent({ repId: tenant.id, memberId: exec.id, action: 'member.deactivate', entityType: 'member', entityId: assistantId, diff: { role: 'assistant', source, still_assisting_others: !!count } })
  return { ok: true, assistantId, email: (a as { email?: string } | null)?.email ?? 'them' }
}

/** This exec's active assistants (for Ciao to resolve "remove Dana"). */
export async function listExecAssistants(repId: string, execId: string): Promise<Array<{ id: string; display_name: string; email: string }>> {
  const { data: links } = await supabase.from('cxo_exec_assistants').select('assistant_member_id').eq('rep_id', repId).eq('exec_member_id', execId).eq('is_active', true)
  const ids = ((links ?? []) as Array<{ assistant_member_id: string }>).map((l) => l.assistant_member_id)
  if (!ids.length) return []
  const { data } = await supabase.from('members').select('id, display_name, email').in('id', ids)
  return (data ?? []) as Array<{ id: string; display_name: string; email: string }>
}
