'use server'

import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand } from '@/lib/brand'
import { sendEmail } from '@/lib/email'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/**
 * "Delete my account" on Settings (Suite CXO). It deletes nothing itself: it
 * sends the request to the Suite CXO team, who remove the account, and tells
 * the person it was received. App Store rule 5.1.1(v) asks for a way to start
 * account deletion from inside the app; this is that way.
 */
export async function requestAccountDeletion(fd: FormData): Promise<void> {
  const { tenant, member } = await requireMember()
  if (fd.get('confirm') !== 'on') redirect('/dashboard/settings?del=confirm#delete-account')
  // An assistant working as their exec asks for their own account, never the exec's.
  const who = member.acting_assistant ?? member
  const brand = getBrand(tenant.brand)
  const company = tenant.company || tenant.display_name || tenant.slug
  const name = who.display_name || who.email || 'A member'
  const owner = !member.acting_assistant && member.role === 'owner'
  const lines = [
    `${name} asked for their Suite CXO account to be deleted.`,
    `Company: ${company} (${tenant.slug})`,
    `Member: ${who.id}`,
    `Email: ${who.email ?? 'none on file'}`,
    `Role: ${member.acting_assistant ? 'assistant' : member.role}${owner ? ' (the account owner: this is the company account)' : ''}`,
    `Asked: ${new Date().toISOString()}`,
  ]
  const sent = await sendEmail({
    to: brand.supportEmail,
    subject: `Account deletion request: ${name}, ${company}`,
    html: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
    text: lines.join('\n'),
    replyTo: who.email ?? undefined,
    brand: brand.key,
  })
  if (!sent.ok) redirect('/dashboard/settings?del=error#delete-account')
  if (who.email) {
    await sendEmail({
      to: who.email,
      subject: 'We received your request to delete your Suite CXO account',
      html: `<p>We received your request to delete your Suite CXO account. We will email you again when it is done.</p><p>If you did not ask for this, reply to this email.</p>`,
      text: 'We received your request to delete your Suite CXO account. We will email you again when it is done.\n\nIf you did not ask for this, reply to this email.',
      replyTo: brand.supportEmail,
      brand: brand.key,
    }).catch(() => null)
  }
  redirect('/dashboard/settings?del=sent#delete-account')
}
