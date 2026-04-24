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
        <h1>Your AI employee. Not another CRM.</h1>
        <p className="sub">
          Virtual Closer replaces the virtual assistant, the executive assistant, and the
          junior ops hire you keep telling yourself you&apos;ll get around to. It does the
          work — follow-ups, scheduling, note-taking, pipeline hygiene, daily prep — so
          you don&apos;t need a tool <em>and</em> a person to run it. One AI hire, trained
          on your voice, on your stack, working 24/7. No SOPs to write. No timezone
          excuses. No turnover.
        </p>
        <p className="nav">
          <Link href="/login">Client portal →</Link>
          <span>·</span>
          <Link href="/offer">See the offer</Link>
          <span>·</span>
          <Link href="https://cal.com/virtualcloser/30min">Book a call</Link>
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
              style={{ textDecoration: 'none' }}
            >
              Open client portal
            </Link>
          </div>
        </article>

        <articleWhat an AI employee actually does</h2>
          </div>
          <p className="meta">
            We&apos;re not selling seats in a generic AI employee platform. We build
            <em> your</em> AI hire — your voice, your CRM, your inbox, your calendar,
            your playbook. See what the role covers, compare the three tiers, and walk
            through a livessName="meta">
            See what&apos;s included, compare the three tiers, and walk through a real
            demo dashboard before you commit.
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
              Live demo
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
