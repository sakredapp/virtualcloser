import Link from 'next/link'

export const dynamic = 'force-dynamic'

// CXO Suite is a separate brand from Virtual Closer — see lib/brand.ts.
// Middleware rewrites `/` on suitecxo.com to this route, so this is the
// public landing page that executives see before signing in.
//
// Palette is hard-coded (not from CSS vars) because the page is locked to
// the CXO identity regardless of any future global theming changes.
const ESPRESSO = '#3B2C23'
const ALMOND = '#AA8C6B'
const SAND = '#B7A38B'
const BEIGE = '#DDD1C3'
const IVORY = '#F4EDE1'
const INK_MUTED = '#5a463a'

const LOGO_SRC =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png'

export default function CxoMarketingPage() {
  return (
    <main
      style={{
        background: IVORY,
        color: ESPRESSO,
        minHeight: 'calc(100vh - 2rem)',
        padding: '3.5rem 1rem 6rem',
        fontFamily: '"IBM Plex Sans", "Inter", "Avenir Next", system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>

        {/* ── Hero ──────────────────────────────────────────────────── */}
        <header style={{ display: 'grid', gap: '1.5rem', padding: '3rem 0 4rem', textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_SRC}
            alt="CXO Suite"
            style={{ display: 'block', margin: '0 auto 0.25rem', maxHeight: 160, width: 'auto' }}
          />
          <Eyebrow>The Executive Operating System</Eyebrow>
          <Display>
            Your team&apos;s data, your AI workforce,<br />and your assistant.<br />
            <em style={{ color: ALMOND, fontStyle: 'italic', fontWeight: 400 }}>
              All on one screen.
            </em>
          </Display>
          <p
            style={{
              fontSize: '1.18rem',
              maxWidth: 720,
              margin: '0.5rem auto 0',
              lineHeight: 1.65,
              color: INK_MUTED,
            }}
          >
            CXO Suite pulls live performance from your reps, runs your AI agents,
            organizes your calendar and inbox, and gives your chief of staff a seat
            at the controls — so you stop chasing updates and start running the company.
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
            <PrimaryButton href="/demo">Request access</PrimaryButton>
            <GhostButton href="/login">Sign in</GhostButton>
          </div>
        </header>

        {/* ── Section 1: Live team intelligence ───────────────────── */}
        <Section
          eyebrow="01 · Live team intelligence"
          title="Stop chasing updates. Watch them stream in."
          body="Every call, deal, conversion, and calendar booking from your team rolls up here in real time. KPIs aren't a Monday email — they're the screen you keep open."
          highlights={[
            'Live pipeline value, conversion-by-rep, and revenue tracking',
            'External CRM data (HubSpot, GHL, Airtable, Salesforce, Pipedrive) unified into one feed',
            'Weekly board-ready reports auto-generated',
            'Drill into any rep — their calls today, their open deals, their calendar load',
          ]}
        />

        {/* ── Section 2: AI workforce ─────────────────────────────── */}
        <Section
          eyebrow="02 · Your AI workforce, working alongside your team"
          title="Agents that close, qualify, and draft — while your team sleeps."
          body="The same AI dialer, AI receptionist, and AI sales reps your team uses are yours to deploy. They don't quit, don't miss follow-ups, and don't need a comp plan."
          highlights={[
            'AI Voice SDR handles inbound + outbound calls in your brand voice',
            'AI Receptionist qualifies leads, books calls, and routes them to humans only when needed',
            'Email triage: Claude reads your inbox, drafts replies, checks your calendar before proposing times',
            'Every recording transcribed, classified, and indexed — no more "I forget what the lead said"',
          ]}
        />

        {/* ── Section 3: Comms + organization ─────────────────────── */}
        <Section
          eyebrow="03 · Executive comms, frictionless"
          title="Owners Room. Manager Room. Telegram-native."
          body="The conversations only execs and their managers should be in — separated, private, on the device you already check 200 times a day. Push tasks, share intel, fire walkies to the team without leaving the bot."
          highlights={[
            'Private Owners Room + Manager Room channels',
            'Brain-dump anything — Claude organizes it into leads, tasks, deals',
            'Assign work to specific reps via Telegram; track completion in the dashboard',
            'Daily standup digest delivered every morning to your DM',
          ]}
        />

        {/* ── Section 4: Assistant + chief of staff ──────────────── */}
        <Section
          eyebrow="04 · Your chief of staff, on tap"
          title="Invite your assistant. They run point. You run the company."
          body="One click invites your EA into your suite with full admin access — calendar, inbox, reports, comms. They get a login, their own Telegram link, and a seat next to you in every view."
          highlights={[
            'Add or remove an assistant from /dashboard/settings in under a minute',
            'Your assistant sees what you see and acts as you when needed',
            'Audit trail on every action — you always know who did what, when',
            'Manage multiple assistants if your operation calls for it',
          ]}
        />

        {/* ── Section 5: Organization + recall ────────────────────── */}
        <Section
          eyebrow="05 · Everything you said, captured"
          title="Your calendar, your inbox, your meetings — wired together."
          body="Spencer doesn't open ten tools — he opens one. Calendar checks email availability before drafting. Meetings get auto-summarized into prospect records. Recordings turn into action items overnight. The system organizes around you."
          highlights={[
            'Gmail triage with one-click AI drafts that respect your real calendar',
            'Fathom/Plaud/Cal.com meetings auto-saved with summaries and follow-ups',
            'PDF briefs and proposals generated from the deal context',
            'Task reminders that fire on Telegram, not in another app you forget about',
          ]}
        />

        {/* ── Closing CTA ─────────────────────────────────────────── */}
        <footer
          style={{
            marginTop: '5rem',
            padding: '3.5rem 2rem',
            background: BEIGE,
            borderRadius: 28,
            textAlign: 'center',
          }}
        >
          <Eyebrow>By invitation · Founding cohort</Eyebrow>
          <Display style={{ fontSize: 'clamp(1.9rem, 3.6vw, 2.8rem)', margin: '0.6rem 0 1rem' }}>
            Built first for one executive.<br />Now scaling to ten.
          </Display>
          <p style={{ maxWidth: 580, margin: '0 auto 1.6rem', color: INK_MUTED, lineHeight: 1.65 }}>
            CXO Suite is the productized version of the operating system we built
            for one founder running a wellness business. Same AI workforce, same
            comms layer, same data pipes — yours to deploy.
          </p>
          <PrimaryButton href="/demo">Request access</PrimaryButton>
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

// ── Sub-components ────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 12,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: ALMOND,
        fontWeight: 700,
        margin: 0,
      }}
    >
      {children}
    </p>
  )
}

function Display({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <h1
      style={{
        fontSize: 'clamp(2.4rem, 5.4vw, 4.2rem)',
        fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
        fontWeight: 500,
        lineHeight: 1.08,
        letterSpacing: '-0.02em',
        margin: 0,
        color: ESPRESSO,
        ...style,
      }}
    >
      {children}
    </h1>
  )
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        background: ESPRESSO,
        color: IVORY,
        padding: '0.95rem 1.8rem',
        borderRadius: 999,
        fontWeight: 600,
        fontSize: 15,
        textDecoration: 'none',
        letterSpacing: '0.02em',
        display: 'inline-block',
      }}
    >
      {children}
    </Link>
  )
}

function GhostButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        background: 'transparent',
        color: ESPRESSO,
        padding: '0.95rem 1.8rem',
        borderRadius: 999,
        fontWeight: 600,
        fontSize: 15,
        textDecoration: 'none',
        letterSpacing: '0.02em',
        border: `1.5px solid ${ESPRESSO}`,
        display: 'inline-block',
      }}
    >
      {children}
    </Link>
  )
}

function Section({
  eyebrow,
  title,
  body,
  highlights,
}: {
  eyebrow: string
  title: string
  body: string
  highlights: string[]
}) {
  return (
    <section
      style={{
        marginTop: '2.5rem',
        background: '#FFFFFF',
        borderRadius: 22,
        padding: '2.4rem 2rem',
        border: `1px solid ${BEIGE}`,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: '1.2rem',
      }}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        style={{
          fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
          fontWeight: 500,
          fontSize: 'clamp(1.7rem, 3.2vw, 2.4rem)',
          margin: 0,
          lineHeight: 1.18,
          color: ESPRESSO,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      <p style={{ color: INK_MUTED, lineHeight: 1.7, margin: 0, fontSize: '1.02rem', maxWidth: 740 }}>
        {body}
      </p>
      <ul
        style={{
          listStyle: 'none',
          margin: '0.4rem 0 0',
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '0.7rem',
        }}
      >
        {highlights.map((h, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              padding: '0.6rem 0.9rem',
              background: IVORY,
              borderRadius: 12,
              fontSize: '0.93rem',
              color: ESPRESSO,
              lineHeight: 1.45,
              border: `1px solid ${BEIGE}`,
            }}
          >
            <span style={{ color: ALMOND, fontWeight: 800, flexShrink: 0 }}>—</span>
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
