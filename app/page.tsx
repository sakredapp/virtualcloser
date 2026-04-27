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
        <h1>A personal Jarvis, built to increase revenue.</h1>
        <p className="sub">
          Virtual Closer is the AI employee you wish you could hire — quiet, tireless,
          obsessed with your numbers. It runs the work humans keep dropping, so your
          business hums along as smooth as the supercar in your driveway (or the one in your dreams). One hire,
          trained on your voice, working while you sleep. No SOPs. No turnover. Just a
          well-oiled machine that compounds every day.
        </p>
        <p
          className="sub"
          style={{
            marginTop: '0.8rem',
            fontSize: '0.95rem',
            fontStyle: 'italic',
            opacity: 0.92,
          }}
        >
          How it works: simply send voice notes or text to Jarvis in Telegram, and let it
          update your dashboard daily.
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
              style={{ textDecoration: 'none' }}
            >
              Open client portal
            </Link>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>What an AI employee actually does</h2>
          </div>
          <p className="meta">
            We&apos;re not selling seats in a generic AI employee platform. We build
            <em> your</em> AI hire — your voice, your CRM, your inbox, your calendar,
            your playbook. See what the role covers, compare the three tiers, and walk
            through a live dashboard before you commit.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
            <Link
              href="https://cal.com/virtualcloser/30min"
              className="btn approve"
              style={{ textDecoration: 'none' }}
            >
              Book a call
            </Link>
            <Link
              href="/offer"
              className="btn dismiss"
              style={{ textDecoration: 'none' }}
            >
              View pricing
            </Link>
            <Link href="/demo" className="btn dismiss" style={{ textDecoration: 'none' }}>
              Individual demo
            </Link>
            <Link href="/demo/enterprise" className="btn dismiss" style={{ textDecoration: 'none' }}>
              Enterprise demo
            </Link>
          </div>
        </article>
      </section>

      <footer style={{ color: 'var(--muted-inv)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        © Virtual Closer
        {' · '}
        <Link href="/privacy" style={{ color: 'inherit' }}>Privacy</Link>
        {' · '}
        <Link href="/terms" style={{ color: 'inherit' }}>Terms</Link>
        {' · '}
        <a href="mailto:hello@virtualcloser.com" style={{ color: 'inherit' }}>hello@virtualcloser.com</a>
      </footer>
    </main>
  )
}
