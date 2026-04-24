import Link from 'next/link'
import { TIER_INFO } from '@/lib/onboarding'

export const dynamic = 'force-static'

type TierKey = 'salesperson' | 'team_builder' | 'executive'

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

function bookHref(tier: TierKey, label: string): string {
  const url = new URL(CAL_BOOKING_URL)
  url.searchParams.set('tier', tier)
  url.searchParams.set('metadata[tier]', tier)
  url.searchParams.set('metadata[tierLabel]', label)
  return url.toString()
}

type PitchBlock = {
  included: string[]
  timeSavedHours: number
  moneySavedPerMo: number
  vaCost: number
  idealFor: string
}

const PITCH: Record<TierKey, PitchBlock> = {
  salesperson: {
    idealFor: 'Solo closers who want a voice-first personal assistant that runs their day.',
    included: [
      'Hosted on your own branded sub-domain',
      'Voice AI you talk to like Jarvis — set targets, create tasks, log calls, brain-dump',
      'Telegram bot: text or voice-note on the go, it writes straight to your CRM',
      'Calendar + meetings + no-show tracking — one tap to mark and reschedule',
      'Daily AI scan of your pipeline + prioritized follow-ups ready to approve',
      'Tasks auto-route to your dashboard and your calendar',
    ],
    timeSavedHours: 10,
    moneySavedPerMo: 1800,
    vaCost: 1600,
  },
  team_builder: {
    idealFor: 'Closers running a real pipeline who want cleaner data and more signal.',
    included: [
      'Everything in Salesperson',
      'HubSpot or Pipedrive sync — your CRM stays the source of truth',
      'Gmail / Outlook connection for one-click approve + send',
      'Call transcript capture (Fathom / Fireflies) attached to each deal',
      'Custom objection + playbook tuning to your voice',
      'Weekly pipeline review in plain English',
      'Priority support + monthly optimization call',
    ],
    timeSavedHours: 20,
    moneySavedPerMo: 4200,
    vaCost: 3200,
  },
  executive: {
    idealFor: 'Operators running teams who need a revenue + momentum command center.',
    included: [
      'Everything in Team Builder',
      'Team / manager / rep / fulfillment-partner hierarchy',
      'Revenue + momentum rollups across every team, live',
      'Per-team health scoring from CRM data + call intelligence (Fathom / Gong)',
      'Deal velocity + call-quality tied together — see where momentum is leaking',
      'Manager + fulfillment-partner oversight views (discussions, SLAs, handoffs)',
      'Dedicated infra + isolated data + BYOK AI keys',
      'SLA, white-glove onboarding, quarterly strategy reviews',
    ],
    timeSavedHours: 40,
    moneySavedPerMo: 9000,
    vaCost: 6500,
  },
}

export default function OfferPage() {
  const tiers: TierKey[] = ['salesperson', 'team_builder', 'executive']

  return (
    <main className="wrap">
      <header className="hero">
        <h1>An AI sales assistant that actually closes loops.</h1>
        <p className="sub">
          VAs are outdated. SOPs suck. You don&apos;t have the time — and neither does
          your team. Your personal Jarvis runs the follow-up, babysits the pipeline, and
          revives dormant deals automatically — so your business runs as smooth as a Ferrari.
        </p>
        <p className="nav">
          <Link href={CAL_BOOKING_URL}>Book a kickoff call</Link>
          <span>·</span>
          <Link href="/demo">See the live demo →</Link>
          <span>·</span>
          <Link href="mailto:hello@virtualcloser.com?subject=Questions">Ask a question</Link>
        </p>
      </header>

      <section className="card" style={{ marginBottom: '0.8rem', background: 'var(--royal-soft)', borderColor: 'var(--royal-ring)' }}>
        <div className="section-head">
          <h2>No swipe-and-pray. Every client starts with a call.</h2>
        </div>
        <p className="meta" style={{ marginTop: '0.4rem' }}>
          We build this <em>for</em> you — your voice, your CRM, your pipeline. That means we
          actually talk first. Pick a 30-minute slot, we qualify fit, and if we&apos;re a match
          we kick off the build on the call.
        </p>
        <div style={{ marginTop: '0.8rem' }}>
          <Link
            className="btn approve"
            href={CAL_BOOKING_URL}
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Book your 30-min kickoff call →
          </Link>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <details className="collapse">
          <summary>What you actually get</summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            <li className="row"><div><p className="name">A closer that never forgets</p><p className="meta">Every lead, meeting, and task is scanned, scored, and surfaced. Nothing slips.</p></div></li>
            <li className="row"><div><p className="name">Talk to it like Jarvis</p><p className="meta">Voice-powered AI. Brain-dump, set targets, create tasks, check momentum — hands-free.</p></div></li>
            <li className="row"><div><p className="name">Telegram in, CRM out</p><p className="meta">Text or voice-note the bot from anywhere. It updates your CRM for you. No app-switching.</p></div></li>
            <li className="row"><div><p className="name">Drafts, not blank pages</p><p className="meta">Your approval queue is already written — you hit send or tweak.</p></div></li>
            <li className="row"><div><p className="name">Your brand, your sub-domain</p><p className="meta">yourname.virtualcloser.com — or your own domain on request.</p></div></li>
          </ul>
        </details>
      </section>

      <section className="grid-3">
        {tiers.map((t) => {
          const info = TIER_INFO[t]
          const pitch = PITCH[t]
          return (
            <article key={t} className="card tier-card">
              <div className="section-head">
                <h2>{info.label}</h2>
                <p>${info.monthly}/mo</p>
              </div>
              <p className="meta">{pitch.idealFor}</p>
              <p className="subject" style={{ marginTop: '0.7rem' }}>
                One-time build: ${info.build[0].toLocaleString()}–${info.build[1].toLocaleString()}
              </p>

              <p className="name" style={{ color: 'var(--red)', marginTop: '0.8rem' }}>
                You pay ${info.monthly}/mo + one-time build.
              </p>
              <p className="meta">No seat fees. No per-lead fees.</p>

              <details className="collapse" style={{ marginTop: '0.8rem' }}>
                <summary>What&apos;s included ({pitch.included.length})</summary>
                <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
                  {pitch.included.map((line) => (
                    <li key={line} className="row">
                      <div>
                        <p className="name" style={{ fontWeight: 500 }}>{line}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>

              <details className="collapse" style={{ marginTop: '0.5rem' }}>
                <summary>The math</summary>
                <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
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
                </ul>
              </details>

              <div style={{ marginTop: '1rem' }}>
                <Link
                  className="btn approve"
                  href={bookHref(t, info.label)}
                  style={{ textDecoration: 'none', display: 'inline-block' }}
                >
                  Book a call about {info.label} →
                </Link>
                <p className="meta" style={{ marginTop: '0.4rem' }}>
                  30-min kickoff. No card required to book.
                </p>
              </div>
            </article>
          )
        })}
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse" open>
          <summary>How it works</summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            <li className="row"><div><p className="name">1. Kickoff call</p><p className="meta">We learn your ICP, your voice, your objections, your CRM.</p></div></li>
            <li className="row"><div><p className="name">2. Build week</p><p className="meta">We spin up your sub-domain, import your leads, tune the playbook.</p></div></li>
            <li className="row"><div><p className="name">3. Go live</p><p className="meta">You start approving drafts on day one. We stay on to tune.</p></div></li>
            <li className="row"><div><p className="name">4. Monthly care</p><p className="meta">We watch it, improve it, and keep it profitable. You just close.</p></div></li>
          </ul>
        </details>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        © Virtual Closer · An AI assistant that pays for itself.
        {' · '}
        <Link href="/privacy" style={{ color: 'inherit' }}>Privacy</Link>
        {' · '}
        <Link href="/terms" style={{ color: 'inherit' }}>Terms</Link>
      </footer>
    </main>
  )
}
