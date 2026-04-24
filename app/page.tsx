import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''

  // On a tenant subdomain, `/` sends the authenticated client to their dashboard.
  // (Middleware will have already bounced unauthenticated users to /login.)
  if (!isGatewayHost(host)) {
    redirect('/dashboard')
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Virtual Closer</p>
        <h1>An AI sales assistant that actually closes loops.</h1>
        <p className="sub">
          Hosted. Managed. On your own brand. Built so follow-up happens automatically —
          and dormant deals come back to life.
        </p>
        <p className="nav">
          <Link href="/login">Client sign in →</Link>
          <span>·</span>
          <Link href="/offer">See the offer</Link>
          <span>·</span>
          <Link href="/demo">Live demo</Link>
        </p>
      </header>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>For clients</h2>
          </div>
          <p className="meta">
            You already have a workspace. Sign in and we&apos;ll send you to your private
            subdomain dashboard.
          </p>
          <div style={{ marginTop: '0.8rem' }}>
            <Link
              href="/login"
              className="btn approve"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              Sign in
            </Link>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>For prospects</h2>
          </div>
          <p className="meta">
            See what you&apos;re getting. Compare the three tiers and look at a real demo
            dashboard before you buy.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <Link
              href="/offer"
              className="btn approve"
              style={{ textDecoration: 'none' }}
            >
              View pricing
            </Link>
            <Link href="/demo" className="btn dismiss" style={{ textDecoration: 'none' }}>
              Live demo
            </Link>
          </div>
        </article>
      </section>
    </main>
  )
}
