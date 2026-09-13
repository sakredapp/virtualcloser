// The practice floor — the live half of roleplay.virtualcloser.com.
//
// Auth is session-based and host-independent: the client-session cookie is
// scoped to .virtualcloser.com, so anyone logged into their portal is already
// signed in here. No session → a login hand-off back to the brand gateway.

import { headers } from 'next/headers'
import Link from 'next/link'
import { brandFromHost } from '@/lib/brand'
import { ROLEPLAY_ENABLED } from '@/lib/roleplay'
import {
  resolveRoleplayMember,
  canPractice,
  TRAINER_PERSONAS,
  APPLICATION_SCENARIOS,
  personaAgent,
} from '@/lib/roleplay-engine'
import Floor from './Floor'

export const dynamic = 'force-dynamic'

const RED = '#ff2800'

export default async function FloorPage() {
  const h = await headers()
  const host = (h.get('x-tenant-host') ?? h.get('host') ?? '').split(':')[0].toLowerCase()
  const brand = brandFromHost(host)
  const onProductHost = host === `roleplay.${brand.rootDomain}`
  const base = onProductHost ? '' : '/roleplay'
  const selfUrl = onProductHost
    ? `https://roleplay.${brand.rootDomain}/floor`
    : `https://${brand.rootDomain}/roleplay/floor`

  const auth = await resolveRoleplayMember()

  if (!auth) {
    const loginUrl = `https://${brand.rootDomain}/login?next=${encodeURIComponent(selfUrl)}`
    return (
      <Shell base={base}>
        <div style={gateCard}>
          <p style={{ color: RED, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 11, margin: 0 }}>
            Practice floor
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '10px 0 8px' }}>Log in to step on the floor.</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
            The floor uses your Virtual Closer workspace login. Sign in once and you&rsquo;re live —
            sessions, scores, and history all land in your account.
          </p>
          <a href={loginUrl} style={ctaBtn}>Log in →</a>
        </div>
      </Shell>
    )
  }

  if (!ROLEPLAY_ENABLED) {
    return (
      <Shell base={base}>
        <div style={gateCard}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 8px' }}>The floor opens soon.</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Roleplay isn&rsquo;t switched on for this environment yet. If you&rsquo;re seeing this in
            production, ping support — the flag is a one-line flip.
          </p>
        </div>
      </Shell>
    )
  }

  const entitled = await canPractice(auth.tenant, auth.member)
  if (!entitled) {
    return (
      <Shell base={base}>
        <div style={gateCard}>
          <p style={{ color: RED, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 11, margin: 0 }}>
            Add-on required
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: '10px 0 8px' }}>
            Roleplay isn&rsquo;t on your build yet.
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
            The AI Trainer is pay-as-you-go — $0.25 a minute of live practice, drawn from your
            team&rsquo;s AI wallet only while you&rsquo;re on a call. Ask your account
            owner to turn it on, or reach out and we&rsquo;ll flip it for your team today.
          </p>
          <a href={`https://${brand.rootDomain}/offer`} style={ctaBtn}>See pricing →</a>
        </div>
      </Shell>
    )
  }

  // Only expose personas that actually have a live number wired.
  const personas = TRAINER_PERSONAS.filter((p) => personaAgent(p).agentNumber).map((p) => ({
    key: p.key,
    name: p.name,
    headline: p.headline,
    blurb: p.blurb,
    difficulty: p.difficulty,
  }))
  // Application-mode scenarios light up once their RevRing agents are
  // provisioned and the *_NUMBER env vars are set.
  const appScenarios = APPLICATION_SCENARIOS.filter((s) => personaAgent(s).agentNumber).map((s) => ({
    key: s.key,
    name: s.name,
    headline: s.headline,
    blurb: s.blurb,
    difficulty: s.difficulty,
  }))

  return (
    <Shell base={base}>
      <Floor personas={personas} appScenarios={appScenarios} memberName={auth.member.display_name} />
    </Shell>
  )
}

function Shell({ base, children }: { base: string; children: React.ReactNode }) {
  return (
    <main style={{ background: '#0f0f0f', color: '#fff', minHeight: '100vh' }}>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px clamp(16px, 5vw, 56px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Link href={base || '/roleplay'} style={{ textDecoration: 'none', color: '#fff', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 900, fontSize: 16 }}>
            VIRTUAL<span style={{ color: RED }}>CLOSER</span>
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: RED,
            }}
          >
            Roleplay floor
          </span>
        </Link>
      </nav>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: 'clamp(24px, 4vw, 48px) clamp(16px, 5vw, 56px) 70px' }}>
        {children}
      </div>
    </main>
  )
}

const gateCard: React.CSSProperties = {
  maxWidth: 520,
  margin: '10vh auto 0',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 16,
  padding: '28px 28px 26px',
  background: 'linear-gradient(160deg, #1c1c1c 0%, #141414 100%)',
}

const ctaBtn: React.CSSProperties = {
  display: 'inline-block',
  background: RED,
  color: '#fff',
  fontWeight: 800,
  fontSize: 14,
  padding: '12px 22px',
  borderRadius: 10,
  textDecoration: 'none',
}
