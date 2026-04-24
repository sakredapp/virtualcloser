import Link from 'next/link'
import { TIER_INFO } from '@/lib/onboarding'

export const dynamic = 'force-static'

type TierKey = 'starter' | 'pro' | 'space_station'

type PitchBlock = {
  included: string[]
  timeSavedHours: number
  moneySavedPerMo: number
  vaCost: number
  idealFor: string
}

const PITCH: Record<TierKey, PitchBlock> = {
  starter: {
    idealFor: 'Solo closers and small teams who just need the follow-up to actually happen.',
    included: [
      'Hosted AI sales assistant on your own branded sub-domain',
      'Daily morning scan of your leads + prioritized hot list',
      'Drafted follow-up emails ready to approve — no blank page',
      'Dormant-lead reactivation (nothing ever falls through the cracks)',
      'Slack or email alerts when a deal goes hot',
      'Brain-dump page: talk to it, it turns it into tasks and notes',
    ],
    timeSavedHours: 10,
    moneySavedPerMo: 1800,
    vaCost: 1600,
  },
  pro: {
    idealFor: 'Closers running a real pipeline who want their CRM to stop being a graveyard.',
    included: [
      'Everything in Starter',
      'HubSpot or Pipedrive sync — your CRM stays the source of truth',
      'Email provider connection (Gmail / Outlook) for one-click send',
      'Custom objection + playbook tuning to your voice',
      'Weekly pipeline review in plain English',
      'Priority support + monthly optimization call',
    ],
    timeSavedHours: 20,
    moneySavedPerMo: 4200,
    vaCost: 3200,
  },
  space_station: {
    idealFor: 'Teams who want an AI SDR that feels like a hire, not a tool.',
    included: [
      'Everything in Pro',
      'Dedicated infrastructure + isolated data',
      'Bring-your-own AI keys (full control of usage and cost)',
      'Custom workflows built for your sales motion',
      'Team dashboards + per-rep coaching notes',
      'SLA, onboarding white-glove, quarterly strategy reviews',
    ],
    timeSavedHours: 40,
    moneySavedPerMo: 9000,
    vaCost: 6500,
  },
}

export default function OfferPage() {
  const tiers: TierKey[] = ['starter', 'pro', 'space_station']

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Virtual Closer</p>
        <h1>An AI sales assistant that actually closes loops.</h1>
        <p className="sub">
          Hosted. Managed. On your own brand. Built so the follow-up you keep meaning to do
          happens automatically — and the deals you forgot about come back to life.
        </p>
        <p className="nav">
          <Link href="mailto:hello@virtualcloser.com?subject=Kickoff%20call">Book a kickoff call</Link>
          <span>·</span>
          <Link href="/demo">See the live demo →</Link>
          <span>·</span>
          <Link href="mailto:hello@virtualcloser.com?subject=Questions">Ask a question</Link>
        </p>
      </header>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>What you actually get</h2>
          <p>every tier</p>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">A closer that never forgets</p><p className="meta">Every lead is scanned, scored, and surfaced. No one slips.</p></div></li>
          <li className="row"><div><p className="name">Drafts, not blank pages</p><p className="meta">Your approval queue is already written — you hit send or tweak.</p></div></li>
          <li className="row"><div><p className="name">Dormant deals come back</p><p className="meta">Re-engagement sequences fire on deals you&apos;d already written off.</p></div></li>
          <li className="row"><div><p className="name">Talk to it like a human</p><p className="meta">Brain-dump by voice. It turns your ramble into tasks, goals, ideas.</p></div></li>
          <li className="row"><div><p className="name">Your brand, your sub-domain</p><p className="meta">yourname.virtualcloser.com — or your own domain on request.</p></div></li>
        </ul>
      </section>

      <section className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {tiers.map((t) => {
          const info = TIER_INFO[t]
          const pitch = PITCH[t]
          return (
            <article key={t} className="card">
              <div className="section-head">
                <h2>{info.label}</h2>
                <p>${info.monthly}/mo</p>
              </div>
              <p className="meta">{pitch.idealFor}</p>
              <p className="subject" style={{ marginTop: '0.7rem' }}>
                One-time build: ${info.build[0].toLocaleString()}–${info.build[1].toLocaleString()}
              </p>

              <ul className="list" style={{ maxHeight: 'none', marginTop: '0.6rem' }}>
                {pitch.included.map((line) => (
                  <li key={line} className="row">
                    <div>
                      <p className="name" style={{ fontWeight: 500 }}>{line}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="section-head" style={{ marginTop: '0.9rem' }}>
                <h2 style={{ fontSize: '0.95rem' }}>The math</h2>
              </div>
              <ul className="list" style={{ maxHeight: 'none' }}>
                <li className="row">
                  <div>
                    <p className="name">~{pitch.timeSavedHours} hrs / week saved</p>
                    <p className="meta">On follow-ups, note-taking, and pipeline hygiene.</p>
                  </div>
                </li>
                <li className="row">
                  <div>
                    <p className="name">~${pitch.moneySavedPerMo.toLocaleString()} / mo revenue recovered</p>
                    <p className="meta">From deals that would have gone cold.</p>
                  </div>
                </li>
                <li className="row">
                  <div>
                    <p className="name">A VA doing this: ~${pitch.vaCost.toLocaleString()} / mo</p>
                    <p className="meta">Before training, mistakes, and turnover.</p>
                  </div>
                </li>
                <li className="row">
                  <div>
                    <p className="name" style={{ color: 'var(--gold)' }}>
                      You pay ${info.monthly}/mo + one-time build.
                    </p>
                    <p className="meta">That&apos;s it. No seat fees. No per-lead fees.</p>
                  </div>
                </li>
              </ul>

              <div style={{ marginTop: '0.9rem' }}>
                <Link
                  className="btn approve"
                  href={`mailto:hello@virtualcloser.com?subject=${encodeURIComponent(`${info.label} tier`)}`}
                  style={{ textDecoration: 'none', display: 'inline-block' }}
                >
                  Start on {info.label}
                </Link>
              </div>
            </article>
          )
        })}
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>How it works</h2>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">1. Kickoff call</p><p className="meta">We learn your ICP, your voice, your objections, your CRM.</p></div></li>
          <li className="row"><div><p className="name">2. Build week</p><p className="meta">We spin up your sub-domain, import your leads, tune the playbook.</p></div></li>
          <li className="row"><div><p className="name">3. Go live</p><p className="meta">You start approving drafts on day one. We stay on to tune.</p></div></li>
          <li className="row"><div><p className="name">4. Monthly care</p><p className="meta">We watch it, improve it, and keep it profitable. You just close.</p></div></li>
        </ul>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        © Virtual Closer · An AI assistant that pays for itself.
      </footer>
    </main>
  )
}
