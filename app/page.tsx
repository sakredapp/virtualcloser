import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Brand tokens. The visible canvas is `--paper-2` cream (#f7f4ef) painted
// by the .site-shell wrapper, NOT the red body underneath. So all text on
// the canvas needs to be DARK (ink/muted) for readability — white text
// disappears. Dark accent tiles use neutral grey (not navy slate) per
// brand direction.
const BRAND_RED = '#ff2800'
const INK = '#0f0f0f'
const MUTED = '#2b2b2b'
const MUTED_2 = '#525252'
const DARK_GREY_GRADIENT = 'linear-gradient(135deg, #2a2a2a 0%, #161616 100%)'

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
      {/* Inline style — rotate the chevron when an expandable feature
          card is open. Plus the zebra band media queries for dense grids. */}
      <style>{`
        details[open] > summary .feature-chevron { transform: rotate(180deg); }
        details > summary::-webkit-details-marker { display: none; }
        details > summary::marker { display: none; }
        .why-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.4rem;
          margin-top: 2rem;
        }
        @media (max-width: 900px) {
          .why-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .why-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 720px) {
          .four-grid,
          .integ-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── Intro block (no card, ink text on cream canvas) ──────────── */}
      <section style={{ marginTop: '1.6rem', textAlign: 'center', padding: '3rem 0.6rem 4rem' }}>
        <p
          style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: BRAND_RED,
            margin: 0,
          }}
        >
          Your AI sales floor
        </p>
        <h1
          style={{
            margin: '0.5rem auto 0',
            fontSize: 'clamp(2rem, 5vw, 2.8rem)',
            color: INK,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            maxWidth: 880,
          }}
        >
          Four AI hires. One workspace. Zero overhead.
        </h1>
        <p
          style={{
            color: MUTED,
            maxWidth: 720,
            margin: '0.85rem auto 0',
            fontSize: '1.05rem',
            lineHeight: 1.65,
          }}
        >
          AI SDR · AI Receptionist · AI Sales Trainer · AI Jarvis on Telegram. Plugged
          into your CRM, dialer, and calendar. Trained on your voice. Working while
          you sleep.
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="https://cal.com/virtualcloser/30min" className="btn approve" style={{ textDecoration: 'none' }}>
            Book a 30-min call
          </Link>
          <Link href="/offer" className="btn dismiss" style={{ textDecoration: 'none' }}>
            See pricing
          </Link>
          <Link href="/demo" className="btn dismiss" style={{ textDecoration: 'none' }}>
            Live demo
          </Link>
        </div>
      </section>

      {/* ── Four AI hires ─────────────────────────────────────────────── */}
      <Band tone="dark">
        <SectionLabel kicker="Meet the roster" tone="dark">
          Four AI hires. One workspace. Each one earns its keep.
        </SectionLabel>
        <div className="four-grid" style={fourGridStyle}>
          <FeatureCard
            tag="AI SDR"
            title="Dials your leads, books your meetings."
            benefit="Pays ~$5/hour instead of $30–35. Runs the shifts you set, dials the lists you give it, books straight to your calendar. No sick days, no coaching plan, no PTO, no quota whining."
            bullets={[
              '4 modes — Receptionist, Appointment Setter, Live Transfer, Workflows',
              'Per-rep shift schedules + monthly hour budgets',
              'Volume tiers down to $4.15/hr at scale',
            ]}
            href="/offer"
            cta="See SDR pricing"
          />
          <FeatureCard
            tag="AI Receptionist"
            title="Picks up every inbound call. Even the ones at 11pm."
            benefit="Never miss another lead because someone called at lunch. Triages, books appointments, transfers to a human when it matters, takes a message when it doesn't. Same voice, same pricing, dialer-mode toggle in the dashboard."
            bullets={[
              'Books straight to Cal.com / Google / Outlook',
              'Smart routing: hot lead → live transfer, cold → text follow-up',
              'Bilingual options — no accent lottery',
            ]}
            href="/offer"
            cta="Configure inbound"
          />
          <FeatureCard
            tag="AI Sales Trainer"
            title="Always-on roleplay. Reps drill on their own time."
            benefit="Stop micromanaging practice. Trainer throws objections 24/7, runs full discovery scripts, gives feedback after every call. Reps train themselves between dials — no managers needed in the loop."
            bullets={[
              'Per-seat hour budgets, same volume tiers as the SDR',
              'Custom scripts per product line',
              'Post-session scorecards land in the rep&rsquo;s dashboard',
            ]}
            href="/offer"
            cta="See Trainer pricing"
          />
          <FeatureCard
            tag="AI Jarvis · the OG"
            title="Voice-note your day. Dashboard updates itself."
            benefit="The original. Send a voice note or text to Jarvis on Telegram and it logs the call, updates the pipeline, drafts the follow-up, books the next meeting, and pings the team. The way Tony Stark would run a sales org."
            bullets={[
              'Telegram-native — works from any phone, no app to install',
              'Voice → CRM updates → next-action drafts',
              'Morning brief + standup digest auto-generated daily',
            ]}
            href="/demo"
            cta="See Jarvis in action"
          />
        </div>
      </Band>

      {/* ── Cost comparison ───────────────────────────────────────────── */}
      <Band tone="cream">
        <SectionLabel kicker="Why hire AI">
          The math nobody at your competitor&rsquo;s shop wants to do.
        </SectionLabel>
        <div style={costCompareStyle}>
          <div style={costColStyle}>
            <p style={costColKickerStyle}>Hire one human SDR</p>
            <p style={{ ...costBigNumStyle, color: '#0f0f0f' }}>~$72k/yr</p>
            <ul style={{ ...costListStyle, color: INK }}>
              <li>$30–35/hr fully loaded (wage + tax + benefits)</li>
              <li>~3 weeks PTO, sick days, holidays</li>
              <li>Manager time to coach, ramp, and replace</li>
              <li>~70% turnover in year-one SDRs (industry avg)</li>
              <li>One time zone, one accent, one mood at a time</li>
            </ul>
          </div>
          <div style={costVsStyle}>vs.</div>
          <div style={{ ...costColStyle, background: DARK_GREY_GRADIENT, color: '#fff', border: '2px solid #ff2800' }}>
            <p style={{ ...costColKickerStyle, color: BRAND_RED }}>Hire your AI SDR</p>
            <p style={{ ...costBigNumStyle, color: '#fff' }}>~$10k/yr<span style={{ fontSize: '0.7rem', fontWeight: 700, color: BRAND_RED, marginLeft: 8, letterSpacing: '0.1em' }}>~85% LESS</span></p>
            <ul style={{ ...costListStyle, color: 'rgba(255,255,255,0.92)' }}>
              <li>$4.15–6/hr volume-tier pricing, billed per minute</li>
              <li>0 PTO, 0 sick days, 0 turnover, 0 coaching cost</li>
              <li>Runs the shifts you set, in the rep&rsquo;s timezone</li>
              <li>Same voice, same script, every single dial</li>
              <li>Scale up overnight — no hiring cycle</li>
            </ul>
          </div>
        </div>
        <p style={{ textAlign: 'center', fontSize: '0.78rem', color: MUTED_2, marginTop: '0.85rem', maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
          Math assumes $30/hr human SDR × 40 hrs/wk × 50 weeks vs. AI SDR at
          $5/hr × 40 hrs/wk × 50 weeks. Real builds usually swap 2–3 humans
          for one AI roster, multiplying the savings.
        </p>
      </Band>

      {/* ── Integrations ──────────────────────────────────────────────── */}
      <Band tone="dark">
        <SectionLabel kicker="Plugs into your stack" tone="dark">
          Your AI updates your real systems. In real time. No clipboard.
        </SectionLabel>
        <p style={{ ...sectionLeadStyle, color: 'rgba(255,255,255,0.92)' }}>
          You don&rsquo;t throw out the CRM, dialer, or comms stack you&rsquo;ve already
          paid for. Virtual Closer sits on top of it and updates everything
          live — pipeline rows, dispositions, calendar events, follow-ups,
          DMs — so your reps stop tab-hopping between five clunky tools.
        </p>
        <div className="integ-grid" style={integrationGridStyle}>
          <IntegrationCard category="CRM" items={['GoHighLevel', 'HubSpot', 'Pipedrive', 'Salesforce', 'Built-in VC pipeline']} note="AI writes back to your CRM as the call ends — disposition, next-step, follow-up draft, all in real time." />
          <IntegrationCard category="Dialer + KPIs" items={['Built-in AI dialer', 'WAVV', 'Twilio (direct-pay)', 'BlueBubbles iMessage']} note="Our AI dialer is the engine — already on WAVV or Twilio? Live dispositions land on every rep dashboard, and you keep your existing account with no markup." />
          <IntegrationCard category="Calendar + comms" items={['Cal.com', 'Google Calendar', 'Outlook', 'Telegram', 'Resend email', 'Fathom call intel']} note="Books straight onto the rep&rsquo;s real calendar. Confirms via SMS and email. Pings the manager on Telegram when a hot lead drops." />
          <IntegrationCard category="Workflow glue" items={['Zapier', 'n8n', 'Webhooks', 'Brain dump (voice → tasks)']} note="Connect anything else with Zapier or n8n. Voice-note Jarvis once, fans out to whatever you need." />
        </div>
      </Band>

      {/* ── Why this scales ───────────────────────────────────────────── */}
      <Band tone="cream">
        <SectionLabel kicker="Why it scales fast">
          Skip the W-2 ladder. Hire a roster, not a body.
        </SectionLabel>
        <div className="why-grid">
          <BenefitCard
            num="1"
            title="No hiring cycle"
            body="An AI SDR is live the day you flip the switch. No 6-week ramp, no resume pile, no recruiter retainer. Need 10 more agents next week? Click the slider."
          />
          <BenefitCard
            num="2"
            title="No timezone math"
            body="Each agent runs on its own per-agent timezone. Set their shift in 4–8pm local, the dialer follows. Coverage across the US (or globally) doesn&rsquo;t need a night-shift hire."
          />
          <BenefitCard
            num="3"
            title="No accent lottery"
            body="Same trained voice, every dial. No call-center quality variance. Reps and prospects hear the same brand, no matter who&rsquo;s on the other line."
          />
          <BenefitCard
            num="4"
            title="Self-billing per rep"
            body="Each agent gets their own card on file (or the org pays for them). Monthly hour bucket, no rollover, dashboard shows usage live. No more spreadsheet of who used what."
          />
          <BenefitCard
            num="5"
            title="Self-served shifts"
            body="Reps set their own dialing windows from the dashboard — 9–11am and 3–7pm Tues, all-day Thurs, whatever they want. No manager approval bottleneck."
          />
          <BenefitCard
            num="6"
            title="Compounds, not depreciates"
            body="Every call sharpens the model. Every objection logged makes the trainer smarter. Every booked meeting tunes the AI Jarvis brief. Day 90 looks nothing like day 1."
          />
        </div>
      </Band>

      {/* ── Two paths ─────────────────────────────────────────────────── */}
      <Band tone="dark">
        <SectionLabel kicker="Pick your starting point" tone="dark">
          One rep, one org, one shop.
        </SectionLabel>
        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <article className="card" style={{ borderColor: '#ff2800', borderWidth: 2 }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff2800', margin: 0 }}>
              For individuals
            </p>
            <h3 style={{ margin: '0.4rem 0 0.5rem', fontSize: '1.3rem' }}>Solo agent? Built for you.</h3>
            <p className="meta" style={{ margin: 0 }}>
              Hire your AI SDR + AI Trainer for the price of two coffees an hour.
              Pick your weekly hours, save a card, set your shifts, watch the
              dashboard fill with booked meetings. AWS-style blended billing —
              you save more as you ramp.
            </p>
            <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link href="/offer" className="btn approve" style={{ textDecoration: 'none' }}>
                Build your individual quote
              </Link>
              <Link href="/demo" className="btn dismiss" style={{ textDecoration: 'none' }}>
                See the dashboard
              </Link>
            </div>
          </article>

          <article className="card" style={{ borderColor: '#ff2800', borderWidth: 2 }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff2800', margin: 0 }}>
              For enterprise
            </p>
            <h3 style={{ margin: '0.4rem 0 0.5rem', fontSize: '1.3rem' }}>Sales org? Bring everyone.</h3>
            <p className="meta" style={{ margin: 0 }}>
              Per-seat base build with bulk tiers, an AI SDR per rep, org-wide
              roleplay pool, your real CRM wired in. Org pays per agent or each
              rep self-bills — pick at onboarding. Manager rollups, leaderboards,
              and a sticky monthly cart that follows you down the page.
            </p>
            <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link href="/offer/enterprise" className="btn approve" style={{ textDecoration: 'none' }}>
                Build your enterprise quote
              </Link>
              <Link href="/demo/enterprise" className="btn dismiss" style={{ textDecoration: 'none' }}>
                See the org view
              </Link>
            </div>
          </article>
        </div>
      </Band>

      {/* ── Origin story ──────────────────────────────────────────────── */}
      <Band tone="cream">
        <SectionLabel kicker="Where it all started">
          Jarvis on Telegram. Then the rest of the floor.
        </SectionLabel>
        <article
          style={{
            background: DARK_GREY_GRADIENT,
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: '1.6rem 1.8rem',
            boxShadow: '0 10px 30px rgba(15,15,15,0.22)',
            marginTop: '1rem',
          }}
        >
          <p style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.65, color: 'rgba(255,255,255,0.92)' }}>
            We started Virtual Closer because we were tired of friends in sales
            running their day in five tabs. The original product was simple —
            voice-note <strong style={{ color: '#ff2800' }}>Jarvis</strong> on
            Telegram, and your dashboard updated itself. Pipeline, follow-ups,
            morning brief, end-of-day digest — all from a thumb-typed message
            on your couch.
          </p>
          <p style={{ margin: '0.85rem 0 0', fontSize: '1.05rem', lineHeight: 1.65, color: 'rgba(255,255,255,0.92)' }}>
            Then customers started asking: &ldquo;Can Jarvis dial my leads too?&rdquo; So
            we built the AI SDR. Then: &ldquo;Can it pick up the inbound calls?&rdquo;
            AI Receptionist. Then: &ldquo;Can it train my reps without me sitting in
            on every roleplay?&rdquo; AI Trainer. Then they wanted it wired into
            their real CRM, their real dialer, their real calendar — so we
            built the integrations.
          </p>
          <p style={{ margin: '0.85rem 0 0', fontSize: '1.05rem', lineHeight: 1.65, color: 'rgba(255,255,255,0.92)' }}>
            Today it&rsquo;s a four-hire AI sales org running on top of whatever
            stack you already paid for. Tomorrow it&rsquo;s another hire your
            customers will ask for. <strong style={{ color: '#ff2800' }}>Jarvis is still the heart.</strong>{' '}
            The rest just makes him scarier.
          </p>
        </article>
      </Band>

      {/* ── Final CTA ─────────────────────────────────────────────────── */}
      <Band tone="dark" align="center">
        <h2 style={{ fontSize: 'clamp(1.7rem, 3.4vw, 2.2rem)', color: '#fff', margin: 0, fontWeight: 900, letterSpacing: '-0.01em', lineHeight: 1.2 }}>Ready to fire your spreadsheet?</h2>
        <p style={{ color: 'rgba(255,255,255,0.85)', maxWidth: 620, margin: '1rem auto 1.6rem', fontSize: '1.05rem', lineHeight: 1.65 }}>
          30 minutes on a call. We scope your build, lock the price, and you
          walk away with a running quote you can hand to your CFO.
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="https://cal.com/virtualcloser/30min" className="btn approve" style={{ textDecoration: 'none' }}>
            Book the call
          </Link>
          <Link href="/login" className="btn dismiss" style={{ textDecoration: 'none' }}>
            Already a client → portal
          </Link>
        </div>
      </Band>

      <footer style={{ color: MUTED_2, textAlign: 'center', marginTop: '1.6rem', fontSize: '0.85rem' }}>
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

// ── Reusable building blocks ──────────────────────────────────────────

function SectionLabel({
  kicker,
  children,
  tone = 'cream',
}: {
  kicker: string
  children: React.ReactNode
  tone?: 'cream' | 'dark'
}) {
  return (
    <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
      <p
        style={{
          fontSize: '0.72rem',
          fontWeight: 800,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: BRAND_RED,
          margin: 0,
        }}
      >
        {kicker}
      </p>
      <h2
        style={{
          fontSize: 'clamp(1.6rem, 3.8vw, 2.2rem)',
          color: tone === 'dark' ? '#fff' : INK,
          margin: '0.7rem 0 0',
          fontWeight: 900,
          letterSpacing: '-0.015em',
          lineHeight: 1.2,
          maxWidth: 780,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        {children}
      </h2>
    </div>
  )
}

function Band({
  children,
  tone,
  align,
}: {
  children: React.ReactNode
  tone: 'cream' | 'dark'
  align?: 'center'
}) {
  if (tone === 'cream') {
    return (
      <section
        style={{
          marginTop: 'var(--s-30)',
          padding: 'var(--s-12) var(--s-2)',
          textAlign: align,
        }}
      >
        {children}
      </section>
    )
  }
  return (
    <section
      style={{
        marginTop: 'var(--s-30)',
        padding: 'var(--s-30) var(--s-10)',
        background: DARK_GREY_GRADIENT,
        color: '#fff',
        borderRadius: 18,
        boxShadow: '0 20px 48px rgba(15,15,15,0.22)',
        textAlign: align,
      }}
    >
      {children}
    </section>
  )
}

function FeatureCard({
  tag,
  title,
  benefit,
  bullets,
  href,
  cta,
}: {
  tag: string
  title: string
  benefit: string
  bullets: string[]
  href: string
  cta: string
}) {
  return (
    <details
      style={{
        background: '#fff',
        border: '1.5px solid #d6d0c2',
        borderRadius: 14,
        boxShadow: '0 6px 18px rgba(15,15,15,0.10)',
        overflow: 'hidden',
        transition: 'box-shadow 160ms ease, transform 160ms ease',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '1.2rem 1.35rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.7rem',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              background: BRAND_RED,
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 999,
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
          <span
            aria-hidden
            className="feature-chevron"
            style={{
              fontSize: '0.85rem',
              fontWeight: 800,
              color: BRAND_RED,
              transition: 'transform 160ms ease',
              flexShrink: 0,
            }}
          >
            ▼
          </span>
        </div>
        {/* Just the title in the summary. minHeight matches all cards so
            the four collapsed cards line up flush in the row. */}
        <h3
          style={{
            margin: 0,
            fontSize: '1.05rem',
            color: INK,
            lineHeight: 1.3,
            fontWeight: 800,
            minHeight: '2.6rem',
            display: 'flex',
            alignItems: 'flex-start',
          }}
        >
          {title}
        </h3>
        <span
          style={{
            fontSize: '0.74rem',
            fontWeight: 700,
            color: BRAND_RED,
            letterSpacing: '0.04em',
          }}
        >
          Tap to expand →
        </span>
      </summary>
      <div style={{ padding: '1rem 1.35rem 1.35rem', borderTop: '1px dashed #e2dccd' }}>
        <p style={{ margin: 0, fontSize: '0.92rem', color: MUTED, lineHeight: 1.65 }}>{benefit}</p>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '1rem 0 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
          }}
        >
          {bullets.map((b) => (
            <li key={b} style={{ fontSize: '0.92rem', color: INK, display: 'flex', alignItems: 'baseline', gap: 10, lineHeight: 1.65, fontWeight: 400 }}>
              <span aria-hidden style={{ color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <Link
          href={href}
          style={{
            marginTop: '1.1rem',
            display: 'inline-block',
            color: BRAND_RED,
            fontWeight: 800,
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}
        >
          {cta} →
        </Link>
      </div>
    </details>
  )
}

function BenefitCard({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid #E5E5E5',
        borderRadius: 14,
        padding: '2rem',
        boxShadow: '0 1px 3px rgba(15,15,15,0.04), 0 1px 2px rgba(15,15,15,0.04)',
      }}
    >
      <span
        style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: '#6B7280',
        }}
      >
        {num.padStart(2, '0')}
      </span>
      <h3 style={{ margin: '0.6rem 0 0.55rem', fontSize: '1.05rem', color: '#0f0f0f', fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: '0.92rem', color: '#6B7280', lineHeight: 1.65, fontWeight: 400 }}>{body}</p>
    </article>
  )
}

function IntegrationCard({
  category,
  items,
  note,
}: {
  category: string
  items: string[]
  note: string
}) {
  return (
    <article
      style={{
        background: '#fff',
        border: '1.5px solid #e6e1d8',
        borderRadius: 12,
        padding: '1.15rem 1.25rem',
        boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
      }}
    >
      <p
        style={{
          fontSize: '0.7rem',
          fontWeight: 800,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#ff2800',
          margin: 0,
        }}
      >
        {category}
      </p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '0.6rem 0 0.85rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
        }}
      >
        {items.map((i) => (
          <li
            key={i}
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 999,
              background: '#0f172a',
              color: '#fff',
            }}
          >
            {i}
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: '0.83rem', color: MUTED, lineHeight: 1.65 }}>{note}</p>
    </article>
  )
}

// ── Inline style tokens ───────────────────────────────────────────────

const sectionLeadStyle: React.CSSProperties = {
  textAlign: 'center',
  color: 'rgba(255,255,255,0.85)',
  maxWidth: 760,
  margin: '0 auto 2rem',
  fontSize: '1.05rem',
  lineHeight: 1.65,
}

const fourGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '1.4rem',
  marginTop: '1.5rem',
}

const integrationGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '1.4rem',
  marginTop: '1.5rem',
}

const costCompareStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.85rem',
  alignItems: 'stretch',
  justifyContent: 'center',
  marginTop: '1rem',
}

const costColStyle: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid #e6e1d8',
  borderRadius: 14,
  padding: '1.4rem 1.5rem',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 6px 22px rgba(0,0,0,0.08)',
  flex: '1 1 320px',
  minWidth: 0,
}

const costColKickerStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 800,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: MUTED,
  margin: 0,
}

const costBigNumStyle: React.CSSProperties = {
  fontSize: '2.4rem',
  fontWeight: 900,
  margin: '0.4rem 0 0.85rem',
  lineHeight: 1,
  letterSpacing: '-0.02em',
}

const costListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  fontSize: '0.88rem',
  lineHeight: 1.5,
}

const costVsStyle: React.CSSProperties = {
  alignSelf: 'center',
  fontSize: '1.2rem',
  fontWeight: 900,
  color: MUTED_2,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  padding: '0 0.4rem',
}
