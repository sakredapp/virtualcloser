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
      'Your own AI employee on your personal sub-domain (yourname.virtualcloser.com)',
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
    idealFor: 'Replaces your executive assistant + a junior ops hire. Operators who want one AI employee handling pipeline, inbox, and meetings end-to-end — wired into the tools you already use.',
    included: [
      'Everything in Salesperson',
      'Branded domain — runs on your company URL with your logo and colors, not ours',
      'Custom CRM integration — your AI employee plugs into the CRM you already run on, however you run it',
      'Gmail-connected follow-ups — drafts in your voice, you approve, it sends',
      'Sits in on your sales calls — pulls action items, objections, and notes back into the right deal',
      'Weekly business review in plain English — what moved, what stalled',
      'Priority support + monthly optimization call',
    ],
    timeSavedHours: 20,
    moneySavedPerMo: 4200,
    vaCost: 3200,
  },
  executive: {
    idealFor: 'Replaces a chief of staff + ops manager. Still a solo seat, but built deeper — we custom-wire it into the way you actually sell, instead of asking you to bend around the tool.',
    included: [
      'Everything in Team Builder',
      'Fully white-labeled — your domain, your branding, your team never sees ours',
      'Custom-built integrations — we wire your AI employee directly into your CRM, dialer, and fulfillment stack so day one feels like it grew up inside your business',
      'Tuned to how you sell — we sit with you to fit it to your pitch, your pipeline stages, and your numbers',
      'White-glove rollout + ongoing tuning — you focus on closing, we keep the engine sharp',
      'Quarterly strategy review with our team — what worked, what to ship next',
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

      {/* ── Two clear paths: solo seats vs whole team ───────────────── */}
      <section className="card" style={{ marginTop: '0.8rem', marginBottom: '0.6rem' }}>
        <div className="section-head">
          <h2>Two different products</h2>
        </div>
        <ol className="meta" style={{ marginTop: '0.3rem', paddingLeft: '1.2rem', display: 'grid', gap: '0.5rem' }}>
          <li>
            <strong>Individual seats</strong> (Salesperson / Team Builder / Executive) &mdash;
            for a single operator running their own pipeline. The integration depth is
            what changes between tiers.
          </li>
          <li>
            <strong>Enterprise</strong> &mdash; an entirely different product. We build
            the assistant nucleus for a whole sales org, with role hierarchy, private
            leadership rooms, voice-memo coaching, and account-wide rollups. It is not
            an upgrade of Executive &mdash; it is its own thing.
          </li>
        </ol>
        <p className="meta" style={{ marginTop: '0.5rem' }}>
          Pick the path that matches how you work today.
        </p>
      </section>

      <p className="eyebrow" style={{ marginTop: '0.4rem', marginBottom: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: '0.78rem' }}>
        Individual seats &mdash; one operator, one AI employee
      </p>
      <section className="grid-3">
        {tiers.map((t) => {
          const info = TIER_INFO[t]
          const pitch = PITCH[t]
          const isExec = t === 'executive'
          return (
            <article key={t} className="card tier-card">
              <h2 style={{ margin: 0 }}>{info.label}</h2>
              <p className="meta tier-desc">{pitch.idealFor}</p>

              {/* Clean structured price block */}
              <div className="tier-price">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1, color: 'var(--ink)' }}>
                    ${info.monthly}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>/ month</span>
                </div>
                <p style={{ margin: '0.4rem 0 0 0', color: 'var(--red)', fontWeight: 600, fontSize: '0.95rem' }}>
                  + ${info.build[0].toLocaleString()}{isExec ? '+' : ''} one-time build
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  No seat fees &middot; No per-lead fees
                </p>
              </div>

              <details className="collapse tier-collapse">
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

              <details className="collapse tier-collapse">
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

              <div className="tier-cta">
                <Link
                  className="btn approve"
                  href={bookHref(t, info.label)}
                  style={{ textDecoration: 'none' }}
                >
                  Book a call about {info.label} →
                </Link>
              </div>
            </article>
          )
        })}
      </section>

      {/* ── Enterprise: a separate product class, not an upgrade of Executive ── */}
      <p className="eyebrow" style={{ marginTop: '1.3rem', marginBottom: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: '0.78rem' }}>
        Enterprise &mdash; the assistant nucleus for a whole sales org
      </p>
      <section className="card" style={{ marginTop: 0 }}>
        <h2 style={{ margin: 0 }}>Enterprise build</h2>
        <p className="meta" style={{ marginTop: '0.4rem' }}>
          A different product class from the individual seats. We build a single
          intertwined assistant infrastructure across your entire sales org — every
          rep, manager, and owner runs through their own AI nucleus, and every level
          has private rooms, shared goals, and visibility tuned to their role.
          Conversations sync 1:1 across the org without anyone reading a group chat.
        </p>
        <p className="meta" style={{ marginTop: '0.4rem' }}>
          This is not an upgraded Executive seat. Executive is for one operator.
          Enterprise is for a company.
        </p>
        <div
          style={{
            marginTop: '1rem',
            padding: '0.9rem 1rem',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            background: 'var(--paper-alt, #f7f4ef)',
          }}
        >
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--ink)' }}>Custom quote &middot; bulk seat pricing</div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
            Priced per engagement. The more reps, the lower the per-seat cost.
          </p>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <Link className="btn approve" href={bookHref('executive', 'Enterprise')} style={{ textDecoration: 'none' }}>
            Talk to us about an Enterprise build →
          </Link>
        </div>
        <details className="collapse" style={{ marginTop: '0.9rem' }}>
          <summary>What an Enterprise build includes</summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            <li className="row"><div><p className="name">Multi-seat workspace</p><p className="meta">Owner / admin / manager / rep / observer roles. Every member gets their own dashboard, link code, and permissions.</p></div></li>
            <li className="row"><div><p className="name">Team + account goal hierarchy</p><p className="meta">Owners set account goals, managers set team goals, both fan out to every rep on Telegram.</p></div></li>
            <li className="row"><div><p className="name">Real-time voice-memo feedback loop</p><p className="meta">Reps <code>/pitch &lt;manager&gt;</code> a voice note &mdash; only that manager hears it. Now / Later buttons. Later snoozes onto the manager&rsquo;s task list.</p></div></li>
            <li className="row"><div><p className="name">AI roleplay suite <span style={{ color: 'var(--brand-red)', fontWeight: 700 }}>· coming soon</span></p><p className="meta">Leadership records the real objections they hear and uploads the product. Reps practice live with an AI voice that role-plays the prospect &mdash; pushback, stalls, price questions, the whole thing. Every session is recorded turn-by-turn so managers can review at scale, score reps, and see who&rsquo;s ready before they touch a real deal.</p></div></li>
            <li className="row"><div><p className="name">Internal 1-on-1 booking over Telegram</p><p className="meta">Managers say &ldquo;set up a 1:1 with Dana this week&rdquo; &mdash; the rep gets three open slots that work for both calendars and picks one back. Booked on both calendars, no back-and-forth.</p></div></li>
            <li className="row"><div><p className="name">Org-wide leaderboards + forecasts on demand</p><p className="meta">Owners ask &ldquo;who closed the most this week?&rdquo; or &ldquo;forecast this month&rdquo; over Telegram &mdash; weighted pipeline, win rates, and rep rollups in seconds. No spreadsheet pulled, no rep chased.</p></div></li>
            <li className="row"><div><p className="name">Win/loss patterns in plain English</p><p className="meta">&ldquo;Why are we losing deals this month?&rdquo; pulls patterns from logged call outcomes &mdash; what won, what lost, win-rate, recurring objections. Surfaces the coaching the team actually needs.</p></div></li>
            <li className="row"><div><p className="name">Account-wide announcements</p><p className="meta">&ldquo;Tell everyone we&rsquo;re closed Friday&rdquo; broadcasts to every linked Telegram in the org. Owner/admin only.</p></div></li>
            <li className="row"><div><p className="name">Manager Room &amp; Owners Room &mdash; private channels per level</p><p className="meta">Managers get a private channel for leadership-only chatter, owners get an exec-only channel above that. Each room has its own shared todo list and audit log on the dashboard, so leadership can run a private punch list without it leaking to ICs.</p></div></li>
            <li className="row"><div><p className="name">Speak naturally to anyone &mdash; no /commands, no group chats</p><p className="meta">&ldquo;Tell Sarah I&rsquo;m running 5 late&rdquo; or &ldquo;let the managers know we shifted the demo to Friday&rdquo; &mdash; the bot confirms the recipient (&ldquo;send to <em>Sarah Chen</em>?&rdquo;) before anything goes out, so a fuzzy name never mis-routes a message. No shorthand to learn, no group chats to read.</p></div></li>
            <li className="row"><div><p className="name">1:1 fan-out across every level</p><p className="meta">When someone posts to a room, every other member gets it 1:1 from <em>their own</em> assistant &mdash; nobody scrolls a group chat. Replies thread back to the whole room the same way. Owners stay in the loop on managers, managers stay in the loop on their teams, reps just talk to their assistant. The sync happens underneath.</p></div></li>
            <li className="row"><div><p className="name">Weekly activity report on every rep</p><p className="meta">See who&rsquo;s actually building pipeline this week, who&rsquo;s quiet, and where momentum is shifting &mdash; calls logged, meetings booked, follow-ups sent, week over week. Lands in your inbox every Monday.</p></div></li>
            <li className="row"><div><p className="name">Team + org rollups</p><p className="meta">Per-team leaderboards plus account-wide totals, so leadership sees the whole picture without chasing reps for updates.</p></div></li>
            <li className="row"><div><p className="name">Dedicated build team + SLA</p><p className="meta">White-glove rollout, training, and ongoing tuning across the org.</p></div></li>
          </ul>
        </details>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse">
          <summary>Who sees what — every seat in an Enterprise org</summary>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          <strong>Enterprise only.</strong> The individual seats (Salesperson / Team
          Builder / Executive) are one operator each. The role hierarchy below kicks in
          when we build Virtual Closer for a whole team. Every member gets their own
          dashboard, their own Telegram link code, and their own permissions. Reps
          never see other reps&rsquo; data.
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
              <li>Owns billing, brand, and integrations</li>
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
        </details>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse">
          <summary>A day in your AI employee&rsquo;s life</summary>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
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
          <summary>Executive — solo operator, custom-wired into your stack</summary>
          <div className="timeline">
            <div className="tl-row">
              <div className="tl-time">Week 1</div>
              <div className="tl-dot">🔧</div>
              <div className="tl-body">
                <p className="who">We custom-build into your stack</p>
                <p className="what">No Zapier middlemen. We wire your AI employee directly into your CRM, your dialer, your data warehouse, your fulfillment software. Day one feels like the AI grew up inside your business.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">Daily</div>
              <div className="tl-dot">📊</div>
              <div className="tl-body">
                <p className="who">Tuned to how you sell</p>
                <p className="what">Pitch language, pipeline stages, follow-up cadence &mdash; all fitted to the way you already win. We tune it; you keep closing.</p>
              </div>
            </div>
            <div className="tl-row">
              <div className="tl-time">Quarterly</div>
              <div className="tl-dot">🤝</div>
              <div className="tl-body">
                <p className="who">Strategy review with our team</p>
                <p className="what">We sit with you, review what worked, retune the system, ship the next round of custom workflows. White-glove, with an SLA.</p>
              </div>
            </div>
          </div>
        </details>

        <details className="collapse">
          <summary>Enterprise &mdash; multi-team org with the feedback loop &amp; weekly activity report</summary>
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
              <div className="tl-time">Live</div>
              <div className="tl-dot">🎙</div>
              <div className="tl-body">
                <p className="who">Reps pitch a manager directly over Telegram</p>
                <p className="what">Rep sends <code>/pitch &lt;manager&gt;</code> + a voice note. Only the named manager hears it. They tap <em>Now</em> to voice-reply or <em>Later</em> to push it onto their task list. Rep is told either way.</p>
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
              <div className="tl-time">Quarterly</div>
              <div className="tl-dot">🤝</div>
              <div className="tl-body">
                <p className="who">Org-wide strategy review</p>
                <p className="what">We sit with leadership, review every team&rsquo;s pace, and ship the next round of custom workflows across the org.</p>
              </div>
            </div>
          </div>
        </details>
        </details>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse">
          <summary>How a goal flows — from leadership to closed-won</summary>
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
        </details>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse">
          <summary>What you actually get at each tier</summary>
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
              <tr><td className="feat">Personal sub-domain<p className="meta">yourname.virtualcloser.com</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Branded domain + colors<p className="meta">Your company URL, logo, and brand colors &mdash; not ours</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Telegram bot — voice + text<p className="meta">Per-member link code on every seat</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Daily morning brief + EOD prompt<p className="meta">Personal goals &amp; team goals in the same DM</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Lead + call + brain-item CRM<p className="meta">Built-in, no extra tool needed</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Email follow-ups via Resend<p className="meta">Drafts in your voice, sends on Approve</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Google Calendar booking<p className="meta">Conflict-aware; books from a voice note</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Google Sheets CRM bridge<p className="meta">Smart upsert, alias-matched columns</p></td><td className="tier-col yes">●</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Custom CRM integration<p className="meta">Plugs into the CRM you already use &mdash; HubSpot, Pipedrive, Salesforce, or your own</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Gmail-connected follow-ups<p className="meta">Drafts in your voice, you approve, it sends</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Call intel on every meeting<p className="meta">Notes, action items, and objections auto-filed to the right deal</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Weekly business review<p className="meta">Plain-English recap of what moved, what stalled, and where to focus</p></td><td className="tier-col no">○</td><td className="tier-col yes">●</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Custom-built integrations<p className="meta">We wire it directly into your CRM, dialer, and fulfillment stack</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">Tuned to how you sell<p className="meta">Pitch language, pipeline stages, and follow-up cadence fitted to your motion</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
              <tr><td className="feat">White-glove rollout + SLA<p className="meta">Quarterly strategy reviews and ongoing optimization</p></td><td className="tier-col no">○</td><td className="tier-col no">○</td><td className="tier-col yes">●</td></tr>
            </tbody>
          </table>
        </div>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          ● included &nbsp;·&nbsp; ○ not on this tier &nbsp;·&nbsp; <em>add-on</em> available on request.
          This matrix is for the <strong>individual</strong> seats only &mdash; one operator,
          their own pipeline. Enterprise is a different product class entirely (multi-seat
          org with role hierarchy, private rooms, shared goals, voice-memo coaching),
          covered separately above.
        </p>
        </details>
      </section>

      {/* ── Enterprise: Voice-memo feedback loop (the nucleus) ─────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse">
          <summary>The real-time feedback nucleus (Enterprise)</summary>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          Coaching at scale dies in DM threads. Reps wait days for a manager to weigh in
          on a pitch, voice memos get lost in scrollback, nobody can find what was said
          about which lead, and there&rsquo;s no clean signal for &ldquo;this lead is ready to pitch&rdquo;
          vs &ldquo;not yet.&rdquo; We rebuilt the loop end-to-end &mdash; all over Telegram and your dashboard.
        </p>

        <div className="pain-grid" style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.7rem' }}>
          <details className="pain-card" open>
            <summary><h3>The Pain</h3></summary>
            <ul className="list" style={{ maxHeight: 'none' }}>
              <li className="row"><div><p className="name">Pitches lost in DM scrollback</p><p className="meta">No archive, no search, no audit trail.</p></div></li>
              <li className="row"><div><p className="name">Manager bottleneck on every pitch</p><p className="meta">Reps wait hours/days; momentum dies.</p></div></li>
              <li className="row"><div><p className="name">Feedback is text, slow, and tone-flat</p><p className="meta">Try teaching delivery in a 4-line iMessage.</p></div></li>
              <li className="row"><div><p className="name">No &ldquo;ready to pitch&rdquo; signal</p><p className="meta">Reps re-pitch leads the manager already vetoed.</p></div></li>
              <li className="row"><div><p className="name">Standups duplicate the same info</p><p className="meta">Coaching that should be 1:1 burns the whole team&rsquo;s morning.</p></div></li>
              <li className="row"><div><p className="name">No memory across reps or quarters</p><p className="meta">&ldquo;What did we say about Acme last month?&rdquo; — gone.</p></div></li>
            </ul>
          </details>
          <details className="pain-card" open>
            <summary><h3>The Solution</h3></summary>
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
          </details>
        </div>

        <h3 style={{ marginTop: '1.4rem', marginBottom: '0.4rem', fontSize: '1rem' }}>Real-time feedback &mdash; a live example</h3>
        <p className="meta" style={{ marginBottom: '0.6rem' }}>One pitch, end to end, in five steps:</p>
        <div className="flow" style={{ marginTop: '0.4rem' }}>
          <div className="flow-step"><div className="flow-num">1</div><div><p className="name">Rep sends <code>/pitch Sara about Dana Northwind</code></p><p className="meta">Names the one manager who should hear it.</p></div></div>
          <div className="flow-step"><div className="flow-num">2</div><div><p className="name">Rep records the voice note</p><p className="meta">Hold the mic on Telegram. That&rsquo;s it.</p></div></div>
          <div className="flow-step"><div className="flow-num">3</div><div><p className="name">Sara gets it with Now / Later buttons</p><p className="meta">Just her. Nobody else.</p></div></div>
          <div className="flow-step"><div className="flow-num">4</div><div><p className="name">Now &rarr; voice reply. Later &rarr; task on her list.</p><p className="meta">The rep is told either way.</p></div></div>
          <div className="flow-step"><div className="flow-num">5</div><div><p className="name">Rep hears feedback instantly</p><p className="meta">Plus the verdict and a link to the pitch on their dashboard.</p></div></div>
        </div>

        <p className="meta" style={{ marginTop: '0.8rem' }}>
          Available on every Enterprise build. Ask about it on the scoping call —
          we&rsquo;ll show you the queue and walk a live pitch end-to-end.
        </p>
        </details>
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
