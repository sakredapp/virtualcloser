import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { generateNonce } from '@/lib/random'
import { sendEmail, passwordResetEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ sent?: string; error?: string }>
}) {
  const params = (await searchParams) ?? {}

  async function requestReset(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    if (!email) redirect('/forgot-password?error=missing')

    // Always redirect to the "check your email" page regardless of whether the
    // address exists — avoids leaking which emails are registered.
    const { data: member } = await supabase
      .from('members')
      .select('id, email, display_name, rep_id')
      .ilike('email', email)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (member) {
      const token = generateNonce(32) // 64-char hex, 256 bits of entropy
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

      await supabase
        .from('members')
        .update({ password_reset_token: token, password_reset_expires_at: expiresAt })
        .eq('id', member.id)

      const resetUrl = `https://${ROOT_DOMAIN}/reset-password?token=${token}`
      const tpl = passwordResetEmail({
        toEmail: member.email,
        displayName: member.display_name,
        resetUrl,
      })
      await sendEmail({ to: member.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    }

    redirect('/forgot-password?sent=1')
  }

  if (params.sent === '1') {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <header className="hero">
          <h1 style={{ fontSize: '1.8rem' }}>Check your email</h1>
          <p className="sub">
            If that address is on an account, we've sent a reset link. Check your inbox (and spam folder).
          </p>
        </header>
        <section className="card">
          <p className="meta" style={{ marginBottom: '1rem' }}>
            The link expires in 1 hour. Once you've reset your password you can sign in as normal.
          </p>
          <Link href="/login" className="btn approve" style={{ display: 'inline-block' }}>
            Back to sign in
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="wrap" style={{ maxWidth: 440 }}>
      <header className="hero">
        <h1 style={{ fontSize: '1.8rem' }}>Reset password</h1>
        <p className="sub">Enter your email and we'll send you a reset link.</p>
      </header>

      <section className="card">
        {params.error === 'missing' && (
          <p className="meta" style={{ color: '#fcb293', marginBottom: '0.7rem' }}>
            Please enter your email address.
          </p>
        )}

        <form action={requestReset} style={{ display: 'grid', gap: '0.7rem' }}>
          <label
            style={{
              display: 'grid',
              gap: '0.3rem',
              fontSize: '0.78rem',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            <span>Email</span>
            <input
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              style={{
                padding: '0.65rem',
                borderRadius: 10,
                border: '1px solid var(--ink-soft)',
                background: '#ffffff',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                textTransform: 'none',
                letterSpacing: 'normal',
              }}
            />
          </label>
          <button type="submit" className="btn approve" style={{ marginTop: '0.2rem' }}>
            Send reset link
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
