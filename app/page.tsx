import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost } from '@/lib/tenant'
import { Logo } from './components/Logo'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '0.8rem' }}>
          <Logo size={64} />
          <p className="eyebrow" style={{ margin: 0 }}>Virtual Closer</p>
        </div>
        <h1>An AI sales assistant that actually closes loops.</h1>
        <p className="sub">
          Hosted. Managed. On your own brand. Built so follow-up happens automatically —
          and dormant deals come back to life.
        </p>
        <p className="nav">
          <Link href="/login">Client portal →</Link>
          <span>·</span>
          <Link href="/offer">See the offer</Link>
          <span>·</span>
          <Link href="/demo">Live demo</Link>
        </p>
      </header>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>Already a client?</h2>
          </div>
          <p className="meta">
            Jump straight into your private workspace. We&apos;ll send you to your
            subdomain dashboard.
          </p>
          <div style={{ marginTop: '0.8rem' }}>
            <Link
              href="/login"
              className="btn approve"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              Open client portal
            </Link>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Explore how we can help</h2>
          </div>
          <p className="meta">
            See what&apos;s included, compare the three tiers, and walk through a real
            demo dashboard before you commit.
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
