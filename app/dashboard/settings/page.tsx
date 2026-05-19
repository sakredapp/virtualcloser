import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost, getCurrentTenant, getCurrentMember, requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { hashPassword, verifyPassword } from '@/lib/client-password'
import { sendEmail, passwordChangedEmail, memberInviteEmail, generatePassword } from '@/lib/email'
import {
  listMembers,
  createMember,
  getMemberByEmail,
  getMemberById,
  updateMember,
  assertSeatAvailable,
  logAuditEvent,
} from '@/lib/members'
import { telegramBotUsername } from '@/lib/telegram'
import { isAtLeast } from '@/lib/permissions'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import type { Member } from '@/types'

/**
 * Settings tab — moved out of the main /dashboard page so the home
 * view stays focused on activity. Today this is account + password.
 * Future settings (notifications, profile photo, default timezone)
 * land here too.
 */
export const dynamic = 'force-dynamic'

/**
 * Invite an assistant (or co-admin) into this tenant. Lives on /settings so
 * even a solo owner — who never opens the enterprise org chart — can grant
 * a teammate full admin access to their account in one form. Gated to
 * owner/admin so reps can't escalate privileges.
 */
async function actionInviteAssistant(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent('Only owners and admins can invite assistants.'))
  }

  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const displayName = String(fd.get('display_name') ?? '').trim()
  if (!email || !displayName) {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent('Email and name are required.'))
  }

  const existing = await getMemberByEmail(tenant.id, email)
  if (existing) {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent(`${email} is already on your account.`))
  }

  try {
    await assertSeatAvailable(tenant.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Seat cap reached.'
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent(msg))
  }

  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  const newMember = await createMember({
    repId: tenant.id,
    email,
    displayName,
    role: 'admin',
    passwordHash,
    invitedBy: member.id,
  })

  void logAuditEvent({
    repId: tenant.id,
    memberId: member.id,
    action: 'member.invite',
    entityType: 'member',
    entityId: newMember.id,
    diff: { email, role: 'admin', display_name: displayName, source: 'settings_assistant' },
  })

  try {
    const tpl = memberInviteEmail({
      toEmail: email,
      displayName,
      role: 'admin',
      workspaceLabel: tenant.display_name || tenant.slug,
      slug: tenant.slug,
      password,
      invitedByName: member.display_name || 'The team',
      telegramLinkCode: newMember.telegram_link_code,
      telegramBotUsername: telegramBotUsername(),
    })
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
  } catch (err) {
    console.error('[settings assistant invite] email send failed', err)
  }

  revalidatePath('/dashboard/settings')
  redirect('/dashboard/settings?assist_invited=' + encodeURIComponent(email))
}

/** Deactivate an assistant — soft remove via members.is_active = false. */
async function actionRemoveAssistant(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent('Only owners and admins can remove assistants.'))
  }
  const targetId = String(fd.get('member_id') ?? '').trim()
  if (!targetId) redirect('/dashboard/settings')

  const target = await getMemberById(targetId)
  if (!target || target.rep_id !== tenant.id) {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent('Member not found on this account.'))
  }
  if (target.role === 'owner') {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent("You can't remove the account owner."))
  }
  if (target.id === member.id) {
    redirect('/dashboard/settings?assist_error=' + encodeURIComponent("You can't remove yourself here."))
  }

  await updateMember(target.id, { is_active: false })

  void logAuditEvent({
    repId: tenant.id,
    memberId: member.id,
    action: 'member.deactivate',
    entityType: 'member',
    entityId: target.id,
    diff: { email: target.email, role: target.role, source: 'settings_assistant' },
  })

  revalidatePath('/dashboard/settings')
  redirect('/dashboard/settings?assist_removed=' + encodeURIComponent(target.email ?? target.display_name))
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    pw_error?: string
    pw_ok?: string
    assist_error?: string
    assist_invited?: string
    assist_removed?: string
  }>
}) {
  const sp = (await searchParams) ?? {}

  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')
  const tenant = await getCurrentTenant()
  if (!tenant) redirect('/login')
  const viewerMember = await getCurrentMember()

  // Pull the member's email for the "you are signed in as …" line. Falls
  // back to the rep row for legacy single-seat accounts where members
  // wasn't backfilled yet.
  let signedInEmail: string | null = viewerMember?.email ?? null
  if (!signedInEmail) {
    const { data: repRow } = await supabase
      .from('reps')
      .select('email')
      .eq('id', tenant.id)
      .maybeSingle()
    signedInEmail = repRow?.email ?? null
  }

  const navTabs = await buildDashboardTabs(tenant.id, viewerMember)

  // Assistant management — only loaded when the viewer can actually use it.
  const canManageAssistants = viewerMember ? isAtLeast(viewerMember.role, 'admin') : false
  let assistants: Member[] = []
  if (canManageAssistants) {
    const all = await listMembers(tenant.id)
    assistants = all.filter(
      (m) =>
        m.is_active &&
        m.id !== viewerMember?.id &&
        (m.role === 'admin' || m.role === 'manager' || m.role === 'observer'),
    )
  }
  const assistError = typeof sp.assist_error === 'string' ? sp.assist_error : null
  const assistInvited = typeof sp.assist_invited === 'string' ? sp.assist_invited : null
  const assistRemoved = typeof sp.assist_removed === 'string' ? sp.assist_removed : null

  async function onChangePassword(formData: FormData) {
    'use server'
    const { tenant: t, member: m } = await requireMember()
    const currentPassword = String(formData.get('current_password') ?? '')
    const newPassword = String(formData.get('new_password') ?? '')
    const confirmPassword = String(formData.get('confirm_password') ?? '')

    if (!currentPassword || !newPassword || newPassword.length < 8) {
      redirect('/dashboard/settings?pw_error=invalid')
    }
    if (newPassword !== confirmPassword) {
      redirect('/dashboard/settings?pw_error=mismatch')
    }

    const { data: memberRow } = await supabase
      .from('members')
      .select('password_hash, email, display_name')
      .eq('id', m.id)
      .single()
    const hashToCheck =
      memberRow?.password_hash ??
      (await supabase.from('reps').select('password_hash').eq('id', t.id).single()).data
        ?.password_hash

    const ok = await verifyPassword(currentPassword, hashToCheck)
    if (!ok) redirect('/dashboard/settings?pw_error=wrong')

    const newHash = await hashPassword(newPassword)
    await supabase.from('members').update({ password_hash: newHash }).eq('id', m.id)
    if (m.role === 'owner') {
      await supabase.from('reps').update({ password_hash: newHash }).eq('id', t.id)
    }

    const emailAddr = memberRow?.email
    if (emailAddr) {
      const tpl = passwordChangedEmail({
        toEmail: emailAddr,
        displayName: memberRow?.display_name ?? emailAddr,
      })
      await sendEmail({ to: emailAddr, subject: tpl.subject, html: tpl.html, text: tpl.text })
    }
    redirect('/dashboard/settings?pw_ok=1')
  }

  return (
    <main className="wrap">
      <header className="hero" style={{ marginBottom: '0.5rem' }}>
        <div>
          <p className="eyebrow">Settings</p>
          <h1 style={{ marginBottom: '0.2rem' }}>Account</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Manage your sign-in details. Need to change something else? Ping team@virtualcloser.com.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Account</h2>
          <p>{signedInEmail ?? 'no email on file'}</p>
        </div>
        <p className="meta" style={{ margin: 0 }}>
          {viewerMember?.display_name
            ? `Signed in as ${viewerMember.display_name}`
            : 'Signed in'}
          {signedInEmail ? ` · ${signedInEmail}` : ''}
        </p>
      </section>

      {canManageAssistants && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Assistants & co-admins</h2>
            <p>people who can log in and act on your account</p>
          </div>
          <p className="meta" style={{ margin: '0 0 0.7rem' }}>
            Invite an assistant (or a co-admin) by email. They get a login with full admin
            access to this account — leads, dialer, calendar, inbox — and a welcome email
            with their password. Remove them anytime.
          </p>

          {assistError && (
            <p className="meta" style={{ color: '#b00020', marginBottom: '0.6rem' }}>
              {assistError}
            </p>
          )}
          {assistInvited && !assistError && (
            <p className="meta" style={{ color: 'var(--green, #166534)', marginBottom: '0.6rem' }}>
              ✓ Invite sent to <strong>{assistInvited}</strong>. They&apos;ll get an email with their password.
            </p>
          )}
          {assistRemoved && !assistError && (
            <p className="meta" style={{ color: 'var(--muted)', marginBottom: '0.6rem' }}>
              Removed <strong>{assistRemoved}</strong> from this account.
            </p>
          )}

          <form
            action={actionInviteAssistant}
            style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1.3fr 1fr auto', alignItems: 'stretch', marginBottom: '0.9rem' }}
          >
            <input
              type="email"
              name="email"
              required
              placeholder="assistant@example.com"
              style={accountInputStyle}
              autoComplete="email"
            />
            <input
              type="text"
              name="display_name"
              required
              placeholder="Full name"
              style={accountInputStyle}
              autoComplete="name"
            />
            <button type="submit" className="btn approve" style={{ padding: '0.55rem 1rem' }}>
              Send invite
            </button>
          </form>

          {assistants.length === 0 ? (
            <p className="meta" style={{ margin: 0 }}>No assistants yet — invite someone above.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
              {assistants.map((a) => (
                <li
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '0.55rem 0.8rem',
                    border: '1px solid var(--border-soft)',
                    borderRadius: 10,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <strong style={{ fontSize: 14, lineHeight: 1.2 }}>{a.display_name}</strong>
                    <span className="meta" style={{ fontSize: 12 }}>
                      {a.email ?? '—'} · <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{a.role}</span>
                    </span>
                  </div>
                  <form action={actionRemoveAssistant}>
                    <input type="hidden" name="member_id" value={a.id} />
                    <button
                      type="submit"
                      className="btn"
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: 'none',
                        border: '1px solid var(--border-soft)',
                        color: '#b00020',
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Change password</h2>
          <p>used to sign in here</p>
        </div>
        <div style={{ display: 'grid', gap: '0.7rem', maxWidth: 420 }}>
          {sp.pw_ok === '1' && (
            <p className="meta" style={{ color: 'var(--red)' }}>
              Password updated. We sent a confirmation to your email.
            </p>
          )}
          {sp.pw_error === 'wrong' && (
            <p className="meta" style={{ color: '#b00020' }}>
              Current password didn&apos;t match. Try again.
            </p>
          )}
          {sp.pw_error === 'mismatch' && (
            <p className="meta" style={{ color: '#b00020' }}>
              New password and confirmation didn&apos;t match.
            </p>
          )}
          {sp.pw_error === 'invalid' && (
            <p className="meta" style={{ color: '#b00020' }}>
              Password must be at least 8 characters.
            </p>
          )}
          <form action={onChangePassword} style={{ display: 'grid', gap: '0.55rem' }}>
            <label className="meta" style={{ display: 'grid', gap: '0.25rem' }}>
              <span>Current password</span>
              <input
                name="current_password"
                type="password"
                required
                autoComplete="current-password"
                style={accountInputStyle}
              />
            </label>
            <label className="meta" style={{ display: 'grid', gap: '0.25rem' }}>
              <span>New password (min 8 chars)</span>
              <input
                name="new_password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                style={accountInputStyle}
              />
            </label>
            <label className="meta" style={{ display: 'grid', gap: '0.25rem' }}>
              <span>Confirm new password</span>
              <input
                name="confirm_password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                style={accountInputStyle}
              />
            </label>
            <button type="submit" className="btn approve" style={{ marginTop: '0.2rem' }}>
              Change password
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}

const accountInputStyle: React.CSSProperties = {
  padding: '0.55rem',
  borderRadius: 10,
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
}
