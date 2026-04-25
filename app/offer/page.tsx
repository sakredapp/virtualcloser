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
    idealFor: 'Replaces your virtual assistant. Solo operators who need a full-time AI hire running their day, not another app to log into.',
    included: [
      'Your own AI employee on your own branded sub-domain',
      'Talk to it like a hire — set targets, assign tasks, log calls, brain-dump',
      'Telegram in, work out: text or voice-note from anywhere, it does the writing',
      'Calendar, meetings, and no-show follow-up handled — not just tracked',
      'Daily prep brief + prioritized actions waiting when you sit down',
      'Drafts every follow-up, every reschedule, every note — you approve',
    ],
    timeSavedHours: 10,
    moneySavedPerMo: 1800,
    vaCost: 1600,
  },
  team_builder: {
    idealFor: 'Replaces your executive assistant + a junior ops hire. Operators who want one AI employee handling pipeline, inbox, and meetings end-to-end.',
    included: [
      'Everything in Salesperson',
      'Self-serve integrations page — pipe leads in from any CRM via Zapier (HubSpot, Pipedrive, Salesforce, Sheets, Notion, Calendly...)',
      'HubSpot or Pipedrive deep sync — your CRM stays the source of truth',
      'Gmail / Outlook connection — drafts, sends, and files for you',
      'Sits in your meetings (Fathom / Fireflies), pulls actions, files notes per deal',
      'Custom playbook + objection library tuned to your voice',
      'Weekly business review in plain English — what moved, what stalled',
      'Priority support + monthly optimization call',
    ],
    timeSavedHours: 20,
    moneySavedPerMo: 4200,
    vaCost: 3200,
  },
  executive: {
    idealFor: 'Replaces a chief of staff + ops manager + analyst stack. Operators running teams who need an AI employee per rep plus a command center on top.',
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
        <p
          className="eyebrow"
          style={{ fontStyle: 'italic', letterSpacing: '0.14em', opacity: 0.9 }}
        >
          &ldquo;Jarvis, you up?&rdquo; &nbsp;—&nbsp; &ldquo;For you, Sir, always.&rdquo;
        </p>
        <h1>The engine that drives your business.</h1>
        <p className="sub">
          A personal AI sidekick — your Jarvis — wired into your pipeline, your inbox, your
          calendar, your call recordings. It runs follow-ups, takes notes, reschedules
          no-shows, revives dormant deals, and briefs you every morning. Trained on your
          voice. Built for you, not licensed to you. No seats, no SOPs, no turnover.
        </p>
        <p className="nav">
          <Link href={CAL_BOOKING_URL}>Book a kickoff call</Link>
          <span>·</span>
          <Link href="/demo">See the live demo →</Link>
          <span>·</span>
          <Link href="mailto:hello@virtualcloser.com?subject=Questions">Ask a question</Link>
        </p>
      </header>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
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
            style={{ textDecoration: 'none' }}
          >
            Book your 30-min kickoff call →
          </Link>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <details className="collapse">
          <summary>The job description (what your AI hire actually does)</summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            <li className="row"><div><p className="name">Inbox + scheduling assistant</p><p className="meta">Drafts replies, books meetings, handles reschedules and no-shows. The EA work, without the EA.</p></div></li>
            <li className="row"><div><p className="name">Note-taker + meeting follow-through</p><p className="meta">Sits in your calls, captures actions, files them against the right contact and deal.</p></div></li>
            <li className="row"><div><p className="name">Pipeline + ops hygiene</p><p className="meta">Scans every lead and task daily. Surfaces what&apos;s slipping. Revives dormant deals on its own.</p></div></li>
            <li className="row"><div><p className="name">Talk to it like a hire</p><p className="meta">Voice or Telegram, anywhere. Brain-dump, assign tasks, ask for the day&apos;s brief — no app-switching.</p></div></li>
            <li className="row"><div><p className="name">Drafts everything, ships on approval</p><p className="meta">You don&apos;t write follow-ups anymore. You hit send.</p></div></li>
            <li className="row"><div><p className="name">Branded as yours</p><p className="meta">yourname.virtualcloser.com — or your own domain. It&apos;s your hire, not a SaaS logo.</p></div></li>
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
                One-time build: ${info.build[0].toLocaleString()}
                {t === 'executive' ? '+' : ''}
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
                      <p className="name">A human doing this role: ~${pitch.vaCost.toLocaleString()} / mo</p>
                      <p className="meta">VA + EA + ops time, before training, mistakes, sick days, and turnover.</p>
                    </div>
                  </li>
                </ul>
              </details>

              <div style={{ marginTop: '1rem' }}>
                <Link
                  className="btn approve"
                  href={bookHref(t, info.label)}
                  style={{ textDecoration: 'none' }}
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
        <div className="section-head">
          <h2>Enterprise — for whole sales teams</h2>
          <p>Custom · bulk pricing</p>
        </div>
        <p className="meta" style={{ marginTop: '0.4rem' }}>
          Already running a sales team or sales org? We&apos;ll build Virtual Closer for the
          whole team — every rep, every manager, your fulfillment partners — on one
          deployment with shared playbooks, CRM, and rollups. Pricing scales with seats and
          comes with bulk discounts; we quote per engagement.
        </p>
        <ul className="list" style={{ maxHeight: 'none', marginTop: '0.6rem' }}>
          <li className="row"><div><p className="name">Everything in Executive, deployed across your team</p><p className="meta">Same command center, scaled to N reps + managers + partners.</p></div></li>
          <li className="row"><div><p className="name">Bulk seat pricing</p><p className="meta">The more reps, the lower the per-seat cost. We quote on the call.</p></div></li>
          <li className="row"><div><p className="name">Shared playbooks + objection libraries</p><p className="meta">Tune once, every rep speaks in the same voice with the same answers.</p></div></li>
          <li className="row"><div><p className="name">Org-level rollups + manager scorecards</p><p className="meta">See momentum, deal velocity, and call quality across every team and pod.</p></div></li>
          <li className="row"><div><p className="name">Dedicated build team + SLA</p><p className="meta">White-glove rollout, training, and ongoing optimization.</p></div></li>
        </ul>
        <div style={{ marginTop: '1rem' }}>
          <Link
            className="btn approve"
            href={bookHref('executive', 'Enterprise')}
            style={{ textDecoration: 'none' }}
          >
            Talk to us about an Enterprise build →
          </Link>
          <p className="meta" style={{ marginTop: '0.4rem' }}>
            30-min scoping call. We&apos;ll quote bulk pricing after we understand the team size and motion.
          </p>
        </div>
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

      <footer style={{ color: 'var(--muted-inv)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        © Virtual Closer · An AI assistant that pays for itself.
        {' · '}
        <Link href="/privacy" style={{ color: 'inherit' }}>Privacy</Link>
        {' · '}
        <Link href="/terms" style={{ color: 'inherit' }}>Terms</Link>
      </footer>
    </main>
  )
}
