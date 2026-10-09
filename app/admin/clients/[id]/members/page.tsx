import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getClient, addClientEvent } from '@/lib/admin-db'
import { getBrand, type BrandKey } from '@/lib/brand'
import {
  createMember,
  listMembers,
  logAuditEvent,
  updateMember,
  getMemberById,
} from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { sendEmail, loginLinkInviteEmail } from '@/lib/email'
import { generateNonce } from '@/lib/random'
import { supabase } from '@/lib/supabase'
import { loginLinkExpiresLabel, loginLinkUrl, pickLoginLinkToken } from '@/lib/loginLink'
import type { MemberRole } from '@/types'

export const dynamic = 'force-dynamic'

const ALL_ROLES: MemberRole[] = ['owner', 'admin', 'manager', 'rep', 'observer']

/**
 * Email a member their "Your login is ready" link (set-your-password via
 * /reset-password). Reuses a still-valid link (1+ day left) so an earlier
 * email keeps working; otherwise mints a fresh 64-hex token for 7 days.
 * No password is ever emailed. Logs the Resend id on the client timeline.
 */
async function sendLoginLink(input: {
  repId: string
  memberId: string
  workspaceLabel: string
  brand: BrandKey
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data: row } = await supabase
    .from('members')
    .select('id, rep_id, email, display_name, role, is_active, password_reset_token, password_reset_expires_at')
    .eq('id', input.memberId)
    .maybeSingle()
  const m = row as {
    id: string
    rep_id: string
    email: string
    display_name: string | null
    role: MemberRole
    is_active: boolean
    password_reset_token: string | null
    password_reset_expires_at: string | null
  } | null
  if (!m || m.rep_id !== input.repId || !m.is_active || !m.email) return { ok: false, error: 'member not found or inactive' }

  const link = pickLoginLinkToken(
    { token: m.password_reset_token, expiresAt: m.password_reset_expires_at },
    Date.now(),
    () => generateNonce(32), // 64-char hex
  )
  if (!link.reused) {
    const { error } = await supabase
      .from('members')
      .update({ password_reset_token: link.token, password_reset_expires_at: link.expiresAt })
      .eq('id', m.id)
    if (error) return { ok: false, error: error.message }
  }

  const brand = getBrand(input.brand)
  const tpl = loginLinkInviteEmail({
    toEmail: m.email,
    displayName: m.display_name || m.email,
    workspaceLabel: input.workspaceLabel,
    role: m.role,
    setUrl: loginLinkUrl(brand.rootDomain, link.token),
    expiresLabel: loginLinkExpiresLabel(link.expiresAt),
    brand: input.brand,
  })
  const result = await sendEmail({ to: m.email, subject: tpl.subject, html: tpl.html, text: tpl.text, brand: input.brand })
  await addClientEvent({
    repId: input.repId,
    kind: 'email',
    title: result.ok
      ? `Login link sent to ${m.email} (${link.reused ? 'existing' : 'new'} link, Resend id ${result.id ?? '?'})`
      : `Login link email FAILED for ${m.email}: ${result.error ?? 'unknown'}`,
  })
  void logAuditEvent({
    repId: input.repId,
    memberId: null,
    action: 'member.send_login_link',
    entityType: 'member',
    entityId: m.id,
    diff: { reused_link: link.reused, expires_at: link.expiresAt, resend_id: result.id ?? null, ok: result.ok },
  })
  return result
}

export default async function ClientMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')
  const { id } = await params

  const client = await getClient(id)
  if (!client) notFound()
  const members = await listMembers(client.id, { includeAssistants: true })

  async function inviteMember(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')

    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const displayName = String(formData.get('display_name') ?? '').trim()
    const role = String(formData.get('role') ?? 'rep') as MemberRole
    const sendEmailNow = formData.get('send_invite') === '1'

    if (!email || !displayName || !ALL_ROLES.includes(role)) return

    const existing = members.find((m) => m.email.toLowerCase() === email && m.is_active)
    if (existing) {
      await addClientEvent({
        repId: id,
        kind: 'note',
        title: `Invite skipped — ${email} is already an active member (${existing.display_name})`,
      })
      revalidatePath(`/admin/clients/${id}/members`)
      return
    }

    // Nobody ever sees this password: the member sets their own from the
    // login link. It only keeps password_hash non-null until they do.
    const hash = await hashPassword(generateNonce(32))

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
    void logAuditEvent({
      repId: id,
      memberId: null,
      action: 'member.invite',
      entityType: 'member',
      entityId: member.id,
      diff: { email, role, display_name: displayName },
    })

    if (sendEmailNow) {
      await sendLoginLink({
        repId: id,
        memberId: member.id,
        workspaceLabel: client!.company || client!.display_name,
        brand: ((client as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey,
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
    void logAuditEvent({
      repId: id,
      memberId: null,
      action: 'member.set_role',
      entityType: 'member',
      entityId: memberId,
      diff: { from_role: m.role, to_role: role },
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
    void logAuditEvent({
      repId: id,
      memberId: null,
      action: active ? 'member.reactivate' : 'member.deactivate',
      entityType: 'member',
      entityId: memberId,
    })
    revalidatePath(`/admin/clients/${id}/members`)
  }

  async function sendMemberLoginLink(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const memberId = String(formData.get('member_id') ?? '')
    const m = await getMemberById(memberId)
    if (!m || m.rep_id !== id) return
    await sendLoginLink({
      repId: id,
      memberId,
      workspaceLabel: client!.company || client!.display_name,
      brand: ((client as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey,
    })
    revalidatePath(`/admin/clients/${id}/members`)
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Members</p>
        <h1>{client.display_name}</h1>
        <p className="sub">
          {client.slug}.{getBrand((client as { brand?: BrandKey }).brand).rootDomain} · {members.length} member{members.length === 1 ? '' : 's'}
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
          Creates the member and (optionally) emails them a branded &ldquo;Your login is ready&rdquo; link to set their own password. No password is ever emailed.
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
                  <form action={sendMemberLoginLink}>
                    <input type="hidden" name="member_id" value={m.id} />
                    <button type="submit" className="btn dismiss" disabled={!m.is_active}>
                      Send login link
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
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
