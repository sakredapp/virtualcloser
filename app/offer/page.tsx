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
  // Cart membership — start NOT included so the prospect explicitly opts in.
  const [sdrIncluded, setSdrIncluded] = useState(false)
  const [trainerIncluded, setTrainerIncluded] = useState(false)

  const sdrCart = sdrIncluded ? sdr.monthlyCents : 0
  const trainerCart = trainerIncluded ? trainer.monthlyCents : 0
  const cartLineLabel =
    sdrIncluded && trainerIncluded
      ? `AI SDR · ${sdr.hoursPerWeek}h/wk + AI Trainer · ${trainer.hoursPerWeek}h/wk`
      : sdrIncluded
        ? `AI SDR · ${sdr.hoursPerWeek} hrs/wk`
        : trainerIncluded
          ? `AI Trainer · ${trainer.hoursPerWeek} hrs/wk`
          : undefined
  const cartLineSub =
    sdrIncluded && trainerIncluded
      ? `SDR $${sdr.pricePerHour.toFixed(2)}/hr · Trainer $${trainer.pricePerHour.toFixed(2)}/hr`
      : sdrIncluded
        ? `$${sdr.pricePerHour.toFixed(2)}/hr blended`
        : trainerIncluded
          ? `$${trainer.pricePerHour.toFixed(2)}/hr blended`
          : undefined

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

      {/* Calculators take the full content width — the sticky "running total"
          summary lives in <QuoteCart> below so the page only ever shows ONE
          monthly total at a time (was duplicated with a side aside). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem', marginTop: '2rem' }}>
        <AiSdrPricingCalculator
          mode="individual"
          product="sdr"
          micSlot={
            <TryVoiceButton
              tier="individual"
              product="sdr"
              variant="circular"
              agreementHtml={OFFER_AGREEMENT_HTML}
            />
          }
          onChange={(s) =>
            setSdr({ hoursPerWeek: s.hoursPerWeek, monthlyCents: s.monthlyCents, pricePerHour: s.pricePerHour })
          }
          included={sdrIncluded}
          onToggleIncluded={() => setSdrIncluded((v) => !v)}
        />

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
            />
          }
          onChange={(t) =>
            setTrainer({ hoursPerWeek: t.hoursPerWeek, monthlyCents: t.monthlyCents, pricePerHour: t.pricePerHour })
          }
          included={trainerIncluded}
          onToggleIncluded={() => setTrainerIncluded((v) => !v)}
        />
      </div>

      <section id="cart" style={{ marginTop: '3rem', scrollMarginTop: '1rem' }}>
        <QuoteCart
          syncQueryString
          extraMonthlyCents={sdrCart + trainerCart}
          extraLineLabel={cartLineLabel}
          extraLineSub={cartLineSub}
        />
      </section>

      <style jsx global>{`
        /* Collapsible calculator card — chevron rotates 180° when open */
        details.calc-details > summary::-webkit-details-marker { display: none; }
        details.calc-details > summary::marker { display: none; }
        details.calc-details[open] > summary .calc-chevron { transform: rotate(180deg); }
        details.calc-details > summary:hover .calc-chevron { opacity: 0.7; }
      `}</style>

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

function RunningTotalAside({
  sdrIncluded,
  trainerIncluded,
  sdrMonthlyCents,
  trainerMonthlyCents,
  sdrHoursPerWeek,
  trainerHoursPerWeek,
  sdrPricePerHour,
  trainerPricePerHour,
}: {
  sdrIncluded: boolean
  trainerIncluded: boolean
  sdrMonthlyCents: number
  trainerMonthlyCents: number
  sdrHoursPerWeek: number
  trainerHoursPerWeek: number
  sdrPricePerHour: number
  trainerPricePerHour: number
}) {
  const sdrCart = sdrIncluded ? sdrMonthlyCents : 0
  const trainerCart = trainerIncluded ? trainerMonthlyCents : 0
  const heroTotal = sdrCart + trainerCart
  const fmt = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <aside
      style={{
        padding: '1.05rem 1.1rem',
        borderRadius: 12,
        border: '1.5px solid var(--brand-red, var(--red, #ff2800))',
        background: 'linear-gradient(180deg, #fff 0%, #fff5f3 100%)',
        position: 'sticky',
        top: '1rem',
        alignSelf: 'start',
        boxShadow: '0 8px 30px rgba(255,40,0,0.10)',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--brand-red, var(--red, #ff2800))',
        }}
      >
        Your monthly · running total
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.25rem' }}>
        <span
          style={{
            fontSize: '2.2rem',
            fontWeight: 800,
            color: 'var(--ink, #0f172a)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          {fmt(heroTotal)}
        </span>
        <span style={{ color: 'var(--muted, #64748b)' }}>/ mo</span>
      </div>
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: 'var(--muted, #64748b)' }}>
        From the hero cards above. Add a base build + add-ons in the cart below.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0.85rem 0 0', fontSize: '0.85rem' }}>
        <CartLine
          label={`AI SDR · ${sdrHoursPerWeek} hrs/wk`}
          sub={sdrIncluded ? `$${sdrPricePerHour.toFixed(2)}/hr blended` : 'Not in cart — preview pricing'}
          cents={sdrCart}
          inactive={!sdrIncluded}
        />
        <CartLine
          label={`AI Trainer · ${trainerHoursPerWeek} hrs/wk`}
          sub={trainerIncluded ? `$${trainerPricePerHour.toFixed(2)}/hr blended` : 'Not in cart — preview pricing'}
          cents={trainerCart}
          inactive={!trainerIncluded}
        />
      </ul>

      <a
        href="#cart"
        style={{
          display: 'block',
          marginTop: '0.95rem',
          padding: '10px 14px',
          borderRadius: 8,
          background: 'var(--ink, #0f172a)',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.82rem',
          textAlign: 'center',
          textDecoration: 'none',
          letterSpacing: '0.02em',
        }}
      >
        Configure base build + add-ons ↓
      </a>

      <p style={{ margin: '0.7rem 0 0', fontSize: '0.7rem', color: 'var(--muted, #64748b)', lineHeight: 1.45 }}>
        Toggle cards above with Add to cart. The full cart below combines hero
        products + base build + every add-on you select.
      </p>
    </aside>
  )
}

function CartLine({
  label,
  sub,
  cents,
  inactive,
}: {
  label: string
  sub: string
  cents: number
  inactive?: boolean
}) {
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '0.5rem 0',
        borderBottom: '1px dashed var(--line, #e6e1d8)',
        color: inactive ? 'var(--muted, #94a3b8)' : 'var(--ink, #0f172a)',
        gap: 8,
      }}
    >
      <span style={{ flex: 1, paddingRight: 8 }}>
        {label}
        <span
          style={{
            display: 'block',
            fontSize: '0.72rem',
            color: 'var(--muted, #94a3b8)',
            marginTop: 2,
          }}
        >
          {sub}
        </span>
      </span>
      <strong style={{ opacity: inactive ? 0.5 : 1 }}>
        {cents > 0 ? `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
      </strong>
    </li>
  )
}
