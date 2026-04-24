import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { setSessionCookie } from '@/lib/client-auth'
import { verifyPassword } from '@/lib/client-password'
import type { Tenant } from '@/lib/tenant'

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

    const { data, error } = await supabase
      .from('reps')
      .select('*')
      .ilike('email', email)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !data) redirect('/login?error=invalid')
    const tenant = data as Tenant & { password_hash: string | null }

    const ok = await verifyPassword(password, tenant.password_hash)
    if (!ok) redirect('/login?error=invalid')

    await setSessionCookie(tenant.slug)
    await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)

    // Send them to their subdomain dashboard (or the `next` URL they originally wanted).
    const dest = nextParam && nextParam.startsWith('http') ? nextParam : `https://${tenant.slug}.${ROOT_DOMAIN}/dashboard`
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
            <input name="password" type="password" required style={inputStyle} />
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
