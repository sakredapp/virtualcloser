// roleplay.virtualcloser.com — standalone landing for the VC Roleplay tool.
//
// Served at the root of the product host via the middleware rewrite, and also
// reachable at virtualcloser.com/roleplay. Links are computed against the
// host so both spellings navigate correctly.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { brandFromHost } from '@/lib/brand'
import { renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { TRAINER_PERSONAS } from '@/lib/roleplay-engine'
import TryVoiceButton from '../demo/TryVoiceButton'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'VC Roleplay — AI Sales Trainer | Virtual Closer',
  description:
    'Live voice roleplay against AI prospects that push back like real ones. Every session graded by AI. Built into the Virtual Closer platform.',
}

const RED = '#ff2800'

const AGREEMENT_HTML = renderAgreementHtml({ workspaceLabel: 'Roleplay demo' })

// Wallet top-up examples at the one retail rate: $0.25/min of live practice
// (ROLEPLAY_CENTS_PER_MIN in lib/minutePricing.ts). No subscription — the
// wallet only drains while a rep is on a call.
const PRICING: Array<{ hours: string; price: string }> = [
  { hours: '$25 wallet', price: '100 min of practice' },
  { hours: '$50 wallet', price: '200 min · ~3.5 hrs' },
  { hours: '$100 wallet', price: '400 min · ~6.5 hrs' },
  { hours: '$250 wallet', price: '1,000 min · ~16.5 hrs' },
]

export default async function RoleplayLanding() {
  const h = await headers()
  const host = (h.get('x-tenant-host') ?? h.get('host') ?? '').split(':')[0].toLowerCase()
  const brand = brandFromHost(host)
  const onProductHost = host === `roleplay.${brand.rootDomain}`
  const base = onProductHost ? '' : '/roleplay'
  const mainSite = `https://${brand.rootDomain}`

  return (
    <main style={{ background: '#0f0f0f', color: '#fff', minHeight: '100vh', fontFamily: 'inherit' }}>
      {/* Top bar */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px clamp(16px, 5vw, 56px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 900, letterSpacing: '0.02em', fontSize: 18 }}>
            VIRTUAL<span style={{ color: RED }}>CLOSER</span>
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: RED,
              border: `1px solid ${RED}55`,
              borderRadius: 999,
              padding: '3px 10px',
            }}
          >
            Roleplay
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href={mainSite} style={navLink}>
            Main site
          </a>
          <Link href={`${base}/floor`} style={{ ...navLink, background: RED, borderColor: RED }}>
            Open the floor →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ padding: 'clamp(48px, 9vw, 110px) clamp(16px, 5vw, 56px)', maxWidth: 1060, margin: '0 auto' }}>
        <p style={{ color: RED, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 12, margin: 0 }}>
          The AI sales trainer
        </p>
        <h1 style={{ fontSize: 'clamp(34px, 6vw, 62px)', lineHeight: 1.05, margin: '14px 0 18px', fontWeight: 900 }}>
          Your reps&rsquo; worst call
          <br />
          should happen <span style={{ color: RED }}>here.</span>
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2vw, 19px)', lineHeight: 1.6, color: 'rgba(255,255,255,0.75)', maxWidth: 640, margin: 0 }}>
          Live voice roleplay against AI prospects that stall, deflect, and push back like real ones.
          Talk to them from your browser — no phone, no scheduling, no mercy. Every session is
          transcribed and graded by AI, so you know exactly who&rsquo;s ready before they touch a real deal.
        </p>
        <div style={{ display: 'flex', gap: 14, marginTop: 30, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link
            href={`${base}/floor`}
            style={{
              background: RED,
              color: '#fff',
              fontWeight: 800,
              fontSize: 16,
              padding: '14px 26px',
              borderRadius: 10,
              textDecoration: 'none',
              boxShadow: `0 8px 30px ${RED}55`,
            }}
          >
            Start practicing →
          </Link>
          <TryVoiceButton tier="individual" product="trainer" agreementHtml={AGREEMENT_HTML} />
        </div>
      </section>

      {/* Personas */}
      <section style={{ padding: '0 clamp(16px, 5vw, 56px) 40px', maxWidth: 1060, margin: '0 auto' }}>
        <h2 style={sectionTitle}>Pick your prospect</h2>
        <p style={sectionSub}>
          Four live personas, each with their own finances, family situation, and objection set.
          They answer instantly, argue honestly, and never break character.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
            marginTop: 22,
          }}
        >
          {TRAINER_PERSONAS.map((p) => (
            <div
              key={p.key}
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: '18px 18px 16px',
                background: 'linear-gradient(160deg, #1c1c1c 0%, #141414 100%)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontWeight: 800, fontSize: 16, margin: 0 }}>{p.name}</p>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: p.difficulty === 'brutal' ? '#fff' : RED,
                    background: p.difficulty === 'brutal' ? RED : `${RED}22`,
                    borderRadius: 999,
                    padding: '3px 9px',
                  }}
                >
                  {p.difficulty}
                </span>
              </div>
              <p style={{ fontSize: 12, color: RED, fontWeight: 700, margin: '4px 0 8px' }}>{p.headline}</p>
              <p style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(255,255,255,0.7)', margin: 0 }}>{p.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Application mode */}
      <section style={{ padding: '40px clamp(16px, 5vw, 56px) 0', maxWidth: 1060, margin: '0 auto' }}>
        <h2 style={sectionTitle}>
          The sale is the easy part. <span style={{ color: RED }}>Application mode</span> trains the rest.
        </h2>
        <p style={sectionSub}>
          Most roleplay tools end when the prospect says yes. Ours switches phases: the same voice on
          the line becomes an applicant, and you run a real carrier application — Transamerica Part 1
          and Part 2, the Foresters e-App with its temporary-insurance gate, Banner&rsquo;s
          client-completion flow — question by question, in the carrier&rsquo;s own order.
        </p>
        <div
          style={{
            marginTop: 22,
            border: `1px solid ${RED}44`,
            borderRadius: 14,
            padding: '20px 22px',
            background: 'linear-gradient(160deg, #1c1414 0%, #141414 100%)',
            fontSize: 14,
            lineHeight: 1.7,
            color: 'rgba(255,255,255,0.8)',
          }}
        >
          <p style={{ margin: 0 }}>
            The applicant has a <strong style={{ color: '#fff' }}>hidden answer sheet</strong>. Ask
            &ldquo;any medications?&rdquo; and you&rsquo;ll get <em>&ldquo;lisinopril and something for
            cholesterol.&rdquo;</em> Ask about hospitalizations and you&rsquo;ll get <em>&ldquo;I had
            something done with my heart last year.&rdquo;</em> The scorecard knows the full record —
            procedure, diagnosis, date, outcome, treating physician — and grades whether{' '}
            <strong style={{ color: '#fff' }}>you</strong> extracted it. Field capture, probing,
            carrier order, disclosures, payment details, signatures, submit.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '40px clamp(16px, 5vw, 56px)', maxWidth: 1060, margin: '0 auto' }}>
        <h2 style={sectionTitle}>How a session runs</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 14,
            marginTop: 22,
          }}
        >
          {[
            ['1 · Call', 'Pick a persona and hit start. The call opens in your browser over WebRTC — headset on, mic live, prospect talking back in under five seconds.'],
            ['2 · Close (or get closed)', 'They object in their own words: price, spouse, "send me something", "the house is almost paid off". Handle it live or lose the room.'],
            ['3 · Get graded', 'Hang up and the AI coach scores the call 0–100 — opener, discovery, objection handling, control, close attempt — with exactly what to fix next run.'],
          ].map(([t, d]) => (
            <div key={t} style={{ borderLeft: `3px solid ${RED}`, paddingLeft: 16 }}>
              <p style={{ fontWeight: 800, fontSize: 16, margin: '0 0 6px' }}>{t}</p>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ padding: '40px clamp(16px, 5vw, 56px) 70px', maxWidth: 1060, margin: '0 auto' }}>
        <h2 style={sectionTitle}>Pricing</h2>
        <p style={sectionSub}>
          $0.25 a minute, drawn from your team&rsquo;s AI wallet only while a rep is live on a call.
          No seats, no subscription — load the wallet once and the whole team practices off it.
          A human sales coach runs $200–500 per session; a full graded hour here is $15.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12,
            marginTop: 22,
          }}
        >
          {PRICING.map((p) => (
            <div
              key={p.hours}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                padding: '16px 18px',
                textAlign: 'center',
                background: '#161616',
              }}
            >
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 4px' }}>{p.hours}</p>
              <p style={{ fontSize: 22, fontWeight: 900, margin: 0, color: '#fff' }}>{p.price}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 26, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <a
            href={`${mainSite}/offer`}
            style={{
              background: RED,
              color: '#fff',
              fontWeight: 800,
              padding: '12px 22px',
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            Add it to your build →
          </a>
          <Link href={`${base}/floor`} style={{ ...navLink, alignSelf: 'center' }}>
            Already a client? Open the floor
          </Link>
        </div>
      </section>

      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '22px clamp(16px, 5vw, 56px)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.45)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <span>© {new Date().getFullYear()} Virtual Closer — VC Roleplay</span>
        <span>
          Part of the <a href={mainSite} style={{ color: 'rgba(255,255,255,0.65)' }}>Virtual Closer</a> AI sales platform
        </span>
      </footer>
    </main>
  )
}

const navLink: React.CSSProperties = {
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: 13,
  padding: '9px 16px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.2)',
}

const sectionTitle: React.CSSProperties = {
  fontSize: 'clamp(22px, 3.4vw, 30px)',
  fontWeight: 900,
  margin: 0,
}

const sectionSub: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.7)',
  maxWidth: 640,
  margin: '10px 0 0',
}
