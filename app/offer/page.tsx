'use client'

import Link from 'next/link'
import { useState } from 'react'
import OfferTabs from '@/app/components/OfferTabs'
import QuoteCart from '@/app/components/QuoteCart'
import AiSdrPricingCalculator from './AiSdrPricingCalculator'
import TryVoiceButton from '@/app/demo/TryVoiceButton'
import { renderAgreementHtml } from '@/lib/liabilityAgreementCopy'

const OFFER_AGREEMENT_HTML = renderAgreementHtml({ workspaceLabel: 'Live demo from /offer' })

export default function OfferPage() {
  // Lift both calculators' monthlies so they flow into the QuoteCart's
  // "Build your quote" total + line items below.
  const [sdr, setSdr] = useState({ hoursPerWeek: 40, monthlyCents: 0, pricePerHour: 6 })
  const [trainer, setTrainer] = useState({ hoursPerWeek: 10, monthlyCents: 0, pricePerHour: 6 })

  return (
    <main className="wrap">
      <header className="hero">
        <p
          className="eyebrow"
          style={{ fontStyle: 'italic', letterSpacing: '0.14em', opacity: 0.9 }}
        >
          &ldquo;Jarvis, you up?&rdquo; &nbsp;—&nbsp; &ldquo;For you, Sir, always.&rdquo;
        </p>
        <h1>Hire your AI SDR + AI Trainer.</h1>
        <p className="sub">
          No sick days. No complaining. No bonuses. Just hard workers — your
          AI SDR dials your leads and books meetings, your AI Trainer runs
          live roleplay between calls. Pick the hours, hit the mic to hear
          either one in action, then add a base build and extras. Monthly
          stays right under your nose.
        </p>
      </header>

      <OfferTabs side="individual" view="pricing" />

      {/* AI SDR pricing — the hero. Drives the cart total below. */}
      <section style={{ marginTop: '1.4rem' }}>
        <AiSdrPricingCalculator
          mode="individual"
          product="sdr"
          micSlot={
            <TryVoiceButton
              tier="individual"
              product="sdr"
              variant="circular"
              agreementHtml={OFFER_AGREEMENT_HTML}
              circularCaption="Hear your AI SDR pitch your product live. ~2 min preview, no signup."
            />
          }
          onChange={(s) =>
            setSdr({ hoursPerWeek: s.hoursPerWeek, monthlyCents: s.monthlyCents, pricePerHour: s.pricePerHour })
          }
        />
      </section>

      {/* AI Trainer pricing — second hero. Same look, different product. */}
      <section style={{ marginTop: '1rem' }}>
        <AiSdrPricingCalculator
          mode="individual"
          product="trainer"
          defaultHoursPerWeek={10}
          micSlot={
            <TryVoiceButton
              tier="individual"
              product="trainer"
              variant="circular"
              agreementHtml={OFFER_AGREEMENT_HTML}
              circularCaption="Roleplay a discovery call right now. The trainer throws an objection, you respond, you get scored."
            />
          }
          onChange={(t) =>
            setTrainer({ hoursPerWeek: t.hoursPerWeek, monthlyCents: t.monthlyCents, pricePerHour: t.pricePerHour })
          }
        />
      </section>

      <QuoteCart
        syncQueryString
        extraMonthlyCents={sdr.monthlyCents + trainer.monthlyCents}
        extraLineLabel={
          sdr.monthlyCents > 0 && trainer.monthlyCents > 0
            ? `AI SDR · ${sdr.hoursPerWeek}h/wk + AI Trainer · ${trainer.hoursPerWeek}h/wk`
            : sdr.monthlyCents > 0
              ? `AI SDR · ${sdr.hoursPerWeek} hrs/wk`
              : `AI Trainer · ${trainer.hoursPerWeek} hrs/wk`
        }
        extraLineSub={`SDR $${sdr.pricePerHour.toFixed(2)}/hr · Trainer $${trainer.pricePerHour.toFixed(2)}/hr`}
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
