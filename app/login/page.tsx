import Link from 'next/link'
import { headers } from 'next/headers'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { sessionHostsFor, setSessionCookie } from '@/lib/client-auth'
import { verifyPassword } from '@/lib/client-password'
import { findMemberByEmailGlobal, recordMemberLogin } from '@/lib/members'
import { getTenantBySlug, memberHomeHost, type Tenant } from '@/lib/tenant'
import { brandFromHost, getBrand, isAnyGatewayHost, listBrands, slugFromBrandedHost, type BrandKey } from '@/lib/brand'
import { oauthClientFor } from '@/lib/google'
import { SIGNIN_ERRORS, safeNextUrl } from '@/lib/google/signin'
import PasswordField from './PasswordField'
import { Roboto } from 'next/font/google'

// Google's sign-in button is set in Roboto Medium (their branding guidelines).
const roboto = Roboto({ weight: '500', subsets: ['latin'], display: 'swap', variable: '--font-gsi' })

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
  // → VC login chrome; suitecxo.com → CXO login chrome with charcoal/vanilla
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
      // An exec assistant chose their own password from the invite link (they
      // are never sent one), so their first sign-in goes straight in.
      const isFirstLogin = !member.last_login_at && member.role !== 'assistant'
      await recordMemberLogin(member.id)
      if (isFirstLogin) {
        // Session is signed with the canonical tenant slug and valid on the
        // member's home host (their own alias, if any) plus the org's hosts.
        const firstHome = memberHomeHost(tenant, member.home_subdomain)
        await setSessionCookie(tenant.slug, memberId, sessionHostsFor(tenant, firstHome), isEmployeeOnlyMember(member, tenant) ? 'employee' : null)
        await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)
        const firstLoginBrand = getBrand((tenant as { brand?: BrandKey }).brand)
        redirect(`https://${firstHome}.${firstLoginBrand.rootDomain}/set-password`)
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

    // Canonical slug + every host this session may use (home host first). A
    // home_subdomain that is not one of this tenant's hosts is ignored.
    const homeSub = memberHomeHost(tenant, member && memberId ? member.home_subdomain : null)
    await setSessionCookie(tenant.slug, memberId, sessionHostsFor(tenant, homeSub), member && memberId && isEmployeeOnlyMember(member, tenant) ? 'employee' : null)
    await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)

    // Send them to the dashboard on THEIR brand's root domain. A CXO tenant
    // who signed in at virtualcloser.com/login still lands on
    // <slug>.suitecxo.com/dashboard, because the brand on the rep row wins.
    const tenantBrand = getBrand((tenant as { brand?: BrandKey }).brand)
    // A member with their own subdomain (a host alias of this org) lands there.
    const fallback = `https://${homeSub}.${tenantBrand.rootDomain}/dashboard`
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

  const isCxo = brand.key === 'cxo'
  const googleHref = isCxo ? await googleSignInHref(host, nextUrl) : null
  const googleError = errorCode ? SIGNIN_ERRORS[errorCode] : undefined

  // CXO: one calm borderless card on the plain ground (styles in
  // globals.css under `.cx-login`, black/silver --cx-* tokens, light + dark).
  // Same form, fields, action and redirects as the VC branch below.
  if (isCxo) {
    return (
      <main className="cx-login">
        <section className="cx-login-card" aria-labelledby="cx-login-title">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cx-login-mark" src={brand.logo.markSmallSrc ?? brand.logo.markSrc} alt={brand.name} />
          <h1 id="cx-login-title" className="cx-login-title">
            Sign into your operations dashboard
          </h1>
          <p className="cx-login-sub">Welcome back. Enter your workspace credentials.</p>
          {errorCode === 'invalid' && (
            <p className="cx-login-error" role="alert">Email or password was incorrect.</p>
          )}
          {errorCode === 'missing' && (
            <p className="cx-login-error" role="alert">Please fill in both fields.</p>
          )}
          {googleError && (
            <p className="cx-login-error" role="alert">{googleError}</p>
          )}
          {googleHref && (
            <>
              {/* Google's own button (branding guidelines): white, #747775
                  border, Roboto Medium, the four-colour G; dark variant in CSS. */}
              <a href={googleHref} className={`cx-gsi-btn ${roboto.variable}`}>
                <GoogleG />
                <span>Sign in with Google</span>
              </a>
              <div className="cx-login-or" aria-hidden="true">
                <span>or</span>
              </div>
            </>
          )}
          <form action={login} className="cx-login-form">
            <input name="next" type="hidden" defaultValue={nextUrl ?? ''} />
            <label className="cx-login-field">
              <span>Email</span>
              <input name="email" type="email" required autoFocus className="cx-login-input" />
            </label>
            <label className="cx-login-field">
              <span>Password</span>
              <PasswordField cx />
            </label>
            <button type="submit" className="cx-login-submit">
              Sign in
            </button>
          </form>
          <p className="cx-login-links">
            <Link href="/forgot-password">Forgot password?</Link>
            <span aria-hidden="true">·</span>
            <Link href="/cxo/request-access" className="cx-login-link-strong">Request access →</Link>
          </p>
        </section>
      </main>
    )
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
        padding: '2rem 1rem',
      }}
    >
      {/* CXO keeps its dark charcoal header card with the centered mark
          because the CXO shell has no corner logo. VC does — LogoCorner
          from the root layout already brands the page — so we skip a
          second centered mark and lead with the heading instead. */}
      {isCxo && (
        <header
          style={{
            width: '100%',
            textAlign: 'center',
            background: '#2A2A2A',
            padding: '2.2rem 1.5rem 1.8rem',
            borderRadius: '14px 14px 0 0',
            display: 'grid',
            gap: '0.6rem',
            justifyItems: 'center',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logo.markSrc}
            alt={brand.name}
            style={{
              display: 'block',
              height: 'clamp(56px, 11vw, 84px)',
              width: 'auto',
              maxWidth: '75%',
              filter: 'invert(1) brightness(1.05)',
            }}
          />
        </header>
      )}

      <section
        className="card"
        style={{
          width: '100%',
          background: isCxo ? '#FAF7F0' : undefined,
          borderRadius: isCxo ? '0 0 14px 14px' : 14,
          padding: '1.8rem 1.6rem 1.6rem',
          marginTop: 0,
          boxShadow: isCxo ? undefined : '0 10px 30px rgba(0,0,0,0.08)',
        }}
      >
        <h1
          style={{
            fontSize: '1.4rem',
            margin: '0 0 0.35rem',
            fontWeight: 700,
            textAlign: 'center',
            letterSpacing: '-0.01em',
            color: isCxo ? '#2A2A2A' : undefined,
          }}
        >
          {isCxo ? 'Sign into your operations dashboard' : 'Sign in to VirtualCloser'}
        </h1>
        <p
          className="meta"
          style={{
            margin: '0 0 1.3rem',
            textAlign: 'center',
            fontSize: '0.85rem',
            color: 'var(--muted)',
          }}
        >
          Welcome back — enter your workspace credentials.
        </p>
        {errorCode === 'invalid' && (
          <p className="meta" style={{ color: 'var(--danger-fg, #b00020)', marginBottom: '0.7rem', textAlign: 'center' }}>
            Email or password was incorrect.
          </p>
        )}
        {errorCode === 'missing' && (
          <p className="meta" style={{ color: 'var(--danger-fg, #b00020)', marginBottom: '0.7rem', textAlign: 'center' }}>
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
        <p className="meta" style={{ marginTop: '0.9rem', textAlign: 'center' }}>
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

/**
 * The Sign in with Google link, or null. Shown only when the company this
 * login is for saved its OWN Google client (Pinnacle today): the company is
 * the host (mike.suitecxo.com/login) or, on the apex, the host in `next`
 * (where the sign-in bounce came from). Plain suitecxo.com/login names no
 * company, so it has no button.
 */
async function googleSignInHref(host: string | null, nextUrl: string | undefined): Promise<string | null> {
  try {
    const roots = listBrands().map((b) => b.rootDomain)
    const cleanHost = String(host ?? '').split(':')[0].toLowerCase()
    const next = safeNextUrl(nextUrl, roots)
    const slug = slugFromBrandedHost(cleanHost) ?? (next ? slugFromBrandedHost(new URL(next).hostname) : null)
    if (!slug || slug === 'www') return null
    const tenant = await getTenantBySlug(slug)
    if (!tenant) return null
    const client = await oauthClientFor(tenant.id)
    if (client?.source !== 'tenant') return null
    const q = new URLSearchParams({ t: slug, from: cleanHost })
    if (next) q.set('next', next)
    // Started on the apex so the nonce cookie reaches the callback there.
    const root = brandFromHost(cleanHost).rootDomain
    return isAnyGatewayHost(cleanHost) ? `/api/google/signin?${q}` : `https://${root}/api/google/signin?${q}`
  } catch {
    return null
  }
}

/** Google's four-colour G, exactly as their branding kit draws it. */
function GoogleG() {
  return (
    <svg className="cx-gsi-g" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
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
