'use client'

import Link from 'next/link'
import { useState } from 'react'
import QuoteCart from '@/app/components/QuoteCart'
import type { AddonKey } from '@/lib/addons'

type OfferTab = 'individual' | 'enterprise'

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

function bookingHref(opts: {
  cart: AddonKey[]
  mrrCents: number
  mode: 'individual' | 'enterprise'
}): string {
  try {
    const url = new URL(CAL_BOOKING_URL)
    url.searchParams.set('metadata[mode]', opts.mode)
    url.searchParams.set('metadata[cart]', opts.cart.join(','))
    url.searchParams.set('metadata[mrr_cents]', String(opts.mrrCents))
    return url.toString()
  } catch {
    return CAL_BOOKING_URL
  }
}

export default function OfferPage() {
  const [tab, setTab] = useState<OfferTab>('individual')

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

      {/* ── Individual vs Enterprise toggle ───────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem', marginBottom: '0.6rem' }}>
        <p className="meta" style={{ margin: 0, marginBottom: '0.6rem' }}>
          One operator vs. a whole sales org. Different products, different pricing.
        </p>
        <div
          role="tablist"
          aria-label="Offer view"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            padding: 4,
            background: 'var(--paper-2, #f7f4ef)',
            border: '1.5px solid var(--ink)',
            borderRadius: 12,
          }}
        >
          {(
            [
              {
                key: 'individual',
                label: 'Individual quote',
                sub: 'Solo operator · self-serve cart',
              },
              {
                key: 'enterprise',
                label: 'Enterprise inquiry',
                sub: 'Whole sales org · custom quote',
              },
            ] as const
          ).map((opt) => {
            const active = tab === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(opt.key)}
                style={{
                  cursor: 'pointer',
                  border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--ink)'),
                  background: active ? 'var(--red)' : 'var(--paper)',
                  color: active ? '#ffffff' : 'var(--ink)',
                  borderRadius: 9,
                  padding: '0.75rem 0.95rem',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  boxShadow: active ? '0 4px 12px rgba(255, 40, 0, 0.22)' : 'none',
                  transition:
                    'background 120ms ease, border-color 120ms ease, color 120ms ease',
                }}
              >
                <div>{opt.label}</div>
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    color: active ? 'rgba(255,255,255,0.85)' : 'var(--muted)',
                    marginTop: 2,
                  }}
                >
                  {opt.sub}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {tab === 'individual' && <QuoteCart syncQueryString />}
      {tab === 'enterprise' && <EnterprisePanel />}

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

// ────────────────────────────────────────────────────────────────────
// EnterprisePanel — short pitch + custom-quote CTA
// ────────────────────────────────────────────────────────────────────

function EnterprisePanel() {
  return (
    <section className="card" style={{ marginTop: '0.8rem' }}>
      <p
        className="eyebrow"
        style={{
          marginTop: 0,
          marginBottom: '0.6rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontSize: '0.78rem',
          color: 'var(--red)',
          fontWeight: 700,
        }}
      >
        Enterprise &mdash; the AI employee for a whole sales org
      </p>
      <h2 style={{ margin: 0 }}>Multi-rep, manager rollups, private rooms.</h2>
      <p className="meta" style={{ marginTop: '0.5rem' }}>
        A different product class from the individual quote. Owners, managers, and reps each
        get their own seat with role-scoped visibility &mdash; reps never see other reps&rsquo;
        data, managers see their team&rsquo;s rollup, owners see everything. Conversations sync
        1:1 across the org without anyone reading a group chat.
      </p>

      <div
        style={{
          marginTop: '1rem',
          padding: '1rem 1.05rem',
          border: '1.5px solid var(--ink)',
          borderRadius: 12,
          background: 'var(--paper-alt, #f7f4ef)',
        }}
      >
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)' }}>
          Custom quote · bulk seat pricing
        </div>
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Priced per engagement. The more reps, the lower the per-seat cost. Build fee depends
          on integration scope &mdash; covered in the kickoff call.
        </p>
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Link
          className="btn approve"
          href={bookingHref({ cart: [], mrrCents: 0, mode: 'enterprise' })}
          style={{ textDecoration: 'none' }}
        >
          Talk to us about Enterprise
        </Link>
        <Link
          href="/demo/enterprise"
          style={{
            textDecoration: 'none',
            display: 'inline-block',
            padding: '0.65rem 0.95rem',
            border: '1.5px solid var(--ink)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.9rem',
          }}
        >
          See the Enterprise demo
        </Link>
      </div>
    </section>
  )
}
