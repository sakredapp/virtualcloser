import Link from 'next/link'

export const dynamic = 'force-dynamic'

// CXO Suite is a separate brand from Virtual Closer — see lib/brand.ts.
// Middleware rewrites `/` on suitecxo.com to this route, so this is the
// public landing page that executives see before signing in.
//
// Palette is hard-coded (not from CSS vars) because we want this page to
// feel locked to the CXO identity regardless of any future global theming
// changes.
const ESPRESSO = '#3B2C23'
const ALMOND = '#AA8C6B'
const SAND = '#B7A38B'
const BEIGE = '#DDD1C3'
const IVORY = '#F4EDE1'
const INK_MUTED = '#5a463a'

export default function CxoMarketingPage() {
  return (
    <main
      style={{
        background: IVORY,
        color: ESPRESSO,
        minHeight: 'calc(100vh - 2rem)',
        padding: '4rem 1rem 6rem',
        fontFamily: '"IBM Plex Sans", "Inter", "Avenir Next", system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <header
          style={{
            display: 'grid',
            gap: '1.5rem',
            padding: '4rem 0 5rem',
            textAlign: 'center',
          }}
        >
          {/* Wordmark — drop /public/brands/cxo/logo.png and this Just Works */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brands/cxo/logo.png"
            alt="CXO Suite"
            style={{
              display: 'block',
              margin: '0 auto 0.5rem',
              maxHeight: 120,
              width: 'auto',
            }}
          />
          <p
            style={{
              fontSize: 13,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: ALMOND,
              fontWeight: 600,
              margin: 0,
            }}
          >
            The Executive Operating System
          </p>
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 5.5vw, 4.2rem)',
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Run your company from one screen.
          </h1>
          <p
            style={{
              fontSize: '1.15rem',
              maxWidth: 680,
              margin: '0.5rem auto 0',
              lineHeight: 1.6,
              color: INK_MUTED,
            }}
          >
            Team performance, executive comms, calendar, inbox, and an AI assistant —
            purpose-built for founders and the C-suite. No dialer noise, no rep clutter.
            The view your team can&apos;t give you.
          </p>
          <div
            style={{
              display: 'flex',
              gap: '0.8rem',
              justifyContent: 'center',
              marginTop: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <Link
              href="/login"
              style={{
                background: ESPRESSO,
                color: IVORY,
                padding: '0.85rem 1.6rem',
                borderRadius: 999,
                fontWeight: 600,
                fontSize: 15,
                textDecoration: 'none',
                letterSpacing: '0.02em',
              }}
            >
              Sign in
            </Link>
            <Link
              href="/demo"
              style={{
                background: 'transparent',
                color: ESPRESSO,
                padding: '0.85rem 1.6rem',
                borderRadius: 999,
                fontWeight: 600,
                fontSize: 15,
                textDecoration: 'none',
                letterSpacing: '0.02em',
                border: `1.5px solid ${ESPRESSO}`,
              }}
            >
              Book a walkthrough
            </Link>
          </div>
        </header>

        {/* ── Feature trio ───────────────────────────────────────────── */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.2rem',
            marginTop: '2rem',
          }}
        >
          <FeatureCard
            label="01 — Command Center"
            title="Every metric. Live."
            body="Revenue, pipeline value, conversion by rep, calendar load — the dashboard your team's tools should be feeding into."
          />
          <FeatureCard
            label="02 — Executive Comms"
            title="Owners Room. Manager Room."
            body="Private channels for the people who actually need to talk to each other. Telegram-native so it shows up where you live."
          />
          <FeatureCard
            label="03 — Chief of Staff, on tap"
            title="Invite your assistant in one click."
            body="Your EA gets full admin access to your suite — calendar, inbox, comms, reports. They run point so you can run the company."
          />
        </section>

        {/* ── Closing ────────────────────────────────────────────────── */}
        <footer
          style={{
            marginTop: '5rem',
            padding: '3rem 2rem',
            background: BEIGE,
            borderRadius: 24,
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: 13,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: ALMOND,
              fontWeight: 600,
              margin: 0,
            }}
          >
            By invitation
          </p>
          <h2
            style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontWeight: 500,
              fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)',
              margin: '0.5rem 0 1rem',
            }}
          >
            We&apos;re onboarding founding members.
          </h2>
          <p
            style={{
              maxWidth: 540,
              margin: '0 auto 1.6rem',
              color: INK_MUTED,
              lineHeight: 1.6,
            }}
          >
            CXO Suite is in private beta with a small cohort of founders and operators.
            Reach out and we&apos;ll walk you through what your view will look like.
          </p>
          <Link
            href="/demo"
            style={{
              background: ESPRESSO,
              color: IVORY,
              padding: '0.85rem 1.8rem',
              borderRadius: 999,
              fontWeight: 600,
              fontSize: 15,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Request access
          </Link>
        </footer>

        <p
          style={{
            marginTop: '3rem',
            textAlign: 'center',
            fontSize: 12,
            color: SAND,
            letterSpacing: '0.05em',
          }}
        >
          © {new Date().getFullYear()} CXO Suite · suitecxo.com
        </p>
      </div>
    </main>
  )
}

function FeatureCard({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: 18,
        padding: '1.8rem 1.6rem',
        border: `1px solid ${BEIGE}`,
        display: 'grid',
        gap: '0.6rem',
        alignContent: 'start',
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: ALMOND,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <h3
        style={{
          fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
          fontWeight: 500,
          fontSize: '1.6rem',
          margin: 0,
          lineHeight: 1.15,
          color: ESPRESSO,
        }}
      >
        {title}
      </h3>
      <p style={{ color: INK_MUTED, lineHeight: 1.6, margin: 0, fontSize: '0.97rem' }}>
        {body}
      </p>
    </div>
  )
}
