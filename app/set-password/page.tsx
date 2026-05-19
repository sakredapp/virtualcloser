import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { hashPassword } from '@/lib/client-password'
import { supabase } from '@/lib/supabase'
import { sendEmail, passwordChangedEmail } from '@/lib/email'
import { getBrand, type BrandKey } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const params = (await searchParams) ?? {}
  const errorCode = params.error

  let member: Awaited<ReturnType<typeof requireMember>>['member']
  let tenant: Awaited<ReturnType<typeof requireMember>>['tenant']
  try {
    const ctx = await requireMember()
    member = ctx.member
    tenant = ctx.tenant
  } catch {
    redirect('/login')
  }

  async function setPassword(formData: FormData) {
    'use server'
    const ctx = await requireMember().catch(() => null)
    if (!ctx) redirect('/login')
    const { member: m, tenant: t } = ctx

    const newPassword = String(formData.get('new_password') ?? '')
    const confirmPassword = String(formData.get('confirm_password') ?? '')

    if (!newPassword || newPassword.length < 8) {
      redirect('/set-password?error=short')
    }
    if (newPassword !== confirmPassword) {
      redirect('/set-password?error=mismatch')
    }

    const newHash = await hashPassword(newPassword)

    // Update the member row with the new personal password hash.
    await supabase.from('members').update({ password_hash: newHash }).eq('id', m.id)

    // Also keep the rep row in sync if this is the owner member.
    if (m.role === 'owner') {
      await supabase.from('reps').update({ password_hash: newHash }).eq('id', t.id)
    }

    // Brand-aware: confirmation email + dashboard redirect both follow the
    // tenant's brand. A CXO member finishing set-password lands on
    // <slug>.suitecxo.com and the email arrives with CXO chrome.
    const brandKey = ((t as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
    const brand = getBrand(brandKey)

    if (m.email) {
      const tpl = passwordChangedEmail({
        toEmail: m.email,
        displayName: m.display_name ?? m.email,
        brand: brandKey,
      })
      await sendEmail({
        to: m.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        brand: brandKey,
      }).catch(() => {})
    }

    redirect(`https://${t.slug}.${brand.rootDomain}/dashboard`)
  }

  const errorMsg =
    errorCode === 'mismatch'
      ? "Passwords don't match — try again."
      : errorCode === 'short'
        ? 'Password must be at least 8 characters.'
        : null

  return (
    <main className="wrap" style={{ maxWidth: 440 }}>
      <header className="hero">
        <h1 style={{ fontSize: '1.8rem' }}>Set your password</h1>
        <p className="sub">
          Welcome, {member.display_name}! Choose a personal password for your account.
        </p>
      </header>

      <section className="card">
        {errorMsg && (
          <p className="meta" style={{ color: '#fcb293', marginBottom: '0.7rem' }}>
            {errorMsg}
          </p>
        )}

        <form action={setPassword} style={{ display: 'grid', gap: '0.8rem' }}>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <label className="label">New password</label>
            <input
              name="new_password"
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
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <label className="label">Confirm password</label>
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
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button type="submit" className="btn-primary" style={{ marginTop: '0.4rem' }}>
            Set password &amp; go to dashboard
          </button>
        </form>
      </section>
    </main>
  )
}
