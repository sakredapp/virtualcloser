/**
 * Settings › Co-admins: invite a teammate as an admin of this account, or
 * remove one. One copy of the rules, used by the Settings page form
 * (app/dashboard/settings/page.tsx) and by Ciao / MCP through the settings
 * registry (lib/settings/registry.ts). Returns a result; never redirects.
 */
import { hashPassword } from '@/lib/client-password'
import { sendEmail, memberInviteEmail, generatePassword } from '@/lib/email'
import { createMember, getMemberByEmailAnyStatus, getMemberById, updateMember, assertSeatAvailable, logAuditEvent } from '@/lib/members'
import { isAtLeast } from '@/lib/permissions'
import type { BrandKey } from '@/lib/brand'
import type { Member } from '@/types'

type TenantLike = { id: string; slug: string; display_name: string | null; brand?: string | null }
type Actor = Pick<Member, 'id' | 'role' | 'display_name'>

export type CoAdminResult = { ok: true; memberId: string; email: string; reactivated?: boolean } | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function inviteCoAdmin(tenant: TenantLike, actor: Actor, input: { email: unknown; displayName: unknown; source?: string }): Promise<CoAdminResult> {
  if (!isAtLeast(actor.role, 'admin')) return { ok: false, error: 'Only owners and admins can invite assistants.' }
  const email = String(input.email ?? '').trim().toLowerCase()
  const displayName = String(input.displayName ?? '').trim()
  if (!email || !displayName) return { ok: false, error: 'Email and name are required.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'That email does not look right.' }

  // Look up including soft-deleted rows: removing only sets is_active=false,
  // and the unique index on (rep_id, lower(email)) keeps the row. Re-inviting
  // REACTIVATES that row and always re-sends fresh credentials.
  const existing = await getMemberByEmailAnyStatus(tenant.id, email)
  if (existing && existing.id === actor.id) return { ok: false, error: "That's your own account." }
  if (existing && existing.role === 'assistant') return { ok: false, error: 'That person is an executive assistant. Remove them under Your assistant first.' }

  // Only an inactive/new member consumes a fresh seat.
  if (!existing || !existing.is_active) {
    try {
      await assertSeatAvailable(tenant.id)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Seat cap reached.' }
    }
  }

  const password = generatePassword()
  const passwordHash = await hashPassword(password)

  let memberId: string
  if (existing) {
    await updateMember(existing.id, { is_active: true, role: 'admin', display_name: displayName, password_hash: passwordHash })
    memberId = existing.id
  } else {
    try {
      const created = await createMember({ repId: tenant.id, email, displayName, role: 'admin', passwordHash, invitedBy: actor.id })
      memberId = created.id
    } catch (err) {
      // check-then-insert race (double submit): reactivate the row that won.
      if ((err as { code?: string })?.code === '23505') {
        const raced = await getMemberByEmailAnyStatus(tenant.id, email)
        if (!raced) throw err
        await updateMember(raced.id, { is_active: true, role: 'admin', display_name: displayName, password_hash: passwordHash })
        memberId = raced.id
      } else {
        throw err
      }
    }
  }

  void logAuditEvent({
    repId: tenant.id,
    memberId: actor.id,
    action: 'member.invite',
    entityType: 'member',
    entityId: memberId,
    diff: { email, role: 'admin', display_name: displayName, source: input.source ?? 'settings_assistant', reactivated: Boolean(existing) },
  })

  try {
    const brand = (tenant.brand ?? 'virtualcloser') as BrandKey
    const tpl = memberInviteEmail({
      toEmail: email,
      displayName,
      role: 'admin',
      workspaceLabel: tenant.display_name || tenant.slug,
      slug: tenant.slug,
      password,
      invitedByName: actor.display_name || 'The team',
      brand,
    })
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, brand })
  } catch (err) {
    console.error('[co-admin invite] email send failed', err)
  }
  return { ok: true, memberId, email, reactivated: Boolean(existing) }
}

/** Deactivate a co-admin (members.is_active = false). Never the owner, an exec assistant or yourself. */
export async function removeCoAdmin(tenant: { id: string }, actor: Actor, targetId: unknown, source = 'settings_assistant'): Promise<CoAdminResult> {
  if (!isAtLeast(actor.role, 'admin')) return { ok: false, error: 'Only owners and admins can remove assistants.' }
  const id = String(targetId ?? '').trim()
  if (!id) return { ok: false, error: 'Say who to remove.' }
  const target = await getMemberById(id)
  if (!target || target.rep_id !== tenant.id) return { ok: false, error: 'Member not found on this account.' }
  if (target.role === 'owner') return { ok: false, error: "You can't remove the account owner." }
  if (target.role === 'assistant') return { ok: false, error: 'An executive removes their own assistant under Your assistant.' }
  if (target.id === actor.id) return { ok: false, error: "You can't remove yourself here." }

  await updateMember(target.id, { is_active: false })
  void logAuditEvent({
    repId: tenant.id,
    memberId: actor.id,
    action: 'member.deactivate',
    entityType: 'member',
    entityId: target.id,
    diff: { email: target.email, role: target.role, source },
  })
  return { ok: true, memberId: target.id, email: target.email ?? target.display_name }
}
