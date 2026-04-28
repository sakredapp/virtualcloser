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
