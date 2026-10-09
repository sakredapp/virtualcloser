'use server'

/**
 * Settings › Your assistant: an exec adds or removes their own assistant.
 * The assistant gets their own login (role 'assistant') linked to this exec
 * and sets their own password from a link (the reset-password flow, 7 days).
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/client-password'
import { generateNonce } from '@/lib/random'
import { createMember, logAuditEvent, updateMember } from '@/lib/members'
import { sendEmail, assistantInviteEmail } from '@/lib/email'
import { getBrand, type BrandKey } from '@/lib/brand'
import { canHaveAssistant, canLinkAssistant } from '@/lib/assistantsShared'

const back = (q: Record<string, string>) => redirect('/dashboard/settings?' + new URLSearchParams(q).toString() + '#assistant')
const LINK_DAYS = 7

export async function actionAddExecAssistant(fd: FormData): Promise<void> {
  const { tenant, member } = await requireMember()
  if (member.acting_assistant || !canHaveAssistant(member, tenant.id)) back({ ea_error: 'Only an executive can add an assistant.' })

  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const displayName = String(fd.get('display_name') ?? '').trim().slice(0, 120)
  const sendNow = fd.get('send_email') === 'on'
  if (!displayName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back({ ea_error: 'Add their name and a working email.' })

  // Every login with this email, any org, any status: sign-in is by email
  // alone, so one email can only ever be one login.
  const { data: rows, error } = await supabase.from('members').select('id, rep_id, role, is_active').ilike('email', email).limit(5)
  if (error) throw error
  const all = (rows ?? []) as Array<{ id: string; rep_id: string; role: string; is_active: boolean }>
  const other = all.find((r) => r.rep_id !== tenant.id) ?? null
  const existing = all.find((r) => r.rep_id === tenant.id) ?? null
  const check = canLinkAssistant(other ?? existing, tenant.id, member.id, (other ?? existing)?.id ?? null)
  if (!check.ok) back({ ea_error: check.reason })

  const token = generateNonce(32)
  const expires = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString()
  let assistantId: string
  if (existing) {
    // Re-adding someone (theirs or another exec's assistant): reactivate, fresh link.
    await updateMember(existing.id, { is_active: true, display_name: displayName })
    assistantId = existing.id
  } else {
    // A random password nobody knows; they choose their own from the link.
    const m = await createMember({ repId: tenant.id, email, displayName, role: 'assistant', passwordHash: await hashPassword(generateNonce(24)), invitedBy: member.id })
    assistantId = m.id
  }
  const { data: who } = await supabase.from('members').select('last_login_at').eq('id', assistantId).maybeSingle()
  // Only a login that has never been used gets a fresh set-password link.
  if (!(who as { last_login_at?: string | null } | null)?.last_login_at) {
    await supabase.from('members').update({ password_reset_token: token, password_reset_expires_at: expires }).eq('id', assistantId)
  }

  const { data: link } = await supabase.from('cxo_exec_assistants').select('id').eq('exec_member_id', member.id).eq('assistant_member_id', assistantId).maybeSingle()
  if (link) {
    await supabase.from('cxo_exec_assistants').update({ is_active: true, removed_at: null }).eq('id', (link as { id: string }).id)
  } else {
    const { error: lErr } = await supabase.from('cxo_exec_assistants').insert({ rep_id: tenant.id, exec_member_id: member.id, assistant_member_id: assistantId, created_by: member.id })
    if (lErr) throw lErr
  }

  void logAuditEvent({ repId: tenant.id, memberId: member.id, action: 'member.invite', entityType: 'member', entityId: assistantId, diff: { email, role: 'assistant', display_name: displayName, source: 'settings_exec_assistant', emailed: sendNow } })

  let sent = false
  const fresh = !(who as { last_login_at?: string | null } | null)?.last_login_at
  if (sendNow && fresh) {
    const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
    const url = `https://${getBrand(brandKey).rootDomain}/reset-password?token=${token}`
    try {
      const tpl = assistantInviteEmail({ toEmail: email, displayName, execName: member.display_name || member.email, setUrl: url, brand: brandKey })
      await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, brand: brandKey })
      sent = true
    } catch (err) {
      console.error('[settings exec assistant] email failed', err)
    }
  }
  revalidatePath('/dashboard/settings')
  back(sent ? { ea_added: email, ea_sent: '1' } : { ea_added: email })
}

/** Remove (deactivate) an assistant from this exec. Their login stays on only while another exec still has them. */
export async function actionRemoveExecAssistant(fd: FormData): Promise<void> {
  const { tenant, member } = await requireMember()
  if (member.acting_assistant || !canHaveAssistant(member, tenant.id)) back({ ea_error: 'Only an executive can remove an assistant.' })
  const assistantId = String(fd.get('assistant_id') ?? '')
  const { data: link } = await supabase
    .from('cxo_exec_assistants')
    .select('id')
    .eq('rep_id', tenant.id)
    .eq('exec_member_id', member.id)
    .eq('assistant_member_id', assistantId)
    .eq('is_active', true)
    .maybeSingle()
  if (!link) back({ ea_error: 'They are not your assistant.' })
  await supabase.from('cxo_exec_assistants').update({ is_active: false, removed_at: new Date().toISOString() }).eq('id', (link as { id: string }).id)
  const { count } = await supabase.from('cxo_exec_assistants').select('id', { count: 'exact', head: true }).eq('assistant_member_id', assistantId).eq('is_active', true)
  const { data: a } = await supabase.from('members').select('email, role').eq('id', assistantId).maybeSingle()
  if (!count && (a as { role?: string } | null)?.role === 'assistant') {
    await updateMember(assistantId, { is_active: false })
    await supabase.from('members').update({ password_reset_token: null, password_reset_expires_at: null }).eq('id', assistantId)
  }
  void logAuditEvent({ repId: tenant.id, memberId: member.id, action: 'member.deactivate', entityType: 'member', entityId: assistantId, diff: { role: 'assistant', source: 'settings_exec_assistant', still_assisting_others: !!count } })
  revalidatePath('/dashboard/settings')
  back({ ea_removed: (a as { email?: string } | null)?.email ?? 'them' })
}
