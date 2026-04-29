import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost, getCurrentTenant, getCurrentMember, requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { hashPassword, verifyPassword } from '@/lib/client-password'
import { sendEmail, passwordChangedEmail } from '@/lib/email'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'

/**
 * Settings tab — moved out of the main /dashboard page so the home
 * view stays focused on activity. Today this is account + password.
 * Future settings (notifications, profile photo, default timezone)
 * land here too.
 */
export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ pw_error?: string; pw_ok?: string }>
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
          <p className="eyebrow">Account · {tenant.slug}</p>
          <h1 style={{ marginBottom: '0.2rem' }}>Settings</h1>
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
  border: '1px solid var(--ink-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
}
