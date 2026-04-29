'use client'

import Link from 'next/link'
import { useState } from 'react'
import OfferTabs from '@/app/components/OfferTabs'

/**
 * Enterprise demo — interactive pitch surface.
 *
 * Three role views (Rep, Manager, Owner) and three rooms (Team, Managers,
 * Owners) plus the roleplay surface (still "coming soon" but visually
 * complete) and the remind-me-later inbox. All fake data, nothing persists.
 *
 * Built specifically so the founder can pitch managers/owners and switch
 * between roles live to show what their team would actually see.
 */

type Role = 'rep' | 'manager' | 'owner'
type RoomKey = 'team' | 'managers' | 'owners'
type Tab =
  | 'overview'
  | 'pipeline'
  | 'roleplay'
  | 'rooms'
  | 'inbox'
  | 'leaderboard'

const ROLE_LABEL: Record<Role, string> = {
  rep: 'Rep',
  manager: 'Manager',
  owner: 'Owner',
}

const ROLE_HINT: Record<Role, string> = {
  rep: 'a closer working a list — sees their own pipeline, their own assigned roleplays, the team room.',
  manager: 'runs a team of 6 reps — assigns roleplays, listens to recordings, posts to the managers room.',
  owner: 'sees every team and every metric — the only role that sees the owners room and account-wide goals.',
}

// ── Demo data (fake, hard-coded) ─────────────────────────────────────────

const REPS = [
  { id: 'r1', name: 'Sarah Chen', team: 'East', sessionsThisWeek: 6, avgScore: 87, ready: true, mins: 92 },
  { id: 'r2', name: 'Marcus Vega', team: 'East', sessionsThisWeek: 4, avgScore: 78, ready: true, mins: 61 },
  { id: 'r3', name: 'Aisha Wu', team: 'East', sessionsThisWeek: 3, avgScore: 74, ready: false, mins: 48 },
  { id: 'r4', name: 'Ben Foster', team: 'West', sessionsThisWeek: 0, avgScore: null, ready: false, mins: 0 },
  { id: 'r5', name: 'Priya Shah', team: 'East', sessionsThisWeek: 5, avgScore: 91, ready: true, mins: 88 },
  { id: 'r6', name: 'Tom Park', team: 'West', sessionsThisWeek: 2, avgScore: 69, ready: false, mins: 28 },
]

type StatTile = { label: string; value: string; hint?: string; tg?: boolean }

const OVERVIEW_STATS: Record<Role, StatTile[]> = {
  rep: [
    { label: 'Pipeline · hot/warm', value: '4 / 11', hint: 'this week' },
    { label: 'Roleplay assigned', value: '2 / 3', hint: 'due Friday', tg: true },
    { label: 'Avg roleplay score', value: '78', hint: '+6 vs last week' },
    { label: 'Inbox parked', value: '3', hint: 'from Priya · due today', tg: true },
  ],
  manager: [
    { label: 'Reps practicing this week', value: '5 / 6', hint: '↑ 2 vs last week' },
    { label: 'Sessions reviewed', value: '12 / 18', hint: '6 in queue' },
    { label: 'Team revenue pace', value: '$84.2K / $120K', hint: '70% · 8 days left' },
    { label: 'Team room activity', value: '14 posts', hint: 'last 24h', tg: true },
  ],
  owner: [
    { label: 'Account revenue', value: '$312K / $400K', hint: '78% · this month' },
    { label: 'Reps active', value: '23 / 24', hint: '1 on PTO' },
    { label: 'Avg readiness', value: '82', hint: 'roleplay pass rate' },
    { label: 'Owners room threads', value: '4 open', hint: 'incl. Q2 plan', tg: true },
  ],
}

type PipelineRow = { name: string; meta: string; status: 'HOT' | 'WARM' | 'COLD' | 'DORMANT'; sub: string }
const PIPELINE: PipelineRow[] = [
  { name: 'Dana Ruiz', meta: 'Ruiz Consulting · $48K', status: 'HOT', sub: 'Discovery 9:30am · pricing + quick win' },
  { name: 'Malcolm Ortiz', meta: 'North Trail Co. · $22K', status: 'WARM', sub: 'Opened last 2 emails, no reply' },
  { name: 'Priya Shah', meta: 'Ledgerwise · $36K', status: 'WARM', sub: 'Proposal walkthrough 2pm' },
  { name: 'Aisha Wu', meta: 'Cedar Labs · $14K', status: 'DORMANT', sub: '47 days quiet — script queued' },
  { name: 'Ben Foster', meta: 'Foster & Sons · $9K', status: 'COLD', sub: 'Cold outreach replied yesterday' },
]

type Scenario = {
  id: string
  name: string
  difficulty: 'Easy' | 'Standard' | 'Hard' | 'Brutal'
  persona: string
  objections: number
  docs: number
  voice: string
}

const SCENARIOS: Scenario[] = [
  { id: 's1', name: 'Price objection · enterprise', difficulty: 'Hard', persona: 'Skeptical CFO at a 200-person firm', objections: 12, docs: 3, voice: 'TBD' },
  { id: 's2', name: 'Trial-user about to churn', difficulty: 'Standard', persona: 'PM who hasn\'t logged in for 11 days', objections: 8, docs: 2, voice: 'TBD' },
  { id: 's3', name: 'Discovery: cold-warm', difficulty: 'Easy', persona: 'Curious operator from inbound form', objections: 5, docs: 4, voice: 'TBD' },
  { id: 's4', name: 'Renewal · price hike', difficulty: 'Brutal', persona: 'Owner who got a 22% renewal increase', objections: 14, docs: 3, voice: 'TBD' },
]

type SessionRow = { rep: string; scenario: string; score: number; mins: number; verdict: 'Ready' | 'Needs work' | 'Escalate' | null; ago: string }
const SESSIONS: SessionRow[] = [
  { rep: 'Sarah Chen', scenario: 'Price objection · enterprise', score: 91, mins: 14, verdict: 'Ready', ago: '12m ago' },
  { rep: 'Marcus Vega', scenario: 'Discovery: cold-warm', score: 78, mins: 11, verdict: null, ago: '1h ago' },
  { rep: 'Aisha Wu', scenario: 'Trial-user about to churn', score: 64, mins: 8, verdict: 'Needs work', ago: '3h ago' },
  { rep: 'Priya Shah', scenario: 'Renewal · price hike', score: 88, mins: 16, verdict: 'Ready', ago: 'yesterday' },
  { rep: 'Tom Park', scenario: 'Price objection · enterprise', score: 52, mins: 6, verdict: 'Escalate', ago: 'yesterday' },
]

type RoomMessage = { author: string; role: Role; body: string; ts: string }

const ROOMS: Record<RoomKey, { description: string; visibleTo: Role[]; messages: RoomMessage[] }> = {
  team: {
    description: 'Everyone on the East team — reps + their manager. Posted via Telegram, relayed 1:1 to every member.',
    visibleTo: ['rep', 'manager', 'owner'],
    messages: [
      { author: 'Priya Shah', role: 'manager', body: 'Heads up: Dana Ruiz call moved to Thursday. Ledgerwise still on for Tuesday.', ts: '8:42 AM' },
      { author: 'Sarah Chen', role: 'rep', body: 'Got the renewal-objection scenario down to ~88. Going to take another swing this afternoon.', ts: '9:15 AM' },
      { author: 'Marcus Vega', role: 'rep', body: 'Anyone seen the latest pricing sheet? Need it for the 2pm.', ts: '10:01 AM' },
      { author: 'Priya Shah', role: 'manager', body: 'Shared in #docs. Also: assigned everyone the new "trial churn" scenario — 2 sessions by Friday.', ts: '10:04 AM' },
    ],
  },
  managers: {
    description: 'Managers + admins + owner. Reps cannot see this room.',
    visibleTo: ['manager', 'owner'],
    messages: [
      { author: 'Priya Shah', role: 'manager', body: 'East team avg score on the renewal scenario is 78. West team is at 64 — recommend pushing the docs Tom uploaded.', ts: '8:30 AM' },
      { author: 'Dana Ruiz', role: 'owner', body: 'Agreed. I\'ll add the "churn comeback" doc tonight. Roleplay nucleus is paying off — book a 1:1 with anyone scoring under 70.', ts: '9:02 AM' },
      { author: 'Priya Shah', role: 'manager', body: 'On it. Also flagged 3 escalations in the review queue — listen when you get a sec.', ts: '9:10 AM' },
    ],
  },
  owners: {
    description: 'Owners + admins only. The most private room. Managers cannot see this.',
    visibleTo: ['owner'],
    messages: [
      { author: 'Dana Ruiz', role: 'owner', body: 'Q2 plan: lock in the East team\'s renewal motion, then port it West. Price-hike scenario is the bottleneck.', ts: '7:55 AM' },
      { author: 'Dana Ruiz', role: 'owner', body: 'Capex on a second voice provider seat: $400/mo. Worth it if we can run more concurrent sessions.', ts: '8:18 AM' },
    ],
  },
}

type InboxRow = { source: 'walkie' | 'voice_memo' | 'room' | 'lead' | 'roleplay' | 'self'; title: string; body: string; from: string; remindAt: string }

const INBOX: Record<Role, InboxRow[]> = {
  rep: [
    { source: 'walkie', title: 'Send Dana the case study', body: 'Priya: "ping me once it\'s out — I want to copy you on the follow-up."', from: 'Priya Shah', remindAt: 'Today 4 PM' },
    { source: 'roleplay', title: 'Re-attempt price-objection scenario', body: 'Priya left a verdict: needs another pass on the discount pivot.', from: 'Priya Shah', remindAt: 'Tomorrow 9 AM' },
    { source: 'self', title: 'Refresh proposal numbers for Ledgerwise', body: 'Q2 numbers landed — update before Tuesday.', from: 'You', remindAt: 'Tomorrow 8 AM' },
  ],
  manager: [
    { source: 'voice_memo', title: 'Coach Tom on closes under 60s', body: 'Voice memo from Tom 8:14am — clipped the close on his last 3 sessions.', from: 'Tom Park', remindAt: 'Today 3 PM' },
    { source: 'walkie', title: 'Marcus needs the new pricing sheet', body: 'From this morning\'s walkie. Sent the link, but follow up he actually used it.', from: 'Marcus Vega', remindAt: 'Today 1 PM' },
    { source: 'lead', title: 'Reassign Aisha\'s lead "Cedar Labs" if cold', body: 'Aisha said she\'s done chasing. Decide by EOD.', from: 'Aisha Wu', remindAt: 'Today 5 PM' },
    { source: 'roleplay', title: 'Listen to Sarah\'s 91-score session', body: 'Worth pulling clips for the team room as a teach.', from: 'Sarah Chen', remindAt: 'Tomorrow 8 AM' },
    { source: 'self', title: 'Draft Q2 quota plan for Dana', body: '', from: 'You', remindAt: 'Friday' },
  ],
  owner: [
    { source: 'room', title: 'Q2 plan thread (managers room)', body: 'Loop back after the East-team review: confirm the West rollout date.', from: 'Priya Shah', remindAt: 'Friday' },
    { source: 'voice_memo', title: 'Coaching memo from West manager', body: 'Need a verdict by EOW — Tom\'s readiness blocking the rollout.', from: 'West manager', remindAt: 'Tomorrow 5 PM' },
    { source: 'self', title: 'Approve voice-provider upgrade', body: '$400/mo line item — pull the trigger after this week\'s leaderboard.', from: 'You', remindAt: 'Sunday' },
  ],
}

const SOURCE_LABEL: Record<InboxRow['source'], string> = {
  walkie: 'Walkie',
  voice_memo: 'Voice memo',
  room: 'Room',
  lead: 'Lead',
  roleplay: 'Roleplay',
  self: 'You',
}

const TABS_BY_ROLE: Record<Role, Tab[]> = {
  rep: ['overview', 'pipeline', 'roleplay', 'rooms', 'inbox'],
  manager: ['overview', 'leaderboard', 'roleplay', 'rooms', 'inbox', 'pipeline'],
  owner: ['overview', 'leaderboard', 'roleplay', 'rooms', 'inbox'],
}

// ── Component ────────────────────────────────────────────────────────────

export default function EnterpriseDemoPage() {
  const [role, setRole] = useState<Role>('manager')
  const [tab, setTab] = useState<Tab>('overview')
  const [room, setRoom] = useState<RoomKey>('team')

  const tabs = TABS_BY_ROLE[role]
  const currentTab = tabs.includes(tab) ? tab : tabs[0]

  return (
    <main className="wrap demo-wrap">
      <DemoStyles />

      <header className="hero">
        <h1 style={{ margin: '0 0 0.4rem' }}>
          One nucleus, three roles. Switch between them live.
        </h1>
        <p className="sub">
          Every rep, manager, and owner runs their day through Telegram. The dashboard mirrors
          what the bot already knows. Roleplay is the per-seat add-on managers unlock for the
          reps they want training. Pick a role below to see exactly what they&rsquo;d see.
        </p>
        <p className="nav">
          <Link href="mailto:hello@virtualcloser.com?subject=Enterprise%20pilot">Book a call</Link>
        </p>
      </header>

      <OfferTabs side="enterprise" view="demo" />

      <div className="dash-frame">
        <div className="dash-frame-chrome">
          <span className="dash-frame-dot" style={{ background: '#ff5f57' }} />
          <span className="dash-frame-dot" style={{ background: '#febc2e' }} />
          <span className="dash-frame-dot" style={{ background: '#28c840' }} />
          <span className="dash-frame-url">app.virtualcloser.com / dashboard</span>
        </div>

      {/* Role switcher */}
      <section className="card switcher" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Viewing as</h2>
          <p>{ROLE_HINT[role]}</p>
        </div>
        <div className="role-row">
          {(['rep', 'manager', 'owner'] as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRole(r)
                setTab('overview')
              }}
              className={`btn ${role === r ? 'approve' : 'dismiss'}`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="tab-row">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`tab ${currentTab === t ? 'tab-active' : ''}`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>
      </section>

      {currentTab === 'overview' && <OverviewView role={role} />}
      {currentTab === 'pipeline' && <PipelineView role={role} />}
      {currentTab === 'roleplay' && <RoleplayView role={role} />}
      {currentTab === 'rooms' && <RoomsView role={role} room={room} setRoom={setRoom} />}
      {currentTab === 'inbox' && <InboxView role={role} />}
      {currentTab === 'leaderboard' && <LeaderboardView role={role} />}
      </div>
    </main>
  )
}

function tabLabel(t: Tab): string {
  switch (t) {
    case 'overview':
      return 'Overview'
    case 'pipeline':
      return 'Pipeline'
    case 'roleplay':
      return 'Roleplay'
    case 'rooms':
      return 'Rooms'
    case 'inbox':
      return 'Inbox'
    case 'leaderboard':
      return 'Leaderboard'
  }
}

// ── Views ────────────────────────────────────────────────────────────────

function OverviewView({ role }: { role: Role }) {
  const stats = OVERVIEW_STATS[role]
  return (
    <>
      <section className="grid-4">
        {stats.map((s) => (
          <article key={s.label} className="card stat">
            <p className="label">{s.label}</p>
            <p className="value small">{s.value}</p>
            {s.hint && <p className="hint">{s.hint}</p>}
            {s.tg && <span className="tg-chip">● via Telegram</span>}
          </article>
        ))}
      </section>

      {role === 'rep' && (
        <>
          <section className="grid-2" style={{ marginTop: '0.8rem' }}>
            <article className="card">
              <div className="section-head">
                <h2>Today &amp; tomorrow</h2>
                <p><span className="src-tag">Calendar</span> Google + AI Dialer</p>
              </div>
              <ul className="list" style={{ maxHeight: 'none' }}>
                <li className="row">
                  <div>
                    <p className="name">Dana Ruiz · discovery</p>
                    <p className="meta">Today 9:30 AM · Ruiz Consulting · $48K potential</p>
                    <p className="meta">Confirm call placed 8:45 AM</p>
                  </div>
                  <div className="right"><span className="status good">CONFIRMED</span></div>
                </li>
                <li className="row">
                  <div>
                    <p className="name">Priya Shah · proposal walkthrough</p>
                    <p className="meta">Today 2:00 PM · Ledgerwise · $36K</p>
                    <p className="meta">No-answer on confirm — second attempt at 12:30 PM</p>
                  </div>
                  <div className="right"><span className="status warm">PENDING</span></div>
                </li>
                <li className="row">
                  <div>
                    <p className="name">Malcolm Ortiz · 30-min</p>
                    <p className="meta">Tomorrow 10:00 AM · North Trail Co.</p>
                    <p className="meta">Confirmation queued — fires 9:00 AM tomorrow</p>
                  </div>
                  <div className="right"><span className="status cold">QUEUED</span></div>
                </li>
              </ul>
            </article>

            <article className="card">
              <div className="section-head">
                <h2>Your roleplay queue</h2>
                <p>2 due Friday · self-assign anytime</p>
              </div>
              <ul className="list" style={{ maxHeight: 'none' }}>
                <li className="row">
                  <div>
                    <p className="name">Trial-user about to churn</p>
                    <p className="meta">Assigned by Priya · best score 76 · 1 / 2 done</p>
                  </div>
                  <div className="right">
                    <span className="score-100"><strong>76</strong><span className="score-100-denom">/ 100</span></span>
                  </div>
                </li>
                <li className="row">
                  <div>
                    <p className="name">Price objection · enterprise</p>
                    <p className="meta">Assigned by Priya · 0 / 2 done</p>
                  </div>
                  <div className="right"><span className="status hot">START</span></div>
                </li>
                <li className="row">
                  <div>
                    <p className="name">Discovery: cold-warm</p>
                    <p className="meta">Self-assigned · 1 / 1 done</p>
                  </div>
                  <div className="right">
                    <span className="score-100"><strong>84</strong><span className="score-100-denom">/ 100</span></span>
                  </div>
                </li>
              </ul>
            </article>
          </section>

          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>Your pipeline · top 5</h2>
              <p>full board on the Pipeline tab</p>
            </div>
            <ul className="list" style={{ maxHeight: 'none' }}>
              {PIPELINE.map((row) => (
                <li key={row.name} className="row">
                  <div>
                    <p className="name">{row.name}</p>
                    <p className="meta">{row.meta}</p>
                    <p className="meta">{row.sub}</p>
                  </div>
                  <div className="right">
                    <span className={`status ${row.status.toLowerCase()}`}>{row.status}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {role !== 'rep' && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <details className="collapse" open>
            <summary>The Nucleus</summary>
            <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
              <li className="row"><div>
                <p className="name">Telegram is the radio</p>
                <p className="meta">Every action — log a call, walkie a teammate, post to the managers room, park a reminder — happens 1:1 with your assistant. Nobody reads each other&rsquo;s threads.</p>
              </div></li>
              <li className="row"><div>
                <p className="name">The dashboard is the audit log</p>
                <p className="meta">What you said in Telegram shows up here, organized by source and role. Owners see everything; managers see their teams; reps see themselves.</p>
              </div></li>
              <li className="row"><div>
                <p className="name">Roleplay is the proving ground</p>
                <p className="meta">Manager builds a scenario from your real objection bank, assigns it, listens to the recordings, leaves a verdict. Reps practice until they&rsquo;re ready.</p>
              </div></li>
              <li className="row"><div>
                <p className="name">AI Dialer is the appointment shield</p>
                <p className="meta">Every booked meeting gets a confirmation call ~30–60 min before start. Confirmed, rescheduled, no-answer feed straight back to the rep so nobody chases ghosts.</p>
              </div></li>
            </ul>
          </details>
        </section>
      )}
    </>
  )
}

function PipelineView({ role }: { role: Role }) {
  const title = role === 'rep' ? 'Your pipeline' : role === 'manager' ? 'East team pipeline' : 'Account pipeline'
  return (
    <section className="card">
      <div className="section-head">
        <h2>{title}</h2>
        <p>fake demo data · click a row to see what the bot knows</p>
      </div>
      <ul className="list" style={{ maxHeight: 'none' }}>
        {PIPELINE.map((row) => (
          <li key={row.name} className="row">
            <div>
              <p className="name">{row.name}</p>
              <p className="meta">{row.meta}</p>
              <p className="meta">{row.sub}</p>
            </div>
            <div className="right">
              <span className={`status ${row.status.toLowerCase()}`}>{row.status}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RoleplayView({ role }: { role: Role }) {
  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Roleplay suite</h2>
          <p>
            <span className="badge-coming">Coming soon</span>
            {' '}per-seat add-on · same engine for solo and enterprise
          </p>
        </div>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
          {role === 'rep' && (
            <>You see assigned scenarios, your queue, and your last 5 sessions with score + debrief. You can re-attempt anything until your manager marks it &ldquo;ready.&rdquo;</>
          )}
          {role === 'manager' && (
            <>You build scenarios, attach training docs (scoped to your account only — never leaks), assign required counts + deadlines per rep, listen to recordings, leave verdicts. The leaderboard shows who&rsquo;s practicing and who&rsquo;s coasting.</>
          )}
          {role === 'owner' && (
            <>You see every team&rsquo;s readiness rollup, can listen to any session, and approve seat unlocks for new reps. The bot pings you daily with who hustled and who didn&rsquo;t.</>
          )}
        </p>
      </section>

      {role !== 'rep' && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Scenarios{' '}<span className="example-tag">example library</span></h2>
            <p>{role === 'manager' ? 'East team library' : 'all teams'}</p>
          </div>
          <p className="meta" style={{ margin: '0 0 0.6rem', fontSize: '0.82rem' }}>
            These are sample scenarios reps can run. In your account you build
            them from your real objection bank — each scenario links back to the
            training docs the AI uses for that role.
          </p>
          <ul className="list" style={{ maxHeight: 'none' }}>
            {SCENARIOS.map((s) => (
              <li key={s.id} className="row">
                <div>
                  <p className="name">{s.name}</p>
                  <p className="meta">{s.persona}</p>
                  <p className="meta">{s.objections} objections · {s.docs} training docs · voice: {s.voice}</p>
                </div>
                <div className="right">
                  <span className={`difficulty diff-${s.difficulty.toLowerCase()}`}>{s.difficulty}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {role === 'rep' && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Your assigned scenarios</h2>
            <p>2 of 3 due Friday</p>
          </div>
          <ul className="list" style={{ maxHeight: 'none' }}>
            <li className="row">
              <div>
                <p className="name">Trial-user about to churn</p>
                <p className="meta">Assigned by Priya · 2 sessions required</p>
                <p className="meta">Completed: 1 / 2 · Best score 76</p>
              </div>
              <div className="right"><span className="status warm">DUE FRI</span></div>
            </li>
            <li className="row">
              <div>
                <p className="name">Price objection · enterprise</p>
                <p className="meta">Assigned by Priya · 2 sessions required</p>
                <p className="meta">Completed: 0 / 2</p>
              </div>
              <div className="right"><span className="status hot">START</span></div>
            </li>
            <li className="row">
              <div>
                <p className="name">Discovery: cold-warm</p>
                <p className="meta">Self-assigned · 1 session</p>
                <p className="meta">Completed: 1 / 1 · Score 84 · &ldquo;Ready&rdquo;</p>
              </div>
              <div className="right"><span className="status good">DONE</span></div>
            </li>
          </ul>
        </section>
      )}

      <section className="card">
        <details className="collapse" open>
          <summary>
            {role === 'rep' ? 'Your last sessions' : 'Recent sessions across the team'}
            <span className="sum-meta">
              {role === 'rep'
                ? 'turn-by-turn transcript saved'
                : 'example past sessions \u2014 tap a row to listen'}
            </span>
          </summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            {(role === 'rep' ? SESSIONS.filter((s) => s.rep === 'Marcus Vega') : SESSIONS).map((s, i) => (
              <li key={i} className="row">
                <div>
                  <p className="name">{s.scenario}</p>
                  <p className="meta">{s.rep} \u00b7 {s.mins} min \u00b7 {s.ago}</p>
                </div>
                <div className="right">
                  <span className="score-100" title="Score out of 100">
                    <strong>{s.score}</strong>
                    <span className="score-100-denom">/ 100</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  )
}

function verdictTone(v: 'Ready' | 'Needs work' | 'Escalate'): string {
  if (v === 'Ready') return 'good'
  if (v === 'Needs work') return 'warm'
  return 'risk'
}

function RoomsView({
  role,
  room,
  setRoom,
}: {
  role: Role
  room: RoomKey
  setRoom: (r: RoomKey) => void
}) {
  const visibleRooms = (Object.keys(ROOMS) as RoomKey[]).filter((r) =>
    ROOMS[r].visibleTo.includes(role),
  )
  const currentRoom = visibleRooms.includes(room) ? room : visibleRooms[0]
  const data = ROOMS[currentRoom]
  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Rooms</h2>
          <p>nobody reads each other&rsquo;s threads — the bot relays 1:1</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {visibleRooms.map((r) => (
            <button
              key={r}
              onClick={() => setRoom(r)}
              className={`tab ${currentRoom === r ? 'tab-active' : ''}`}
            >
              {r === 'team' ? 'Team room (East)' : r === 'managers' ? 'Managers room' : 'Owners room'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>
            {currentRoom === 'team' ? 'East team room' : currentRoom === 'managers' ? 'Managers room' : 'Owners room'}
          </h2>
          <p>{data.description}</p>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {data.messages.map((m, i) => (
            <li key={i} className="row">
              <div>
                <p className="name">{m.author} <span className="role-tag">{m.role}</span></p>
                <p className="meta">{m.body}</p>
              </div>
              <div className="right"><span className="meta">{m.ts}</span></div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function InboxView({ role }: { role: Role }) {
  const items = INBOX[role]
  return (
    <section className="card">
      <div className="section-head">
        <h2>Remind-me-later inbox</h2>
        <p>parked items · separate from your goals/tasks</p>
      </div>
      <ul className="list" style={{ maxHeight: 'none' }}>
        {items.map((row, i) => (
          <li key={i} className="row">
            <div>
              <p className="name">
                <span className="src-tag">{SOURCE_LABEL[row.source]}</span> {row.title}
              </p>
              {row.body && <p className="meta">{row.body}</p>}
              <p className="meta">from {row.from} · remind {row.remindAt}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LeaderboardView({ role }: { role: Role }) {
  const sorted = [...REPS].sort((a, b) => b.sessionsThisWeek - a.sessionsThisWeek)
  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Roleplay leaderboard · last 7 days</h2>
          <p>{role === 'manager' ? 'East team' : 'all teams'} · who&rsquo;s working their craft</p>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {sorted.map((rep, i) => (
            <li key={rep.id} className="row">
              <div>
                <p className="name">
                  <span className="rank">#{i + 1}</span> {rep.name}
                  <span className="role-tag" style={{ marginLeft: 6 }}>{rep.team}</span>
                </p>
                <p className="meta">
                  {rep.sessionsThisWeek} sessions · {rep.mins} min practiced · avg {rep.avgScore ?? '—'}
                </p>
              </div>
              <div className="right">
                {rep.ready ? (
                  <span className="status good">READY</span>
                ) : rep.sessionsThisWeek === 0 ? (
                  <span className="status risk">BEHIND</span>
                ) : (
                  <span className="status warm">PRACTICING</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <details className="collapse">
          <summary>
            Daily digest preview
            <span className="sum-meta">delivered every weekday 8:30am to managers + owners on Telegram</span>
          </summary>
        <pre className="digest" style={{ marginTop: '0.6rem' }}>
{`📊 Roleplay digest · Tuesday Apr 27

5/6 reps practiced yesterday. 23 total sessions.

🥇 Sarah Chen · 6 sessions · avg 87
   Marcus Vega · 4 sessions · avg 78
   Priya Shah · 5 sessions · avg 91

⚠️  Ben Foster · 0 sessions, behind on
   "Price objection" assignment (due Fri)

3 sessions in your review queue.
Tap to listen.`}
        </pre>
        </details>
      </section>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

function DemoStyles() {
  return (
    <style jsx global>{`
      /* 4-col stat grid → 2 cols on tablet → 2 cols on phone */
      .demo-wrap .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }
      @media (max-width: 960px) { .demo-wrap .grid-4 { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 520px)  { .demo-wrap .grid-4 { grid-template-columns: repeat(2, 1fr); } }

      /* Stat cards */
      .demo-wrap .stat { padding: 1.1rem 1.2rem 1.1rem; }
      .demo-wrap .stat .label { margin: 0; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 700; line-height: 1.4; }
      .demo-wrap .stat .value { margin: 0.35rem 0 0; font-weight: 700; color: var(--ink); }
      .demo-wrap .stat .value.small { font-size: 18px; line-height: 1.25; }
      .demo-wrap .stat .hint { margin: 0.25rem 0 0; font-size: 11px; color: var(--muted); }
      .demo-wrap .tg-chip { display: inline-block; margin-top: 0.45rem; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--red); }
      @media (max-width: 520px) { .demo-wrap .stat { padding: 1rem 1rem 1rem; } }

      /* Section heads */
      .demo-wrap .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.6rem; gap: 0.6rem; flex-wrap: wrap; }
      .demo-wrap .section-head h2 { margin: 0; font-size: 16px; font-weight: 700; color: var(--ink); }
      .demo-wrap .section-head p { margin: 0; font-size: 12px; color: var(--muted); }
      @media (max-width: 520px) { .demo-wrap .section-head { flex-direction: column; align-items: flex-start; gap: 0.1rem; } }

      /* Lists + rows */
      .demo-wrap .list { list-style: none; padding: 0; margin: 0; }
      .demo-wrap .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.8rem; padding: 0.65rem 0; background: transparent; border: none; border-radius: 0; border-bottom: 1px solid var(--ink-soft); }
      .demo-wrap .row:last-child { border-bottom: 0; padding-bottom: 0; }
      .demo-wrap .row > div:first-child { min-width: 0; flex: 1; }
      .demo-wrap .row .name { margin: 0; font-weight: 600; font-size: 14px; color: var(--ink); word-break: break-word; }
      .demo-wrap .row .meta { margin: 0.2rem 0 0; font-size: 12px; color: var(--muted); line-height: 1.45; word-break: break-word; }
      .demo-wrap .right { white-space: nowrap; flex-shrink: 0; text-align: right; }
      @media (max-width: 520px) {
        .demo-wrap .row { flex-wrap: wrap; gap: 0.35rem; }
        .demo-wrap .right { width: 100%; text-align: left; }
      }

      /* Mini-cards inside collapsibles — need their own inner padding */
      .demo-wrap .collapse .list { display: flex; flex-direction: column; gap: 0.5rem; }
      .demo-wrap .collapse .row { padding: 0.75rem 1rem; border-bottom: none; border-radius: 6px; }
      .demo-wrap .collapse .row:last-child { padding-bottom: 0.75rem; }
      @media (max-width: 520px) {
        .demo-wrap .collapse .row { padding: 0.7rem 0.85rem; }
      }

      /* Status pills */
      .demo-wrap .status { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; padding: 3px 9px; border-radius: 999px; background: var(--paper-2); color: var(--ink); }
      .demo-wrap .status.hot      { background: var(--red);      color: #fff; }
      .demo-wrap .status.warm     { background: #ffb300;         color: #1a0e00; }
      .demo-wrap .status.cold     { background: #c9d3df;         color: #1a2a3a; }
      .demo-wrap .status.dormant  { background: #6b6b6b;         color: #fff; }
      .demo-wrap .status.good     { background: #18a35a;         color: #fff; }
      .demo-wrap .status.risk     { background: var(--red-deep); color: #fff; }
      .demo-wrap .status.watch    { background: #ffb300;         color: #1a0e00; }

      /* Role switcher — 3 cols always, shrinks gracefully */
      .demo-wrap .switcher .role-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        margin-bottom: 0.8rem;
      }

      /* Tab switcher — wrapping pills, no scroll */
      .demo-wrap .switcher .tab-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        border-top: 1px solid var(--ink-soft);
        padding-top: 0.65rem;
      }
      @media (max-width: 520px) {
        .demo-wrap .switcher .tab-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.4rem;
        }
        .demo-wrap .tab { text-align: center; white-space: normal; }
      }

      /* Buttons */
      .demo-wrap .btn {
        display: inline-block;
        padding: 9px 14px;
        border-radius: 999px;
        border: 1px solid var(--ink-soft);
        background: var(--paper);
        color: var(--ink);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        line-height: 1.3;
      }
      .demo-wrap .btn.approve { background: var(--red); color: #fff; border-color: var(--red); }
      .demo-wrap .btn.dismiss { background: var(--paper); color: var(--ink); border-color: var(--ink-soft); }
      .demo-wrap .switcher .role-row .btn { width: 100%; font-size: 12px; padding: 8px 10px; }

      /* Tab pills \u2014 red-glow active, red hover */
      .demo-wrap .tab {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1.5px solid var(--ink-soft);
        background: var(--paper);
        color: var(--ink);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }
      .demo-wrap .tab:hover {
        border-color: var(--red);
        color: var(--red);
        background: rgba(255,40,0,0.04);
      }
      .demo-wrap .tab-active {
        background: linear-gradient(180deg, var(--red) 0%, var(--red-deep, #c21a00) 100%);
        color: #fff;
        border-color: var(--red-deep, #c21a00);
        box-shadow: 0 4px 14px rgba(255,40,0,0.32), inset 0 1px 0 rgba(255,255,255,0.18);
        transform: translateY(-1px);
      }
      .demo-wrap .tab-active:hover { color: #fff; background: linear-gradient(180deg, var(--red) 0%, var(--red-deep, #c21a00) 100%); }

      /* Badges / tags */
      .demo-wrap .badge-coming { display: inline-block; background: var(--red); color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
      .demo-wrap .difficulty { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; }
      .demo-wrap .diff-easy     { background: #e7f6ed; color: #18a35a; }
      .demo-wrap .diff-standard { background: #eef2ff; color: #4257bf; }
      .demo-wrap .diff-hard     { background: #fff1d6; color: #b87100; }
      .demo-wrap .diff-brutal   { background: #ffe5e0; color: var(--red-deep); }
      .demo-wrap .role-tag { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: var(--paper-2); color: var(--muted); vertical-align: middle; }
      .demo-wrap .src-tag  { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: rgba(255,40,0,0.1); color: var(--red); margin-right: 6px; vertical-align: middle; }
      .demo-wrap .example-tag { display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; background: rgba(255,40,0,0.12); color: var(--red); vertical-align: middle; margin-left: 8px; }

      /* Browser-chrome dashboard frame so it's obviously the product */
      .demo-wrap .dash-frame {
        margin-top: 0.9rem;
        border: 1.5px solid var(--ink);
        border-radius: 14px;
        background: var(--paper-2, #f7f4ef);
        padding: 0;
        overflow: hidden;
        box-shadow: 0 16px 50px rgba(0,0,0,0.18), 0 4px 10px rgba(0,0,0,0.08);
      }
      .demo-wrap .dash-frame-chrome {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        background: linear-gradient(180deg, #ebe5d6 0%, #ddd5c2 100%);
        border-bottom: 1px solid var(--ink);
      }
      .demo-wrap .dash-frame-dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        display: inline-block;
        box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12);
      }
      .demo-wrap .dash-frame-url {
        margin-left: 12px;
        flex: 1;
        text-align: center;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--muted);
        letter-spacing: 0.04em;
        background: var(--paper, #fff);
        padding: 3px 10px;
        border-radius: 999px;
        max-width: 360px;
        margin-right: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .demo-wrap .dash-frame > section,
      .demo-wrap .dash-frame > div:not(.dash-frame-chrome) { margin-left: 1rem; margin-right: 1rem; }
      .demo-wrap .dash-frame > section:first-of-type { margin-top: 1rem; }
      .demo-wrap .dash-frame > section:last-child,
      .demo-wrap .dash-frame > div:last-child:not(.dash-frame-chrome) { margin-bottom: 1rem; }
      @media (max-width: 520px) {
        .demo-wrap .dash-frame > section,
        .demo-wrap .dash-frame > div:not(.dash-frame-chrome) { margin-left: 0.5rem; margin-right: 0.5rem; }
        .demo-wrap .dash-frame-url { display: none; }
      }
      .demo-wrap .score { font-size: 18px; font-weight: 700; color: var(--ink); }
      .demo-wrap .score-100 { display: inline-flex; align-items: baseline; gap: 2px; padding: 4px 10px; border-radius: 8px; background: rgba(255,40,0,0.06); border: 1px solid rgba(255,40,0,0.18); }
      .demo-wrap .score-100 strong { font-size: 18px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
      .demo-wrap .score-100-denom { font-size: 11px; color: var(--muted); font-weight: 600; letter-spacing: 0.04em; }
      .demo-wrap .rank  { color: var(--red); font-weight: 700; margin-right: 4px; }
      .demo-wrap .digest { background: var(--ink); color: #d8d8d8; padding: 1rem 1.1rem; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.55; overflow-x: auto; white-space: pre; margin: 0; }

      /* Expandables */
      .demo-wrap details.collapse { margin: 0; }
      .demo-wrap details.collapse > summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.6rem;
        flex-wrap: wrap;
        padding: 0.1rem 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--ink);
      }
      .demo-wrap details.collapse > summary::-webkit-details-marker { display: none; }
      .demo-wrap details.collapse > summary::after { content: '+'; margin-left: auto; color: var(--red); font-weight: 700; font-size: 18px; }
      .demo-wrap details.collapse[open] > summary::after { content: '—'; }
      .demo-wrap details.collapse > summary .sum-meta { font-size: 12px; font-weight: 500; color: var(--muted); }
      @media (max-width: 520px) {
        .demo-wrap details.collapse > summary { flex-direction: column; align-items: flex-start; gap: 0.15rem; }
        .demo-wrap details.collapse > summary::after { position: absolute; right: 1rem; }
        .demo-wrap details.collapse { position: relative; }
      }
    `}</style>
  )
}
