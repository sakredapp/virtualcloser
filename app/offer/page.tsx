'use client'

import Link from 'next/link'
import { useState } from 'react'
import OfferTabs from '@/app/components/OfferTabs'
import QuoteCart from '@/app/components/QuoteCart'
import MobileCartDrawer, { type DrawerItem } from '@/app/components/MobileCartDrawer'
import AiSdrPricingCalculator from './AiSdrPricingCalculator'
import TryVoiceButton from '@/app/demo/TryVoiceButton'
import { renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { INDIVIDUAL_BUILD_FEE_CENTS } from '@/lib/billing/buildFee'
import type { BeginBuildPayload } from '@/app/components/BeginBuildButton'

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

const OFFER_AGREEMENT_HTML = renderAgreementHtml({ workspaceLabel: 'Live demo from /offer' })

// Virtual Closer base build — required for every individual account so the
// dialer/trainer/Jarvis stack can hand off into a working dashboard. Always
// included in the running total; matches the base_build SKU price in
// lib/addons.ts (9900 cents = $99/mo).
const BASE_BUILD_CENTS = 9900

export default function OfferPage() {
  // Lift all three calculators' monthlies so they flow into QuoteCart.
  const [sdr, setSdr] = useState({ hoursPerWeek: 10, monthlyCents: 0, pricePerHour: 6 })
  const [trainer, setTrainer] = useState({ hoursPerWeek: 10, monthlyCents: 0, pricePerHour: 6 })
  const [receptionist, setReceptionist] = useState({ hoursPerWeek: 10, monthlyCents: 0, pricePerHour: 6 })
  // Cart membership — start NOT included so the prospect explicitly opts in.
  const [sdrIncluded, setSdrIncluded] = useState(false)
  const [trainerIncluded, setTrainerIncluded] = useState(false)
  const [receptionistIncluded, setReceptionistIncluded] = useState(false)
  // Mobile bottom-sheet drawer that opens when the user taps "Review cart"
  // in the sticky bottom bar. Shows the itemized monthly + book-a-call CTA.
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false)

  const sdrCart = sdrIncluded ? sdr.monthlyCents : 0
  const trainerCart = trainerIncluded ? trainer.monthlyCents : 0
  const receptionistCart = receptionistIncluded ? receptionist.monthlyCents : 0

  // Build a label from whichever products are toggled in
  const includedLabels = [
    sdrIncluded && `AI SDR · ${sdr.hoursPerWeek}h/wk`,
    trainerIncluded && `AI Trainer · ${trainer.hoursPerWeek}h/wk`,
    receptionistIncluded && `AI Receptionist · ${receptionist.hoursPerWeek}h/wk`,
  ].filter(Boolean) as string[]
  const cartLineLabel = includedLabels.length ? includedLabels.join(' + ') : undefined
  const includedSubs = [
    sdrIncluded && `SDR $${sdr.pricePerHour.toFixed(2)}/hr`,
    trainerIncluded && `Trainer $${trainer.pricePerHour.toFixed(2)}/hr`,
    receptionistIncluded && `Receptionist $${receptionist.pricePerHour.toFixed(2)}/hr`,
  ].filter(Boolean) as string[]
  const cartLineSub = includedSubs.length ? includedSubs.join(' · ') : undefined

  return (
    <main className="wrap">
      <header className="hero">
        <p
          className="eyebrow jarvis-eyebrow"
          style={{ fontStyle: 'italic', letterSpacing: '0.14em', opacity: 0.9 }}
        >
          <span>&ldquo;Jarvis, you up?&rdquo;</span>
          <span className="jarvis-sep">&nbsp;—&nbsp;</span>
          <span>&ldquo;For you, Sir, always.&rdquo;</span>
        </p>
        <h1>Build a custom AI sales suite.</h1>
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
      <div className="hero-stack" style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem', marginTop: '2rem' }}>
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

        <AiSdrPricingCalculator
          mode="individual"
          product="receptionist"
          defaultHoursPerWeek={10}
          micSlot={
            <TryVoiceButton
              tier="individual"
              product="receptionist"
              variant="circular"
              agreementHtml={OFFER_AGREEMENT_HTML}
            />
          }
          onChange={(r) =>
            setReceptionist({ hoursPerWeek: r.hoursPerWeek, monthlyCents: r.monthlyCents, pricePerHour: r.pricePerHour })
          }
          included={receptionistIncluded}
          onToggleIncluded={() => setReceptionistIncluded((v) => !v)}
        />
      </div>

      <section id="cart" style={{ marginTop: '3rem', scrollMarginTop: '1rem' }}>
        <QuoteCart
          syncQueryString
          extraMonthlyCents={sdrCart + trainerCart + receptionistCart}
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

      {/* Mobile sticky cart bar — total + Cart pill (opens drawer) +
          Book Call pill (Cal.com). Identical layout to /offer/enterprise.
          Below 860px only — desktop uses QuoteCart's right-hand sticky
          aside instead. */}
      <div className="mobile-cart-bar" role="region" aria-label="Cart summary">
        <div className="mcb-total">
          <span className="mcb-label">Monthly · + ${(INDIVIDUAL_BUILD_FEE_CENTS / 100).toLocaleString('en-US')} build</span>
          <span className="mcb-amount">
            ${((BASE_BUILD_CENTS + sdrCart + trainerCart + receptionistCart) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            <span className="mcb-amount-mo">/mo</span>
          </span>
        </div>
        <div className="mcb-actions">
          <button type="button" className="mcb-btn mcb-btn-secondary" onClick={() => setCartDrawerOpen(true)}>
            Cart
          </button>
          <Link href={CAL_BOOKING_URL} className="mcb-btn mcb-btn-primary">
            Book Call
          </Link>
        </div>
      </div>

      <MobileCartDrawer
        open={cartDrawerOpen}
        onClose={() => setCartDrawerOpen(false)}
        totalCents={BASE_BUILD_CENTS + sdrCart + trainerCart + receptionistCart}
        items={(() => {
          const items: DrawerItem[] = [
            {
              label: 'Virtual Closer base build',
              sub: 'Your AI employee + dashboard',
              cents: BASE_BUILD_CENTS,
              required: true,
            },
            {
              label: `AI SDR · ${sdr.hoursPerWeek} hrs/wk`,
              sub: sdrIncluded ? 'Added to cart' : 'Not in cart — toggle on the SDR card',
              cents: sdr.monthlyCents,
              inCart: sdrIncluded,
            },
            {
              label: `AI Trainer · ${trainer.hoursPerWeek} hrs/wk`,
              sub: trainerIncluded ? 'Added to cart' : 'Not in cart — toggle on the Trainer card',
              cents: trainer.monthlyCents,
              inCart: trainerIncluded,
            },
            {
              label: `AI Receptionist · ${receptionist.hoursPerWeek} hrs/wk`,
              sub: receptionistIncluded ? `$${receptionist.pricePerHour.toFixed(2)}/hr blended` : 'Not in cart — toggle on the Receptionist card',
              cents: receptionist.monthlyCents,
              inCart: receptionistIncluded,
            },
            {
              label: 'One-time build fee',
              sub: 'Charged today — onboarding + build · weekly billing starts when build goes live',
              cents: INDIVIDUAL_BUILD_FEE_CENTS,
              required: true,
            },
          ]
          return items
        })()}
        bookHref={CAL_BOOKING_URL}
        noteHtml={'Plus any add-ons you select in the &ldquo;Available add-ons&rdquo; cart below (CRM, white-label, Fathom, etc.). Your final monthly is the sum of everything you check.'}
        buildFeeCents={INDIVIDUAL_BUILD_FEE_CENTS}
        buildPayload={(): BeginBuildPayload => ({
          tier: 'individual',
          repCount: 1,
          weeklyHours: sdrIncluded ? Math.max(10, sdr.hoursPerWeek) : 20,
          trainerWeeklyHours: trainerIncluded ? Math.max(5, trainer.hoursPerWeek) : 0,
          overflowEnabled: false,
          addons: [],
          metadata: {
            scope: 'individual',
            source: 'offer_mobile_drawer',
            sdr_included: sdrIncluded,
            trainer_included: trainerIncluded,
            receptionist_included: receptionistIncluded,
            sdr_hours_per_week: sdr.hoursPerWeek,
            trainer_hours_per_week: trainer.hoursPerWeek,
            receptionist_hours_per_week: receptionist.hoursPerWeek,
            configured_monthly_cents: BASE_BUILD_CENTS + sdrCart + trainerCart + receptionistCart,
          },
        })}
      />
    </main>
  )
}
