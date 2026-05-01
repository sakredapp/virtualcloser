'use client'

import Link from 'next/link'
import { useState } from 'react'
import OfferTabs from '@/app/components/OfferTabs'
import QuoteCart from '@/app/components/QuoteCart'
import AiSdrPricingCalculator from './AiSdrPricingCalculator'

export default function OfferPage() {
  // Lift the SDR calculator's monthly so it flows into the QuoteCart's
  // "Build your quote" total + line item below.
  const [sdr, setSdr] = useState({ hoursPerWeek: 40, monthlyCents: 0, pricePerHour: 6 })

  return (
    <main className="wrap">
      <header className="hero">
        <p
          className="eyebrow"
          style={{ fontStyle: 'italic', letterSpacing: '0.14em', opacity: 0.9 }}
        >
          &ldquo;Jarvis, you up?&rdquo; &nbsp;—&nbsp; &ldquo;For you, Sir, always.&rdquo;
        </p>
        <h1>Hire your AI SDR.</h1>
        <p className="sub">
          No sick days. No complaining. No bonuses. Just a hard worker — your
          AI SDR clocks in for the hours you set, dials your leads, and books
          the meetings. Pick your shift below, then add a base build and any
          extras you want. Monthly stays right under your nose.
        </p>
      </header>

      <OfferTabs side="individual" view="pricing" />

      {/* AI SDR pricing — the hero. Drives the cart total below. */}
      <section style={{ marginTop: '1.4rem' }}>
        <AiSdrPricingCalculator
          mode="individual"
          onChange={(s) =>
            setSdr({ hoursPerWeek: s.hoursPerWeek, monthlyCents: s.monthlyCents, pricePerHour: s.pricePerHour })
          }
        />
      </section>

      <QuoteCart
        syncQueryString
        extraMonthlyCents={sdr.monthlyCents}
        extraLineLabel={`AI SDR · ${sdr.hoursPerWeek} hrs/wk`}
        extraLineSub={`$${sdr.pricePerHour.toFixed(2)}/hr · no sick days, no complaining, no bonuses`}
      />

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
