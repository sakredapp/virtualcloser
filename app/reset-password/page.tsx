import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/client-password'
import { sendEmail, passwordChangedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

async function findMemberByToken(token: string) {
  if (!token || token.length < 32) return null
  const { data } = await supabase
    .from('members')
    .select('id, email, display_name, role, rep_id, password_reset_expires_at')
    .eq('password_reset_token', token)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!data) return null
  // Check expiry
  if (!data.password_reset_expires_at || new Date(data.password_reset_expires_at) < new Date()) {
    return null
  }
  return data
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string; error?: string; done?: string }>
}) {
  const params = (await searchParams) ?? {}
  const token = params.token ?? ''

  if (params.done === '1') {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <header className="hero">
          <h1 style={{ fontSize: '1.8rem' }}>Password updated</h1>
          <p className="sub">Your new password is set. Sign in to continue.</p>
        </header>
        <section className="card">
          <Link href="/login" className="btn approve" style={{ display: 'inline-block' }}>
            Sign in →
          </Link>
        </section>
      </main>
    )
  }

  const member = await findMemberByToken(token)

  if (!member) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <header className="hero">
          <h1 style={{ fontSize: '1.8rem' }}>Link expired</h1>
          <p className="sub">This reset link is invalid or has expired. Request a new one.</p>
        </header>
        <section className="card">
          <Link href="/forgot-password" className="btn approve" style={{ display: 'inline-block' }}>
            Request new link
          </Link>
        </section>
      </main>
    )
  }

  const errorCode = params.error
  const errorMsg =
    errorCode === 'mismatch'
      ? "Passwords don't match — try again."
      : errorCode === 'short'
        ? 'Password must be at least 8 characters.'
        : null

  async function resetPassword(formData: FormData) {
    'use server'
    const tok = String(formData.get('token') ?? '').trim()
    const newPassword = String(formData.get('new_password') ?? '')
    const confirmPassword = String(formData.get('confirm_password') ?? '')

    if (!newPassword || newPassword.length < 8) {
      redirect(`/reset-password?token=${encodeURIComponent(tok)}&error=short`)
    }
    if (newPassword !== confirmPassword) {
      redirect(`/reset-password?token=${encodeURIComponent(tok)}&error=mismatch`)
    }

    // Re-validate token server-side (prevents replay after expiry during form fill)
    const m = await findMemberByToken(tok)
    if (!m) redirect('/forgot-password?error=expired')

    const newHash = await hashPassword(newPassword)

    // Update password and clear the reset token atomically-ish
    await supabase
      .from('members')
      .update({
        password_hash: newHash,
        password_reset_token: null,
        password_reset_expires_at: null,
      })
      .eq('id', m.id)

    // Keep rep row in sync if owner
    if (m.role === 'owner' && m.rep_id) {
      await supabase.from('reps').update({ password_hash: newHash }).eq('id', m.rep_id)
    }

    // Confirmation email (best-effort)
    if (m.email) {
      const tpl = passwordChangedEmail({ toEmail: m.email, displayName: m.display_name ?? m.email })
      await sendEmail({ to: m.email, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(() => {})
    }

    redirect('/reset-password?done=1')
  }

  return (
    <main className="wrap" style={{ maxWidth: 440 }}>
      <header className="hero">
        <h1 style={{ fontSize: '1.8rem' }}>Set new password</h1>
        <p className="sub">Hi {member.display_name} — choose a new password for your account.</p>
      </header>

      <section className="card">
        {errorMsg && (
          <p className="meta" style={{ color: '#fcb293', marginBottom: '0.7rem' }}>
            {errorMsg}
          </p>
        )}

        <form action={resetPassword} style={{ display: 'grid', gap: '0.8rem' }}>
          <input type="hidden" name="token" value={token} />

          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <label
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              New password
            </label>
            <input
              name="new_password"
              type="password"
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
              style={{
                padding: '0.65rem',
                borderRadius: 10,
                border: '1px solid var(--border-soft)',
                background: '#ffffff',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <label
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Confirm password
            </label>
            <input
              name="confirm_password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              style={{
                padding: '0.65rem',
                borderRadius: 10,
                border: '1px solid var(--border-soft)',
                background: '#ffffff',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
              }}
            />
          </div>

          <button type="submit" className="btn approve" style={{ marginTop: '0.2rem' }}>
            Update password
          </button>
        </form>

        <p className="meta" style={{ marginTop: '0.9rem' }}>
          <Link href="/login" style={{ color: 'var(--muted)' }}>
            ← Back to sign in
          </Link>
        </p>
      </section>
    </main>
  )
}
