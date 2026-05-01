'use client'

import Link from 'next/link'
import { useState } from 'react'
import OfferTabs from '@/app/components/OfferTabs'
import QuoteCart from '@/app/components/QuoteCart'
import MobileCartDrawer, { type DrawerItem } from '@/app/components/MobileCartDrawer'
import AiSdrPricingCalculator from './AiSdrPricingCalculator'
import TryVoiceButton from '@/app/demo/TryVoiceButton'
import { renderAgreementHtml } from '@/lib/liabilityAgreementCopy'

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

const OFFER_AGREEMENT_HTML = renderAgreementHtml({ workspaceLabel: 'Live demo from /offer' })

// Virtual Closer base build — required for every individual account so the
// dialer/trainer/Jarvis stack can hand off into a working dashboard. Always
// included in the running total; matches the base_build SKU price in
// lib/addons.ts (9900 cents = $99/mo).
const BASE_BUILD_CENTS = 9900

export default function OfferPage() {
  // Lift both calculators' monthlies so they flow into the QuoteCart's
  // "Build your quote" total + line items below.
  const [sdr, setSdr] = useState({ hoursPerWeek: 10, monthlyCents: 0, pricePerHour: 6 })
  const [trainer, setTrainer] = useState({ hoursPerWeek: 10, monthlyCents: 0, pricePerHour: 6 })
  // Cart membership — start NOT included so the prospect explicitly opts in.
  const [sdrIncluded, setSdrIncluded] = useState(false)
  const [trainerIncluded, setTrainerIncluded] = useState(false)
  // Mobile bottom-sheet drawer that opens when the user taps "Review cart"
  // in the sticky bottom bar. Shows the itemized monthly + book-a-call CTA.
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false)

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
        <h1>Build A Custom AI Sales Suite</h1>
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

      {/* Mobile sticky cart bar — only renders below 860px (CSS handles
          the show/hide). Replaces the desktop sticky aside, which is
          hidden at the same breakpoint via globals.css. */}
      <div className="mobile-cart-bar" role="region" aria-label="Cart summary">
        <div className="mcb-total">
          <span className="mcb-label">Your monthly</span>
          <span className="mcb-amount">
            ${((BASE_BUILD_CENTS + sdrCart + trainerCart) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            <span className="mcb-amount-mo">/mo</span>
          </span>
        </div>
        <button type="button" className="mcb-btn" onClick={() => setCartDrawerOpen(true)}>
          Review cart
        </button>
      </div>

      {/* Mobile bottom-sheet drawer — slides up when "Review cart" is
          tapped. Shows itemized total + book-a-call CTA. Tap backdrop
          or close button to dismiss. */}
      <MobileCartDrawer
        open={cartDrawerOpen}
        onClose={() => setCartDrawerOpen(false)}
        baseCents={BASE_BUILD_CENTS}
        sdrIncluded={sdrIncluded}
        sdrCents={sdr.monthlyCents}
        sdrHoursPerWeek={sdr.hoursPerWeek}
        trainerIncluded={trainerIncluded}
        trainerCents={trainer.monthlyCents}
        trainerHoursPerWeek={trainer.hoursPerWeek}
      />
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

// ── Mobile cart drawer ────────────────────────────────────────────────
// Bottom-sheet that slides up when the user taps "Review cart" in the
// mobile sticky bar. Itemized total + book-a-call CTA. Backdrop click
// + close button + Escape key all dismiss it.
function MobileCartDrawer({
  open,
  onClose,
  baseCents,
  sdrIncluded,
  sdrCents,
  sdrHoursPerWeek,
  trainerIncluded,
  trainerCents,
  trainerHoursPerWeek,
}: {
  open: boolean
  onClose: () => void
  baseCents: number
  sdrIncluded: boolean
  sdrCents: number
  sdrHoursPerWeek: number
  trainerIncluded: boolean
  trainerCents: number
  trainerHoursPerWeek: number
}) {
  // Close on Escape so keyboard users (and detached BT keyboards) can dismiss.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Lock body scroll while the drawer is up so the backdrop swipe
    // doesn't bleed through to the page underneath.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const sdrCart = sdrIncluded ? sdrCents : 0
  const trainerCart = trainerIncluded ? trainerCents : 0
  const total = baseCents + sdrCart + trainerCart
  const fmt = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  const calBookingUrl =
    process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'
  const bookHref = (() => {
    try {
      const url = new URL(calBookingUrl)
      url.searchParams.set('metadata[mode]', 'individual')
      url.searchParams.set('metadata[mrr_cents]', String(total))
      const lines: string[] = ['Virtual Closer build request', '']
      lines.push(`Monthly: ${fmt(total)}/mo`)
      lines.push('')
      lines.push('Cart:')
      lines.push(`  • Virtual Closer base build — ${fmt(baseCents)}/mo`)
      if (sdrIncluded) lines.push(`  • AI SDR — ${sdrHoursPerWeek} hrs/wk — ${fmt(sdrCents)}/mo`)
      if (trainerIncluded) lines.push(`  • AI Trainer — ${trainerHoursPerWeek} hrs/wk — ${fmt(trainerCents)}/mo`)
      url.searchParams.set('notes', lines.join('\n'))
      return url.toString()
    } catch {
      return calBookingUrl
    }
  })()

  return (
    <>
      <div
        className={`mcd-backdrop ${open ? 'mcd-open' : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`mcd-sheet ${open ? 'mcd-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Cart summary"
        aria-hidden={!open}
      >
        <div className="mcd-handle" aria-hidden />
        <div className="mcd-head">
          <div>
            <p className="mcd-kicker">Your monthly</p>
            <p className="mcd-total">
              {fmt(total)}<span className="mcd-mo">/mo</span>
            </p>
          </div>
          <button type="button" className="mcd-close" onClick={onClose} aria-label="Close cart">
            ×
          </button>
        </div>

        <ul className="mcd-list">
          <li className="mcd-item">
            <div>
              <span className="mcd-item-label">Virtual Closer base build</span>
              <span className="mcd-item-sub">Required · your AI employee + dashboard</span>
            </div>
            <strong>{fmt(baseCents)}</strong>
          </li>
          <li className={`mcd-item ${sdrIncluded ? '' : 'mcd-item-out'}`}>
            <div>
              <span className="mcd-item-label">AI SDR · {sdrHoursPerWeek} hrs/wk</span>
              <span className="mcd-item-sub">
                {sdrIncluded ? 'Added to cart' : 'Not in cart — toggle on the SDR card'}
              </span>
            </div>
            <strong>{sdrIncluded ? fmt(sdrCart) : '—'}</strong>
          </li>
          <li className={`mcd-item ${trainerIncluded ? '' : 'mcd-item-out'}`}>
            <div>
              <span className="mcd-item-label">AI Trainer · {trainerHoursPerWeek} hrs/wk</span>
              <span className="mcd-item-sub">
                {trainerIncluded ? 'Added to cart' : 'Not in cart — toggle on the Trainer card'}
              </span>
            </div>
            <strong>{trainerIncluded ? fmt(trainerCart) : '—'}</strong>
          </li>
        </ul>

        <p className="mcd-note">
          Plus any add-ons you select in the &ldquo;Available add-ons&rdquo; cart below
          (CRM, white-label, Fathom, etc.). Your final monthly is the sum
          of everything you check.
        </p>


        <div className="mcd-actions">
          <Link href={bookHref} target="_blank" rel="noopener noreferrer" className="mcd-book">
            View cart &amp; book a call
          </Link>
          <button type="button" onClick={onClose} className="mcd-continue">
            Keep building
          </button>
        </div>
      </div>
    </>
  )
}
