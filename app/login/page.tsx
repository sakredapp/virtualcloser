import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { setSessionCookie } from '@/lib/client-auth'
import { verifyPassword } from '@/lib/client-password'
import { findMemberByEmailGlobal, recordMemberLogin } from '@/lib/members'
import type { Tenant } from '@/lib/tenant'
import { brandFromHost, getBrand, listBrands, type BrandKey } from '@/lib/brand'
import PasswordField from './PasswordField'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
const ALLOWED_LOGIN_DOMAINS = listBrands().map((b) => b.rootDomain)

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; next?: string }>
}) {
  const params = (await searchParams) ?? {}
  const errorCode = params.error
  const nextUrl = params.next

  // Brand resolved from the host the user is signing in on. virtualcloser.com
  // → VC login chrome; suitecxo.com → CXO login chrome with espresso/ivory
  // tokens and the CXO wordmark. Both forms post to the same `login()`
  // server action; the destination dashboard is picked from the tenant's
  // brand column, not the host that served the form.
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  const brand = brandFromHost(host)

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
      const isFirstLogin = !member.last_login_at
      await recordMemberLogin(member.id)
      if (isFirstLogin) {
        await setSessionCookie(tenant.slug, memberId)
        await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)
        const firstLoginBrand = getBrand((tenant as { brand?: BrandKey }).brand)
        redirect(`https://${tenant.slug}.${firstLoginBrand.rootDomain}/set-password`)
      }
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

    // Send them to the dashboard on THEIR brand's root domain. A CXO tenant
    // who signed in at virtualcloser.com/login still lands on
    // <slug>.suitecxo.com/dashboard, because the brand on the rep row wins.
    const tenantBrand = getBrand((tenant as { brand?: BrandKey }).brand)
    const fallback = `https://${tenant.slug}.${tenantBrand.rootDomain}/dashboard`
    let dest = fallback
    if (nextParam) {
      try {
        const u = new URL(nextParam)
        // Open-redirect guard: allow `next` only on a registered brand root.
        const hostOk =
          u.protocol === 'https:' &&
          ALLOWED_LOGIN_DOMAINS.some(
            (root) => u.hostname === root || u.hostname.endsWith(`.${root}`),
          )
        if (hostOk) dest = u.toString()
      } catch {
        // fall through to fallback
      }
    }
    redirect(dest)
  }

  return (
    <main
      className="wrap login-page-wrap"
      style={{
        maxWidth: 440,
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'stretch',
        margin: '0 auto',
      }}
    >
      <header className="hero" style={{ width: '100%', textAlign: 'center', display: 'grid', gap: '0.8rem', justifyItems: 'center' }}>
        {/* Brand wordmark — VC oval logo or CXO wordmark depending on host */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logo.markSrc}
          alt={brand.name}
          style={{
            display: 'block',
            height: 'clamp(72px, 14vw, 108px)',
            width: 'auto',
            maxWidth: '70%',
          }}
        />
        <h1 style={{ fontSize: '1.7rem', margin: '0.2rem 0 0' }}>
          Sign in to {brand.name}
        </h1>
        <p className="sub" style={{ margin: 0 }}>
          Log in to be taken to your private workspace.
        </p>
      </header>

      <section className="card" style={{ width: '100%' }}>
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
          <Link href="/forgot-password" style={{ color: 'var(--muted)' }}>Forgot password?</Link>
          {' · '}
          {brand.key === 'virtualcloser' ? (
            <Link href="/offer" style={{ color: 'var(--gold)' }}>See the offer →</Link>
          ) : (
            <Link href="/demo" style={{ color: 'var(--accent)' }}>Request access →</Link>
          )}
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
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
