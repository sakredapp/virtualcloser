'use client'

import Link from 'next/link'
import OfferTabs from '@/app/components/OfferTabs'
import QuoteCart from '@/app/components/QuoteCart'

export default function OfferPage() {
  return (
    <main className="wrap">
      <header className="hero">
        <p
          className="eyebrow"
          style={{ fontStyle: 'italic', letterSpacing: '0.14em', opacity: 0.9 }}
        >
          &ldquo;Jarvis, you up?&rdquo; &nbsp;—&nbsp; &ldquo;For you, Sir, always.&rdquo;
        </p>
        <h1>Build the AI employee that runs your day.</h1>
        <p className="sub">
          Every Virtual Closer is a custom build. Pick the base, add the pieces you need —
          CRM integration, AI dialer, roleplay practice, KPI ingest. We quote the one-time
          build fee on the call. The monthly is what you see right here.
        </p>
      </header>

      <OfferTabs side="individual" view="pricing" />

      <QuoteCart syncQueryString />

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse" open>
          <summary>How it works</summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            <li className="row">
              <div>
                <p className="name">1. Kickoff call</p>
                <p className="meta">
                  We learn your ICP, your voice, your objections, your CRM. Build fee quoted on
                  this call.
                </p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">2. Build week</p>
                <p className="meta">
                  We spin up your sub-domain, import your leads, wire your add-ons, tune the
                  playbook.
                </p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">3. Go live</p>
                <p className="meta">
                  You start approving drafts on day one. Caps activate on the start date so
                  nothing surprises you.
                </p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">4. Monthly care</p>
                <p className="meta">
                  We watch it, improve it, and keep it profitable. You just close.
                </p>
              </div>
            </li>
          </ul>
        </details>
      </section>

      <footer
        style={{
          color: 'var(--muted-inv)',
          textAlign: 'center',
          marginTop: '1.2rem',
          fontSize: '0.85rem',
        }}
      >
        © Virtual Closer · An AI assistant that pays for itself.
        {' · '}
        <Link href="/privacy" style={{ color: 'inherit' }}>
          Privacy
        </Link>
        {' · '}
        <Link href="/terms" style={{ color: 'inherit' }}>
          Terms
        </Link>
      </footer>
    </main>
  )
}
