import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { setSessionCookie } from '@/lib/client-auth'
import { verifyPassword } from '@/lib/client-password'
import { findMemberByEmailGlobal, recordMemberLogin } from '@/lib/members'
import type { Tenant } from '@/lib/tenant'
import PasswordField from './PasswordField'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; next?: string }>
}) {
  const params = (await searchParams) ?? {}
  const errorCode = params.error
  const nextUrl = params.next

  async function login(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    const nextParam = String(formData.get('next') ?? '')

    if (!email || !password) redirect('/login?error=missing')

    // 1) Prefer member-based login (every account has at least an 'owner' member after migration).
    const member = await findMemberByEmailGlobal(email)
    let tenant: (Tenant & { password_hash: string | null }) | null = null
    let memberId: string | null = null

    if (member && member.password_hash) {
      const ok = await verifyPassword(password, member.password_hash)
      if (!ok) redirect('/login?error=invalid')
      const { data: repRow, error: repErr } = await supabase
        .from('reps')
        .select('*')
        .eq('id', member.rep_id)
        .eq('is_active', true)
        .maybeSingle()
      if (repErr || !repRow) redirect('/login?error=invalid')
      tenant = repRow as Tenant & { password_hash: string | null }
      memberId = member.id
      await recordMemberLogin(member.id)
    } else {
      // 2) Legacy fallback: rep-row login (covers any account whose owner member somehow lacks a hash).
      const { data, error } = await supabase
        .from('reps')
        .select('*')
        .ilike('email', email)
        .eq('is_active', true)
        .maybeSingle()
      if (error || !data) redirect('/login?error=invalid')
      tenant = data as Tenant & { password_hash: string | null }
      const ok = await verifyPassword(password, tenant.password_hash)
      if (!ok) redirect('/login?error=invalid')
    }

    if (!tenant) redirect('/login?error=invalid')

    await setSessionCookie(tenant.slug, memberId)
    await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)

    // Send them to their subdomain dashboard (or the `next` URL they originally wanted).
    // Only allow `next` if it's an https URL on our root domain (open-redirect guard).
    const fallback = `https://${tenant.slug}.${ROOT_DOMAIN}/dashboard`
    let dest = fallback
    if (nextParam) {
      try {
        const u = new URL(nextParam)
        const hostOk =
          u.protocol === 'https:' &&
          (u.hostname === ROOT_DOMAIN || u.hostname.endsWith(`.${ROOT_DOMAIN}`))
        if (hostOk) dest = u.toString()
      } catch {
        // fall through to fallback
      }
    }
    redirect(dest)
  }

  return (
    <main className="wrap" style={{ maxWidth: 440 }}>
      <header className="hero">
        <h1 style={{ fontSize: '1.8rem' }}>Client sign in</h1>
        <p className="sub">Log in to be taken to your private workspace.</p>
      </header>

      <section className="card">
        {errorCode === 'invalid' && (
          <p className="meta" style={{ color: '#fcb293', marginBottom: '0.7rem' }}>
            Email or password was incorrect.
          </p>
        )}
        {errorCode === 'missing' && (
          <p className="meta" style={{ color: '#fcb293', marginBottom: '0.7rem' }}>
            Please fill in both fields.
          </p>
        )}
        <form action={login} style={{ display: 'grid', gap: '0.6rem' }}>
          <input name="next" type="hidden" defaultValue={nextUrl ?? ''} />
          <label style={lblStyle}>
            <span>Email</span>
            <input name="email" type="email" required autoFocus style={inputStyle} />
          </label>
          <label style={lblStyle}>
            <span>Password</span>
            <PasswordField />
          </label>
          <button type="submit" className="btn approve" style={{ marginTop: '0.3rem' }}>
            Sign in
          </button>
        </form>
        <p className="meta" style={{ marginTop: '0.9rem' }}>
          Don&apos;t have access yet? <Link href="/offer" style={{ color: 'var(--gold)' }}>See the offer →</Link>
        </p>
      </section>
    </main>
  )
}

const lblStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  fontSize: '0.78rem',
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
  padding: '0.65rem',
  borderRadius: 10,
  border: '1px solid var(--ink-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
