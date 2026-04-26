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
          Stop wasting time training humans to do basic tasks. Send voice-to-text updates,
          schedule follow-ups, and brain dump from anywhere — just communicate with your
          own Jarvis on Telegram in real time and let it update your dashboard for you.
          The best tech to grow revenue with ease.
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
          <h2>Who sees what — every seat in the org</h2>
          <p>Role-based by design</p>
        </div>
        <p className="meta" style={{ marginTop: '0.3rem' }}>
          Salesperson tier ships with one seat (you). Team Builder and Executive add the
          full hierarchy below — every member gets their own dashboard, their own Telegram
          link code, and their own permissions. Reps never see other reps&rsquo; data.
        </p>

        <div className="role-grid" style={{ marginTop: '0.9rem' }}>
          {/* Owner */}
          <article className="role-card">
            <span className="role-tag">Owner</span>
            <h3>You — the account holder</h3>
            <p className="role-tagline">Full keys to the building. Billing, branding, every team, every rep.</p>
            <ul>
              <li>Sees every team&rsquo;s leaderboard + every rep&rsquo;s page</li>
              <li>Sets account-wide goals (everyone in the company)</li>
              <li>Adds &amp; removes members, assigns managers</li>
              <li>Owns billing, brand, integrations, API keys</li>
              <li>Receives the rolled-up morning brief</li>
            </ul>
          </article>

          {/* Manager */}
          <article className="role-card">
            <span className="role-tag">Manager</span>
            <h3>Team lead</h3>
            <p className="role-tagline">Owns the number for their team. Coaches via Telegram, doesn&rsquo;t chase reps for updates.</p>
            <ul>
              <li>Leaderboard for the team(s) they manage</li>
              <li>Sets team goals from UI <em>or</em> Telegram (&ldquo;team goal: 200 calls this week&rdquo;)</li>
              <li>Goal auto-pings every rep on Telegram the moment it&rsquo;s set</li>
              <li>Sees rollups: team total + per-rep contribution, live</li>
              <li className="no">No billing, no other teams</li>
            </ul>
          </article>

          {/* Rep */}
          <article className="role-card">
            <span className="role-tag">Rep</span>
            <h3>Closer / SDR</h3>
            <p className="role-tagline">Their own AI employee. Telegram in, work out — voice notes from the car, dashboard at the desk.</p>
            <ul>
              <li>Personal dashboard at <code style={{ fontSize: '0.8rem' }}>/u/their-name</code></li>
              <li>Their own 8-char Telegram link code</li>
              <li>Sees own goals + team goals they belong to</li>
              <li>Daily morning brief + EOD progress prompt</li>
              <li className="no">No other reps&rsquo; pipelines or numbers</li>
            </ul>
          </article>

          {/* Observer */}
          <article className="role-card">
            <span className="role-tag">Observer</span>
            <h3>Fulfillment / analyst</h3>
            <p className="role-tagline">Read-only seat for partners, RevOps, or coaches who need visibility but don&rsquo;t close.</p>
            <ul>
              <li>Read-only across assigned team(s)</li>
              <li>Sees leaderboards, goals, deal velocity</li>
              <li>Optional Telegram digest, no inbound commands</li>
              <li className="no">Can&rsquo;t edit leads, set goals, or send email</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>A day in your AI employee&rsquo;s life</h2>
          <p>Real flows, by tier</p>
        </div>
        <p className="meta">
          Every example below is a real flow already shipping in the app — Telegram in,
          dashboard updates out. Times shown in your local time.
        </p>

        <details className="collapse" style={{ marginTop: '0.6rem' }} open>
          <summary>Salesperson — solo operator</summary>
          <div className="timeline">
            <div className="tl-row">
              <div className="tl-time">7:30 AM</div>
              <div className="tl-dot">☀️</div>
              <div className="tl-body">
                <p className="who">Morning brief lands on Telegram</p>
                <p className="what">Hot prospects, overdue follow-ups, today&rsquo;s tasks, your goal pace — all in one push. No app to open.</p>
                <div className="tg-chat">
                  <div className="tg-bubble"><strong>Morning brief — Acme Sales</strong><br />🔥 3 hot · 📅 4 due today · 🎯 calls 18/50 (week)</div>
                </div>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">8:45 AM</div>
              <div className="tl-dot">🎙</div>
              <div className="tl-body">
                <p className="who">Voice note from the car</p>
                <p className="what">You hold the mic and talk like you would to an EA. Bot transcribes, parses intent, and writes everything down.</p>
                <div className="tg-chat">
                  <div className="tg-bubble me">&ldquo;Just got off with Dana at Northwind — she&rsquo;s hot, wants a demo Thursday at 3, follow up tomorrow about pricing.&rdquo;</div>
                  <div className="tg-bubble">✅ Updated <strong>Dana Reyes</strong> → status hot · 📅 booked Demo Thursday 3:00 PM · ➕ task: &ldquo;send pricing&rdquo; due tomorrow</div>
                </div>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">11:30 AM</div>
              <div className="tl-dot">🎯</div>
              <div className="tl-body">
                <p className="who">Set a goal in plain English</p>
                <p className="what">No menu-diving. Tell it the number and the period.</p>
                <div className="tg-chat">
                  <div className="tg-bubble me">&ldquo;Goal: 50 calls this week.&rdquo;</div>
                  <div className="tg-bubble">🎯 Target locked in: <strong>50 calls</strong> this week.</div>
                </div>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">3:30 PM</div>
              <div className="tl-dot">📨</div>
              <div className="tl-body">
                <p className="who">Drafts queued in your dashboard</p>
                <p className="what">Every follow-up is pre-written in your voice. You hit Approve, Resend sends. You don&rsquo;t open Gmail.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">10:00 PM</div>
              <div className="tl-dot">📊</div>
              <div className="tl-body">
                <p className="who">EOD check-in</p>
                <p className="what">Bot pings you for the day&rsquo;s number. Reply in plain English; goals update automatically.</p>
                <div className="tg-chat">
                  <div className="tg-bubble">📊 End-of-day check-in — how&rsquo;d today go?</div>
                  <div className="tg-bubble me">&ldquo;Logged 12 calls today, 2 booked.&rdquo;</div>
                  <div className="tg-bubble">✅ Logged. Calls 30/50 this week, meetings booked 6.</div>
                </div>
              </div>
            </div>
          </div>
        </details>

        <details className="collapse">
          <summary>Team Builder — small team with a manager</summary>
          <div className="timeline">
            <div className="tl-row">
              <div className="tl-time">8:00 AM</div>
              <div className="tl-dot">📣</div>
              <div className="tl-body">
                <p className="who">Manager sets the team number — from anywhere</p>
                <p className="what">UI <em>or</em> Telegram. Bot fans the message out to every rep on the team.</p>
                <div className="tg-chat">
                  <div className="tg-bubble me">&ldquo;Team goal: 200 calls this week for the Closers team.&rdquo;</div>
                  <div className="tg-bubble">🎯 Team goal locked in: <strong>200 calls</strong> this week for the Closers team. Pinged 4 members.</div>
                </div>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">8:00 AM</div>
              <div className="tl-dot">📲</div>
              <div className="tl-body">
                <p className="who">Every rep gets the same ping</p>
                <p className="what">No standup. No &ldquo;did everyone see the email&rdquo;. Reps wake up to the goal and the &ldquo;reply with progress&rdquo; loop.</p>
                <div className="tg-chat">
                  <div className="tg-bubble">📣 <strong>New goal from Alex</strong> — the <em>Closers</em> team<br />🎯 200 calls this week<br /><br />Every call you log rolls into the team total automatically.</div>
                </div>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">9–5</div>
              <div className="tl-dot">📞</div>
              <div className="tl-body">
                <p className="who">Reps log work, the rollup updates live</p>
                <p className="what">Each rep&rsquo;s morning brief shows team total + their contribution. Manager dashboard shows the same, with a leaderboard underneath.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">5:30 PM</div>
              <div className="tl-dot">📈</div>
              <div className="tl-body">
                <p className="who">Manager sees the gap, not the noise</p>
                <p className="what">Live progress bar on /dashboard/team/goals. If the team is behind pace, the bot flags it in the morning brief — no spreadsheet required.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">10:00 PM</div>
              <div className="tl-dot">📊</div>
              <div className="tl-body">
                <p className="who">EOD prompt fires for every rep</p>
                <p className="what">Each rep gets their own check-in DM. Replies update both their personal numbers and the team rollup.</p>
              </div>
            </div>
          </div>
        </details>

        <details className="collapse">
          <summary>Executive — multi-team org with API + integrations</summary>
          <div className="timeline">
            <div className="tl-row">
              <div className="tl-time">Mon AM</div>
              <div className="tl-dot">🏛</div>
              <div className="tl-body">
                <p className="who">Owner sets the account number</p>
                <p className="what">&ldquo;Account goal: 1,000 calls this week&rdquo; — bot fans out to every team, every member, every Telegram chat. One message replaces a kickoff meeting.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">Mon-Fri</div>
              <div className="tl-dot">🔌</div>
              <div className="tl-body">
                <p className="who">CRM &amp; call intel feed in automatically</p>
                <p className="what">HubSpot / Pipedrive deep sync, Fathom / Fireflies call notes, Gmail / Outlook send-as. The AI works on the data your team is already producing.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">Daily</div>
              <div className="tl-dot">🎚</div>
              <div className="tl-body">
                <p className="who">Per-team rollups, per-rep accountability</p>
                <p className="what">Managers run their teams. Owners watch the org. Observers (RevOps, fulfillment partners) get read-only digests of the teams they support.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">Anytime</div>
              <div className="tl-dot">🛠</div>
              <div className="tl-body">
                <p className="who">API + webhooks + BYOK keys</p>
                <p className="what">Push leads in from any system, pull KPIs out into your data warehouse, run the AI on your own Anthropic / OpenAI key. Your data, your infra, our brain.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">Quarterly</div>
              <div className="tl-dot">🤝</div>
              <div className="tl-body">
                <p className="who">Strategy review with our team</p>
                <p className="what">We sit with leadership, review what worked, retune the playbook, and ship custom workflows. White-glove, with an SLA.</p>
              </div>
            </div>
          </div>
        </details>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>How a goal flows — from leadership to closed-won</h2>
          <p>Set once, the bot runs the loop</p>
        </div>
        <p className="meta">
          Same five-step loop on every tier. The only thing that changes is who&rsquo;s
          allowed to set the goal and who gets pinged.
        </p>
        <div className="flow">
          <div className="flow-step">
            <span className="num">Step 1</span>
            <h4>Goal is set</h4>
            <p>Manager (UI or Telegram) for a team · Owner for the whole account · Rep for personal.</p>
          </div>
          <div className="flow-step">
            <span className="num">Step 2</span>
            <h4>Telegram broadcast</h4>
            <p>Every member in scope gets a personal DM with the goal and how to log progress.</p>
          </div>
          <div className="flow-step">
            <span className="num">Step 3</span>
            <h4>Reps log naturally</h4>
            <p>Voice notes, &ldquo;closed Dana&rdquo;, dashboard clicks — all roll into the same total.</p>
          </div>
          <div className="flow-step">
            <span className="num">Step 4</span>
            <h4>Live rollup</h4>
            <p>Team total + per-rep contribution + percent-of-target, recalculated on every event.</p>
          </div>
          <div className="flow-step">
            <span className="num">Step 5</span>
            <h4>Daily reinforcement</h4>
            <p>Morning brief shows pace; EOD check-in collects today&rsquo;s number from each rep.</p>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>What you actually get at each tier</h2>
          <p>Side-by-side, no fine print</p>
        </div>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>Capability</th>
                <th className="tier-col">Salesperson</th>
                <th className="tier-col">Team Builder</th>
                <th className="tier-col">Executive</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="feat">Branded sub-domain<p className="meta">yourname.virtualcloser.com</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Telegram bot — voice + text<p className="meta">Per-member link code on every seat</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Daily morning brief + EOD prompt<p className="meta">Personal goals &amp; team goals in the same DM</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Lead + call + brain-item CRM<p className="meta">Built-in, no extra tool needed</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Email follow-ups via Resend<p className="meta">Drafts in your voice, sends on Approve</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Google Calendar booking<p className="meta">Conflict-aware; books from a voice note</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Google Sheets CRM bridge<p className="meta">Smart upsert, alias-matched columns</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Multi-member workspace<p className="meta">Owner + admin + manager + rep + observer</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Manager UI: set team / account goals<p className="meta">Plus conversational team goals over Telegram</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Team leaderboard + per-rep pages<p className="meta">/dashboard/team and /u/&lt;rep&gt;</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">HubSpot / Pipedrive deep sync<p className="meta">Two-way, your CRM stays the source of truth</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Gmail / Outlook send-as<p className="meta">Replies file back into the right deal</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Fathom / Fireflies call intel<p className="meta">Notes, actions, objections — auto-filed</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Custom playbook + objection library<p className="meta">Tuned in your voice every quarter</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Zapier / inbound webhooks<p className="meta">Push leads from anything that talks HTTP</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Voice-memo feedback loop<p className="meta">Rep <code>/pitch &lt;manager&gt;</code> names ONE recipient &mdash; no fan-out, no group-chat noise</p></td><td className="tier-col no">○</td><td className="tier-col partial">add-on</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Now / Later inline keyboard on every pitch<p className="meta">Manager taps *Now* to voice-reply or *Later* to defer &mdash; rep is told either way</p></td><td className="tier-col no">○</td><td className="tier-col partial">add-on</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Later &rarr; auto-task on manager&rsquo;s dashboard<p className="meta">Snoozed pitches land in the brain as a high-priority task with a /dashboard/feedback link</p></td><td className="tier-col no">○</td><td className="tier-col partial">add-on</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Pitch archive + transcripts + search<p className="meta">Every pitch saved with a status (Ready / Needs work) you can filter and search</p></td><td className="tier-col no">○</td><td className="tier-col partial">add-on</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Multi-team rollups + observer seats<p className="meta">Org-wide momentum, manager scorecards</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Per-team / per-tenant branding<p className="meta">Logo + colors, optional custom domain</p></td><td className="tier-col no">○</td><td className="tier-col partial">add-on</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Public REST API + webhooks out<p className="meta">KPIs &amp; events into your warehouse / BI</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">BYOK AI keys + isolated infra<p className="meta">Your Anthropic / OpenAI keys, your data plane</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">SLA + quarterly strategy reviews<p className="meta">White-glove rollout &amp; ongoing tuning</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
            </tbody>
          </table>
        </div>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          ● included &nbsp;·&nbsp; ○ not on this tier &nbsp;·&nbsp; <em>add-on</em> available on request.
          Need something not on the list? Ask on the kickoff call — we&rsquo;ve built every
          one of these from a customer call.
        </p>
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
          <li className="row"><div><p className="name">Real-time voice-memo feedback loop</p><p className="meta">Reps <code>/pitch &lt;manager&gt;</code> over Telegram &mdash; the named manager is the only person who hears it. They tap *Now* to voice-reply or *Later* to push it onto their task list. Every pitch archived, transcribed, and searchable.</p></div></li>
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

      {/* ── Enterprise: Voice-memo feedback loop (the nucleus) ───────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>The real-time feedback nucleus</h2>
          <p>Why enterprise sales teams move faster on Virtual Closer</p>
        </div>
        <p className="meta" style={{ marginTop: '0.4rem' }}>
          Coaching at scale dies in DM threads. Reps wait days for a manager to weigh in
          on a pitch, voice memos get lost in scrollback, nobody can find what was said
          about which lead, and there&rsquo;s no clean signal for &ldquo;this lead is ready to pitch&rdquo;
          vs &ldquo;not yet.&rdquo; We rebuilt the loop end-to-end &mdash; all over Telegram and your dashboard.
        </p>

        <div className="role-grid" style={{ marginTop: '0.9rem' }}>
          <div className="role-card">
            <h3 className="role-title">❌ The pain</h3>
            <ul className="list" style={{ maxHeight: 'none' }}>
              <li className="row"><div><p className="name">Pitches lost in DM scrollback</p><p className="meta">No archive, no search, no audit trail.</p></div></li>
              <li className="row"><div><p className="name">Manager bottleneck on every pitch</p><p className="meta">Reps wait hours/days; momentum dies.</p></div></li>
              <li className="row"><div><p className="name">Feedback is text, slow, and tone-flat</p><p className="meta">Try teaching delivery in a 4-line iMessage.</p></div></li>
              <li className="row"><div><p className="name">No &ldquo;ready to pitch&rdquo; signal</p><p className="meta">Reps re-pitch leads the manager already vetoed.</p></div></li>
              <li className="row"><div><p className="name">Standups duplicate the same info</p><p className="meta">Coaching that should be 1:1 burns the whole team&rsquo;s morning.</p></div></li>
              <li className="row"><div><p className="name">No memory across reps or quarters</p><p className="meta">&ldquo;What did we say about Acme last month?&rdquo; — gone.</p></div></li>
            </ul>
          </div>
          <div className="role-card">
            <h3 className="role-title">✅ What we ship</h3>
            <ul className="list" style={{ maxHeight: 'none' }}>
              <li className="row"><div><p className="name"><code>/pitch &lt;manager&gt;</code> on Telegram</p><p className="meta">Rep names exactly one recipient and records a voice note. That&rsquo;s the whole interface.</p></div></li>
              <li className="row"><div><p className="name">Sent to one named recipient &mdash; never broadcast</p><p className="meta">Only the manager the rep names hears it. No group chats, no fan-out, no noise.</p></div></li>
              <li className="row"><div><p className="name">Manager taps Now or Later</p><p className="meta">Two buttons land under the pitch. *Now* &rarr; reply with a voice memo or text and the rep hears it instantly. *Later* &rarr; the pitch jumps onto the manager&rsquo;s task list and the rep is told they&rsquo;ll get to it shortly.</p></div></li>
              <li className="row"><div><p className="name">Rep is told what&rsquo;s happening, every step</p><p className="meta">&ldquo;Sara is reviewing now.&rdquo; &ldquo;Sara will get to it later &mdash; it&rsquo;s on her list.&rdquo; No more wondering if a pitch landed.</p></div></li>
              <li className="row"><div><p className="name">One-tap status: Ready / Needs work / Archived</p><p className="meta">Manager types <code>ready</code> or hits a button on the dashboard. Rep gets pinged instantly with the verdict.</p></div></li>
              <li className="row"><div><p className="name">Lead-level &ldquo;ready to pitch&rdquo; toggle</p><p className="meta">Leadership flags which leads are cleared to pitch &mdash; independent of any single memo. No more re-pitching dead leads.</p></div></li>
              <li className="row"><div><p className="name">Searchable archive, forever</p><p className="meta">Every pitch and every piece of feedback lives on the *Feedback* tab. Filter by rep, lead, status, or any word that was said.</p></div></li>
              <li className="row"><div><p className="name">Nothing rots</p><p className="meta">If a manager&rsquo;s queue gets stale, the bot pings them on Telegram so reps aren&rsquo;t left hanging.</p></div></li>
            </ul>
          </div>
        </div>

        <div className="flow" style={{ marginTop: '1rem' }}>
          <div className="flow-step"><div className="flow-num">1</div><div><p className="name">Rep sends <code>/pitch Sara about Dana Northwind</code></p><p className="meta">Names the one manager who should hear it.</p></div></div>
          <div className="flow-step"><div className="flow-num">2</div><div><p className="name">Rep records the voice note</p><p className="meta">Hold the mic on Telegram. That&rsquo;s it.</p></div></div>
          <div className="flow-step"><div className="flow-num">3</div><div><p className="name">Sara gets it with Now / Later buttons</p><p className="meta">Just her. Nobody else.</p></div></div>
          <div className="flow-step"><div className="flow-num">4</div><div><p className="name">Now &rarr; voice reply. Later &rarr; task on her list.</p><p className="meta">The rep is told either way.</p></div></div>
          <div className="flow-step"><div className="flow-num">5</div><div><p className="name">Rep hears feedback instantly</p><p className="meta">Plus the verdict and a link to the pitch on their dashboard.</p></div></div>
        </div>

        <p className="meta" style={{ marginTop: '0.8rem' }}>
          Available on Executive deployments and every Enterprise build. Ask about it on
          the scoping call — we&rsquo;ll show you the queue and walk a live pitch end-to-end.
        </p>
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
