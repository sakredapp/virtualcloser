/**
 * Invite an employee to their own self-view login. Exec-only (the caller
 * checks). Reuses the member invite pieces from Settings: seat check, a fresh
 * password, createMember, the audit log and the member invite email. The new
 * login gets role 'rep', which on an exec tenant only ever sees /dashboard/me.
 *
 * Never demotes an existing owner/admin/manager login: an exec who is also on
 * the Employees list keeps their exec access and is just linked.
 */
import { supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/client-password'
import { sendEmail, memberInviteEmail, generatePassword } from '@/lib/email'
import { createMember, getMemberByEmailAnyStatus, updateMember, assertSeatAvailable, logAuditEvent } from '@/lib/members'
import type { BrandKey } from '@/lib/brand'
import { linkEmployeeMember } from './data'

type TenantLike = { id: string; slug: string; display_name?: string | null; brand?: string | null }
type Inviter = { id: string; display_name?: string | null }

export async function inviteEmployee(
  tenant: TenantLike,
  inviter: Inviter,
  employeeId: string,
  opts: { email?: string | null; send?: boolean } = {},
): Promise<{ memberId: string; email: string; linkedExisting: boolean }> {
  const { data: emp } = await supabase.from('cxo_employees').select('id, name, email').eq('rep_id', tenant.id).eq('id', employeeId).maybeSingle()
  if (!emp) throw new Error('Employee not found.')
  const email = String(opts.email || emp.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Add their work email first.')
  const name = String(emp.name || email)

  const existing = await getMemberByEmailAnyStatus(tenant.id, email)
  if (existing && existing.id === inviter.id) throw new Error("That's your own login.")
  if (existing && existing.is_active && ['owner', 'admin', 'manager'].includes(String(existing.role))) {
    // Already an exec login: link it, never demote it.
    await linkEmployeeMember(tenant.id, employeeId, existing.id)
    return { memberId: existing.id, email, linkedExisting: true }
  }
  if (!existing || !existing.is_active) await assertSeatAvailable(tenant.id)

  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  let memberId: string
  if (existing) {
    await updateMember(existing.id, { is_active: true, role: 'rep', display_name: name, password_hash: passwordHash })
    memberId = existing.id
  } else {
    const m = await createMember({ repId: tenant.id, email, displayName: name, role: 'rep', passwordHash, invitedBy: inviter.id })
    memberId = m.id
  }
  await linkEmployeeMember(tenant.id, employeeId, memberId)
  if (!emp.email) await supabase.from('cxo_employees').update({ email }).eq('rep_id', tenant.id).eq('id', employeeId)

  void logAuditEvent({
    repId: tenant.id,
    memberId: inviter.id,
    action: 'member.invite',
    entityType: 'member',
    entityId: memberId,
    diff: { email, role: 'rep', display_name: name, source: 'employees_self_view', employee_id: employeeId, reactivated: Boolean(existing) },
  })

  if (opts.send !== false) {
    const brand = ((tenant.brand ?? 'virtualcloser') as BrandKey)
    const tpl = memberInviteEmail({
      toEmail: email,
      displayName: name,
      role: 'rep',
      workspaceLabel: tenant.display_name || tenant.slug,
      slug: tenant.slug,
      password,
      invitedByName: inviter.display_name || 'The team',
      brand,
    })
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, brand })
  }
  return { memberId, email, linkedExisting: false }
}
