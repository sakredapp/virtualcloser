import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getClient, addClientEvent } from '@/lib/admin-db'
import {
  createMember,
  listMembers,
  updateMember,
  getMemberById,
} from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { sendEmail, memberInviteEmail, generatePassword } from '@/lib/email'
import { telegramBotUsername } from '@/lib/telegram'
import type { MemberRole } from '@/types'

export const dynamic = 'force-dynamic'

const ALL_ROLES: MemberRole[] = ['owner', 'admin', 'manager', 'rep', 'observer']

export default async function ClientMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')
  const { id } = await params

  const client = await getClient(id)
  if (!client) notFound()
  const members = await listMembers(client.id)

  async function inviteMember(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')

    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const displayName = String(formData.get('display_name') ?? '').trim()
    const role = String(formData.get('role') ?? 'rep') as MemberRole
    const sendEmailNow = formData.get('send_invite') === '1'

    if (!email || !displayName || !ALL_ROLES.includes(role)) return

    const password = generatePassword()
    const hash = await hashPassword(password)

    const member = await createMember({
      repId: id,
      email,
      displayName,
      role,
      passwordHash: hash,
    })

    await addClientEvent({
      repId: id,
      kind: 'note',
      title: `Invited ${displayName} (${role}) — ${email}`,
    })

    if (sendEmailNow) {
      const tpl = memberInviteEmail({
        toEmail: email,
        displayName,
        role,
        workspaceLabel: client!.company || client!.display_name,
        slug: client!.slug,
        password,
        invitedByName: 'The team',
        telegramLinkCode: member.telegram_link_code,
        telegramBotUsername: telegramBotUsername(),
      })
      const result = await sendEmail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      })
      await addClientEvent({
        repId: id,
        kind: 'email',
        title: result.ok
          ? `Invite email sent to ${email} (Resend id ${result.id ?? '?'})`
          : `Invite email FAILED for ${email}: ${result.error ?? 'unknown'}`,
      })
    }

    revalidatePath(`/admin/clients/${id}/members`)
  }

  async function updateMemberRole(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const memberId = String(formData.get('member_id') ?? '')
    const role = String(formData.get('role') ?? '') as MemberRole
    if (!memberId || !ALL_ROLES.includes(role)) return
    const m = await getMemberById(memberId)
    if (!m || m.rep_id !== id) return
    await updateMember(memberId, { role })
    await addClientEvent({
      repId: id,
      kind: 'note',
      title: `Member ${m.display_name} role → ${role}`,
    })
    revalidatePath(`/admin/clients/${id}/members`)
  }

  async function toggleMemberActive(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const memberId = String(formData.get('member_id') ?? '')
    const active = formData.get('active') === '1'
    const m = await getMemberById(memberId)
    if (!m || m.rep_id !== id) return
    if (m.role === 'owner' && !active) return // can't deactivate the owner
    await updateMember(memberId, { is_active: active })
    await addClientEvent({
      repId: id,
      kind: 'note',
      title: `${active ? 'Reactivated' : 'Deactivated'} ${m.display_name}`,
    })
    revalidatePath(`/admin/clients/${id}/members`)
  }

  async function resetMemberPassword(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const memberId = String(formData.get('member_id') ?? '')
    const m = await getMemberById(memberId)
    if (!m || m.rep_id !== id) return

    const password = generatePassword()
    const hash = await hashPassword(password)
    await updateMember(memberId, { password_hash: hash })

    const tpl = memberInviteEmail({
      toEmail: m.email,
      displayName: m.display_name,
      role: m.role,
      workspaceLabel: client!.company || client!.display_name,
      slug: client!.slug,
      password,
      invitedByName: null,
      telegramLinkCode: m.telegram_link_code,
      telegramBotUsername: telegramBotUsername(),
    })
    const result = await sendEmail({
      to: m.email,
      subject: `Your Virtual Closer password was reset`,
      html: tpl.html,
      text: tpl.text,
    })
    await addClientEvent({
      repId: id,
      kind: 'email',
      title: result.ok
        ? `Password reset email sent to ${m.email}`
        : `Password reset email FAILED for ${m.email}: ${result.error ?? 'unknown'}`,
    })
    revalidatePath(`/admin/clients/${id}/members`)
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Members</p>
        <h1>{client.display_name}</h1>
        <p className="sub">
          {client.slug}.virtualcloser.com · {members.length} member{members.length === 1 ? '' : 's'}
        </p>
        <p className="nav">
          <Link href={`/admin/clients/${client.id}`}>← Back to client</Link>
          <span>·</span>
          <Link href="/admin/clients">All clients</Link>
        </p>
      </header>

      <section className="card" style={{ marginTop: '0.6rem' }}>
        <div className="section-head">
          <h2>Invite a member</h2>
        </div>
        <p className="meta" style={{ marginBottom: '0.7rem' }}>
          Generates a secure password and (optionally) emails them a branded invite with sign-in details and the Telegram link code.
        </p>
        <form
          action={inviteMember}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: '0.6rem' }}
        >
          <label style={lblStyle}>
            <span>Display name</span>
            <input name="display_name" required style={inputStyle} placeholder="Jane Doe" />
          </label>
          <label style={lblStyle}>
            <span>Email</span>
            <input name="email" type="email" required style={inputStyle} placeholder="jane@acme.com" />
          </label>
          <label style={lblStyle}>
            <span>Role</span>
            <select name="role" defaultValue="rep" style={inputStyle}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.88rem',
            }}
          >
            <input type="checkbox" name="send_invite" value="1" defaultChecked />
            <span>Email the invite to them now</span>
          </label>
          <button type="submit" className="btn approve" style={{ gridColumn: '1 / -1' }}>
            Create member &amp; send invite
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Members</h2>
          <p>{members.length}</p>
        </div>
        {members.length === 0 ? (
          <p className="empty">No members yet.</p>
        ) : (
          <ul className="list">
            {members.map((m) => (
              <li key={m.id} className="row" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', width: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <p className="name" style={{ opacity: m.is_active ? 1 : 0.55 }}>
                      {m.display_name}{' '}
                      <span
                        style={{
                          fontSize: '0.7rem',
                          background: m.role === 'owner' ? 'var(--red)' : 'var(--ink-soft)',
                          color: m.role === 'owner' ? '#fff' : 'var(--text)',
                          padding: '2px 8px',
                          borderRadius: 999,
                          marginLeft: 6,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          fontWeight: 600,
                        }}
                      >
                        {m.role}
                      </span>
                      {!m.is_active && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--muted)',
                            marginLeft: 6,
                            fontWeight: 500,
                          }}
                        >
                          (inactive)
                        </span>
                      )}
                    </p>
                    <p className="meta">
                      {m.email}
                      {m.slug ? ` · /u/${m.slug}` : ''}
                      {m.last_login_at ? ` · last login ${new Date(m.last_login_at).toLocaleDateString()}` : ' · never logged in'}
                    </p>
                  </div>
                  <form action={updateMemberRole}>
                    <input type="hidden" name="member_id" value={m.id} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      style={{ ...inputStyle, padding: '0.35rem' }}
                      disabled={m.role === 'owner'}
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="btn"
                      style={{ marginLeft: 4 }}
                      disabled={m.role === 'owner'}
                    >
                      Save role
                    </button>
                  </form>
                  <form action={resetMemberPassword}>
                    <input type="hidden" name="member_id" value={m.id} />
                    <button type="submit" className="btn dismiss">
                      Reset pw + email
                    </button>
                  </form>
                  {m.role !== 'owner' && (
                    <form action={toggleMemberActive}>
                      <input type="hidden" name="member_id" value={m.id} />
                      <input type="hidden" name="active" value={m.is_active ? '0' : '1'} />
                      <button type="submit" className={`btn ${m.is_active ? 'dismiss' : 'approve'}`}>
                        {m.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

const lblStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  fontSize: '0.78rem',
  color: '#5a6aa6',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem',
  borderRadius: 10,
  border: '1px solid #e6d9ac',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
