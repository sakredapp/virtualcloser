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
  | 'dialer'

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
    { label: 'My hot pipeline', value: '3 deals', hint: '$134K in play', tg: true },
    { label: 'My calls today', value: '2 booked', hint: '9:30am + 1pm' },
    { label: 'My tasks due today', value: '4', hint: 'coaching + admin', tg: true },
    { label: 'Team revenue pace', value: '$84.2K / $120K', hint: '70% · 8 days left' },
  ],
  owner: [
    { label: 'My pipeline', value: '2 deals', hint: '$1.43M at stake', tg: true },
    { label: 'My tasks today', value: '3', hint: 'approvals + calls', tg: true },
    { label: 'Account revenue', value: '$312K / $400K', hint: '78% · this month' },
    { label: 'At-risk escalations', value: '3 deals', hint: 'need attention today' },
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
  rep: ['overview', 'pipeline', 'dialer', 'roleplay', 'rooms', 'inbox'],
  manager: ['overview', 'leaderboard', 'dialer', 'roleplay', 'rooms', 'inbox', 'pipeline'],
  owner: ['overview', 'leaderboard', 'dialer', 'roleplay', 'rooms', 'inbox'],
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
      {currentTab === 'dialer' && <DialerView role={role} />}
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
    case 'dialer':
      return 'AI Dialer'
  }
}

// ── Views ────────────────────────────────────────────────────────────────

function OverviewView({ role }: { role: Role }) {
  const stats = OVERVIEW_STATS[role]
  return (
    <>
      {/* Personal stat cards — every role */}
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

      {/* Personal today + tasks — every role gets this */}
      <section className="grid-2" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>Today&rsquo;s plan</h2>
            <p><span className="src-tag">Calendar</span> Google + AI Dialer</p>
          </div>
          <ul className="list" style={{ maxHeight: 'none' }}>
            {role === 'rep' && (<>
              <li className="row">
                <div><p className="name">Dana Ruiz · discovery</p><p className="meta">Today 9:30 AM · Ruiz Consulting · $48K</p><p className="meta">Confirm call placed 8:45 AM — picked up, confirmed</p></div>
                <div className="right"><span className="status good">CONFIRMED</span></div>
              </li>
              <li className="row">
                <div><p className="name">Priya Shah · proposal walkthrough</p><p className="meta">Today 2:00 PM · Ledgerwise · $36K</p><p className="meta">No-answer on confirm — second attempt at 12:30 PM</p></div>
                <div className="right"><span className="status warm">PENDING</span></div>
              </li>
              <li className="row">
                <div><p className="name">Malcolm Ortiz · 30-min</p><p className="meta">Tomorrow 10:00 AM · North Trail Co.</p><p className="meta">Confirmation queued — fires 9:00 AM tomorrow</p></div>
                <div className="right"><span className="status cold">QUEUED</span></div>
              </li>
            </>)}
            {role === 'manager' && (<>
              <li className="row">
                <div><p className="name">1:1 with Sarah Chen</p><p className="meta">Today 9:30 AM · East team coaching</p><p className="meta">Her renewal scenario score dropped 8pts — address the close timing</p></div>
                <div className="right"><span className="status warm">TODAY</span></div>
              </li>
              <li className="row">
                <div><p className="name">Jordan Blake · proposal call</p><p className="meta">Today 1:00 PM · Blake Dental Group · $48K</p><p className="meta">My deal — confirm call placed 12:15 PM, confirmed verbally</p></div>
                <div className="right"><span className="status good">CONFIRMED</span></div>
              </li>
              <li className="row">
                <div><p className="name">East team pipeline review</p><p className="meta">Today 4:00 PM · 30 min</p><p className="meta">6 deals to walk through — prep doc in shared folder</p></div>
                <div className="right"><span className="status cold">QUEUED</span></div>
              </li>
            </>)}
            {role === 'owner' && (<>
              <li className="row">
                <div><p className="name">Everett Capital · final call</p><p className="meta">Today 10:00 AM · MSA in legal · $890K</p><p className="meta">CFO + procurement on the call — prep: payback moved to 6mo</p></div>
                <div className="right"><span className="status hot">HOT</span></div>
              </li>
              <li className="row">
                <div><p className="name">Westbridge Health · legal follow-up</p><p className="meta">Today 2:00 PM · $540K · BAA attached</p><p className="meta">Redlines addressed, awaiting counsel greenlight</p></div>
                <div className="right"><span className="status warm">WARM</span></div>
              </li>
              <li className="row">
                <div><p className="name">Q2 plan · owners room thread</p><p className="meta">Today EOD — async in owners room</p><p className="meta">Confirm East rollout date with Priya before 5pm</p></div>
                <div className="right"><span className="status cold">PENDING</span></div>
              </li>
            </>)}
          </ul>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Your tasks</h2>
            <p>personal · from Telegram, voice, AI Dialer</p>
          </div>
          <ul className="list" style={{ maxHeight: 'none' }}>
            {role === 'rep' && (<>
              <li className="row">
                <div><p className="name">Send Dana the case study</p><p className="meta">Due today 4pm</p></div>
                <div className="right"><span className="src-tag">Walkie</span></div>
              </li>
              <li className="row">
                <div><p className="name">Re-attempt price-objection scenario</p><p className="meta">Due Friday · Priya left a verdict</p></div>
                <div className="right"><span className="src-tag">Roleplay</span></div>
              </li>
              <li className="row">
                <div><p className="name">Reassign Aisha&rsquo;s Cedar Labs lead if still cold</p><p className="meta">Due today EOD</p></div>
                <div className="right"><span className="src-tag">Voice</span></div>
              </li>
              <li className="row">
                <div><p className="name">Follow up: Priya — voicemail from AI dialer</p><p className="meta">Due tomorrow 9am — auto-created</p></div>
                <div className="right"><span className="src-tag">AI Dialer</span></div>
              </li>
            </>)}
            {role === 'manager' && (<>
              <li className="row">
                <div><p className="name">Coach Tom on closes under 60s</p><p className="meta">Due today 3pm · voice memo from Tom 8:14am</p></div>
                <div className="right"><span className="src-tag">Voice</span></div>
              </li>
              <li className="row">
                <div><p className="name">Listen to Sarah&rsquo;s 91-score session · pull clips</p><p className="meta">Due tomorrow 8am · worth a team-room post</p></div>
                <div className="right"><span className="src-tag">Roleplay</span></div>
              </li>
              <li className="row">
                <div><p className="name">Draft Q2 quota plan for Dana</p><p className="meta">Due Friday</p></div>
                <div className="right"><span className="src-tag">You</span></div>
              </li>
              <li className="row">
                <div><p className="name">Review 3 escalations in the session queue</p><p className="meta">Due today · flagged by Priya</p></div>
                <div className="right"><span className="src-tag">Roleplay</span></div>
              </li>
            </>)}
            {role === 'owner' && (<>
              <li className="row">
                <div><p className="name">Approve voice-provider upgrade ($400/mo)</p><p className="meta">Due this week · after Friday leaderboard</p></div>
                <div className="right"><span className="src-tag">You</span></div>
              </li>
              <li className="row">
                <div><p className="name">Verdict on Tom&rsquo;s readiness blocking West rollout</p><p className="meta">Due tomorrow 5pm · coaching memo from West manager</p></div>
                <div className="right"><span className="src-tag">Voice</span></div>
              </li>
              <li className="row">
                <div><p className="name">Apex Health onboarding SLA breach (+4 days)</p><p className="meta">Due today · handoff stalled between CSM + implementation</p></div>
                <div className="right"><span className="src-tag">Fulfillment</span></div>
              </li>
              <li className="row">
                <div><p className="name">Loop back on Q2 plan — confirm East rollout date</p><p className="meta">Due today EOD · owners room thread</p></div>
                <div className="right"><span className="src-tag">Rooms</span></div>
              </li>
            </>)}
          </ul>
        </article>
      </section>

      {/* Role-specific additions after the personal section */}
      {role === 'rep' && (
        <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>Your roleplay queue</h2>
              <p>2 due Friday · self-assign anytime</p>
            </div>
            <ul className="list" style={{ maxHeight: 'none' }}>
              <li className="row">
                <div><p className="name">Trial-user about to churn</p><p className="meta">Assigned by Priya · best score 76 · 1 / 2 done</p></div>
                <div className="right"><span className="score-100"><strong>76</strong><span className="score-100-denom">/ 100</span></span></div>
              </li>
              <li className="row">
                <div><p className="name">Price objection · enterprise</p><p className="meta">Assigned by Priya · 0 / 2 done</p></div>
                <div className="right"><span className="status hot">START</span></div>
              </li>
              <li className="row">
                <div><p className="name">Discovery: cold-warm</p><p className="meta">Self-assigned · 1 / 1 done</p></div>
                <div className="right"><span className="score-100"><strong>84</strong><span className="score-100-denom">/ 100</span></span></div>
              </li>
            </ul>
          </section>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head"><h2>Your pipeline · top 5</h2><p>full board on the Pipeline tab</p></div>
            <ul className="list" style={{ maxHeight: 'none' }}>
              {PIPELINE.map((row) => (
                <li key={row.name} className="row">
                  <div><p className="name">{row.name}</p><p className="meta">{row.meta}</p><p className="meta">{row.sub}</p></div>
                  <div className="right"><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {role === 'manager' && (
        <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head"><h2>East team · this week</h2><p>your team — coaching queue + practice leaderboard</p></div>
            <ul className="list" style={{ maxHeight: 'none' }}>
              <li className="row">
                <div><p className="name">Reps practicing</p><p className="meta">5 / 6 — ↑ 2 vs last week. Ben Foster at 0 sessions — behind on price-objection assignment.</p></div>
                <div className="right"><span className="status warm">WATCH</span></div>
              </li>
              <li className="row">
                <div><p className="name">Sessions reviewed by you</p><p className="meta">12 / 18 — 6 in queue including Tom&rsquo;s escalate-flagged session</p></div>
                <div className="right"><span className="status cold">6 QUEUED</span></div>
              </li>
              <li className="row">
                <div><p className="name">Team room activity</p><p className="meta">14 posts last 24h — pricing sheet request from Marcus resolved</p></div>
                <div className="right"><span className="tg-chip">● via Telegram</span></div>
              </li>
            </ul>
          </section>
        </>
      )}

      {role === 'owner' && (
        <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head"><h2>Teams needing attention</h2><p>revenue pace + coaching health across all 4 teams</p></div>
            <ul className="list" style={{ maxHeight: 'none' }}>
              <li className="row">
                <div><p className="name">West team (Mgr: Koh) · 7 reps</p><p className="meta">$481K · pace +2% — discovery depth dropping, coaching tasks auto-created</p></div>
                <div className="right"><span className="status warm">WATCH</span></div>
              </li>
              <li className="row">
                <div><p className="name">South team (Mgr: Bennett) · 6 reps</p><p className="meta">$298K · pace -11% — 3 reps below activity floor</p></div>
                <div className="right"><span className="status risk">RISK</span></div>
              </li>
              <li className="row">
                <div><p className="name">Orion Retail expansion · SLA breach +2 days</p><p className="meta">Partner awaiting scoping doc — auto-ping sent to Mgr Koh</p></div>
                <div className="right"><span className="status warm">WATCH</span></div>
              </li>
            </ul>
          </section>
        </>
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
        <p>kanban view · drag to advance · tap <em>Call now</em> to fire the AI dialer</p>
      </div>
      <ul className="list" style={{ maxHeight: 'none' }}>
        {PIPELINE.map((row) => (
          <li key={row.name} className="row">
            <div>
              <p className="name">{row.name}</p>
              <p className="meta">{row.meta}</p>
              <p className="meta">{row.sub}</p>
            </div>
            <div className="right" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <span className={`status ${row.status.toLowerCase()}`}>{row.status}</span>
              <button className="dial-btn" disabled>Call now</button>
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

function DialerView({ role }: { role: Role }) {
  const [activeMode, setActiveMode] = useState<'receptionist' | 'appointment_setter' | 'live_transfer' | 'workflows'>('receptionist')

  const modeSwatches = [
    {
      key: 'receptionist' as const,
      label: 'Receptionist',
      color: '#166534',
      bg: '#ecfdf3',
      sub: 'Confirms and reschedules meetings automatically.',
      badge: 'LIVE',
    },
    {
      key: 'appointment_setter' as const,
      label: 'Appointment Setter',
      color: '#1d4ed8',
      bg: '#eff6ff',
      sub: 'Bulk lead import + daily booking targets.',
      badge: 'HOT',
    },
    {
      key: 'live_transfer' as const,
      label: 'Live Transfer',
      color: '#c2410c',
      bg: '#fff7ed',
      sub: 'Qualifies and instantly hands off hot leads.',
      badge: 'REAL-TIME',
    },
    {
      key: 'workflows' as const,
      label: 'Workflows',
      color: '#6b21a8',
      bg: '#f3e8ff',
      sub: 'Trigger outbound campaigns from pipeline events.',
      badge: 'AUTOMATED',
    },
  ]

  const transferAgents = [
    { name: 'Nina Park', status: 'Ready now', tone: 'good', eta: '<10s handoff' },
    { name: 'Ben Foster', status: 'Wrap-up', tone: 'warm', eta: 'ready in 2m' },
    { name: 'Aisha Wu', status: 'Offline', tone: 'dormant', eta: 'fallback to booking' },
  ]

  const workflowRules = [
    { name: 'No-show rescue', trigger: 'Meeting marked no-show', action: 'Call in 12 min + SMS fallback', queue: 3 },
    { name: 'Payment risk', trigger: 'Invoice 7+ days overdue', action: 'Call owner + transfer if disputed', queue: 5 },
    { name: 'Dormant revival', trigger: 'No stage movement in 30 days', action: 'Re-engagement script + calendar ask', queue: 11 },
  ]

  const outcomesLabel = role === 'rep' ? 'your meetings' : role === 'manager' ? 'East team meetings' : 'all teams'
  const setterLabel = role === 'rep' ? 'your setter session' : role === 'manager' ? 'East team setter sessions' : 'all teams · setter sessions'

  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Dialer modes</h2>
          <p>each mode has its own scripts, rules, analytics, and queue behavior</p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10,
          }}
        >
          {modeSwatches.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setActiveMode(m.key)}
              style={{
                textAlign: 'left',
                borderRadius: 10,
                border: activeMode === m.key ? `2px solid ${m.color}` : '1px solid #e5e7eb',
                background: '#fff',
                padding: '12px 14px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 800 }}>{m.label}</span>
                <span style={{ background: m.bg, color: m.color, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                  {m.badge}
                </span>
              </div>
              <p className="meta" style={{ marginTop: 6 }}>{m.sub}</p>
            </button>
          ))}
        </div>
      </section>

      {activeMode === 'receptionist' && (
        <>
          <section className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>Receptionist mode snapshot</h2>
              <p>{outcomesLabel} · today: 4 confirmations · 2 picked up · 1 rescheduled · 1 queued retry</p>
            </div>
            <ul className="list">
              <li className="row">
                <div>
                  <p className="name">Dana Ruiz · 9:30 AM today</p>
                  <p className="meta">Discovery · Ruiz Consulting · $48K</p>
                  <p className="meta">Confirm call placed 8:45 AM — picked up, confirmed verbally</p>
                </div>
                <div className="right"><span className="status good">CONFIRMED</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">Priya Shah · 2:00 PM today</p>
                  <p className="meta">Proposal walkthrough · Ledgerwise · $36K</p>
                  <p className="meta">No-answer on first attempt · second attempt fires 12:30 PM</p>
                </div>
                <div className="right"><span className="status warm">PENDING</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">Nina Park · 4:00 PM today</p>
                  <p className="meta">Negotiation · Harbor &amp; Main · $62K</p>
                  <p className="meta">Reschedule requested → AI moved to Wed 11 AM, calendar patched</p>
                </div>
                <div className="right"><span className="status good">RESCHEDULED</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">Malcolm Ortiz · tomorrow 10 AM</p>
                  <p className="meta">Discovery · North Trail Co.</p>
                  <p className="meta">Confirmation queued — fires 9:00 AM tomorrow</p>
                </div>
                <div className="right"><span className="status cold">QUEUED</span></div>
              </li>
            </ul>
          </section>

          <section className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>Post-call summaries</h2>
              <p>AI writes summary + next action after every call</p>
            </div>
            <ul className="list">
              <li className="row">
                <div>
                  <p className="name">Dana Ruiz · 14 min · Ruiz Consulting</p>
                  <p className="meta"><strong>Summary:</strong> Confirmed Thursday 2pm. Asked to bring her CFO. Mentioned current vendor contract ends June 1 — wants a price comparison sheet.</p>
                  <p className="meta"><strong>Next:</strong> Send 1-page pricing comparison before Thursday and add CFO to the calendar invite.</p>
                </div>
                <div className="right"><span className="status good">CONFIRMED</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">Priya Shah · 47 sec · Ledgerwise</p>
                  <p className="meta"><strong>Summary:</strong> Voicemail. Standard greeting — not personal. No response after second prompt.</p>
                  <p className="meta"><strong>Next:</strong> Auto-task created for tomorrow 9am — text Priya with Calendly link before next attempt.</p>
                </div>
                <div className="right"><span className="status warm">VOICEMAIL</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">Nina Park · 6 min · Harbor &amp; Main</p>
                  <p className="meta"><strong>Summary:</strong> Asked to reschedule from 4pm Thursday to Wednesday. Board meeting conflict. Otherwise still committed.</p>
                  <p className="meta"><strong>Next:</strong> Wed 11am locked in via Cal.com · calendar updated · meeting notes preserved.</p>
                </div>
                <div className="right"><span className="status good">RESCHEDULED</span></div>
              </li>
            </ul>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Reschedule transcript snippet</h2>
              <p>always closes on a specific slot, never a vague promise</p>
            </div>
            <div className="transcript">
              <div className="t-line"><span className="t-who lead">Lead</span><p>I can&rsquo;t do Thursday anymore.</p></div>
              <div className="t-line"><span className="t-who ai">AI</span><p>Got it. I can do Wednesday 11am or Thursday 3pm. Which works?</p></div>
              <div className="t-line"><span className="t-who lead">Lead</span><p>Wednesday 11.</p></div>
              <div className="t-line"><span className="t-who ai">AI</span><p>Perfect, Wednesday 11am is locked. Invite goes out in 2 minutes.</p></div>
            </div>
          </section>
        </>
      )}

      {activeMode === 'appointment_setter' && (
        <>
          <section className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>Appointment Setter control room</h2>
              <p>bulk import leads, configure workday, and set booking targets</p>
            </div>
            <div className="settings-grid" style={{ marginBottom: '0.7rem' }}>
              <div className="setting-card"><p className="setting-label">Daily target</p><p className="setting-value">8 appointments</p><p className="setting-hint">Mon-Fri</p></div>
              <div className="setting-card"><p className="setting-label">Dial window</p><p className="setting-value">9:00 AM - 5:00 PM</p><p className="setting-hint">Local timezone</p></div>
              <div className="setting-card"><p className="setting-label">Max dials/day</p><p className="setting-value">220</p><p className="setting-hint">Stops at target</p></div>
              <div className="setting-card"><p className="setting-label">Calendar</p><p className="setting-value">Jordan Reed</p><p className="setting-hint">Cal.com routing</p></div>
            </div>
            <div style={{ border: '1px dashed #d1d5db', borderRadius: 10, padding: '10px 12px', background: '#fafafa' }}>
              <p className="name" style={{ marginBottom: 4 }}>Lead import preview</p>
              <p className="meta" style={{ marginBottom: 8 }}>leads_april29.csv · 184 rows detected · 176 valid · 8 skipped (missing phone)</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="src-tag" style={{ background: '#eff6ff', color: '#1d4ed8' }}>CSV</span>
                <span className="src-tag" style={{ background: '#fef3c7', color: '#92400e' }}>XLSX accepted</span>
                <span className="src-tag" style={{ background: '#ecfdf3', color: '#166534' }}>Queue on save</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Today&rsquo;s setter session</h2>
              <p>{setterLabel} · 118 dials · 29 connects · 11 conversations · 5 appointments set</p>
            </div>
            <ul className="list">
              <li className="row"><div><p className="name">Qualified and booked</p><p className="meta">Dana Ruiz · Thu 2:30 PM · calendar invite sent</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
              <li className="row"><div><p className="name">Objection handled</p><p className="meta">Priya Shah · asked for pricing proof · callback tomorrow 10am</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
              <li className="row"><div><p className="name">Not qualified</p><p className="meta">No budget owner on call · AI marked as nurture</p></div><div className="right"><span className="status dormant">NURTURE</span></div></li>
            </ul>
          </section>
        </>
      )}

      {activeMode === 'live_transfer' && (
        <>
          <section className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>Live Transfer desk</h2>
              <p>AI qualifies first, then pushes hot calls to available closers instantly</p>
            </div>
            <ul className="list" style={{ marginBottom: '0.7rem' }}>
              {transferAgents.map((a) => (
                <li className="row" key={a.name}>
                  <div>
                    <p className="name">{a.name}</p>
                    <p className="meta">{a.eta}</p>
                  </div>
                  <div className="right"><span className={`status ${a.tone}`}>{a.status}</span></div>
                </li>
              ))}
            </ul>
            <div className="transcript">
              <div className="t-line"><span className="t-who ai">AI</span><p>Great, sounds like timing and budget are both approved. I can connect you to a specialist now.</p></div>
              <div className="t-line"><span className="t-who lead">Lead</span><p>Yes, connect me.</p></div>
              <div className="t-line note"><span className="t-note">Routing to Nina Park (available). Hand-off packet includes goals, objection notes, and transcript summary.</span></div>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Transfer queue</h2>
              <p>6 waiting · avg hold 32s · fallback booking if no rep frees up in 45s</p>
            </div>
            <ul className="list">
              <li className="row"><div><p className="name">Harbor &amp; Main</p><p className="meta">Qualified: yes · budget owner: yes · urgency: this week</p></div><div className="right"><span className="status good">TRANSFERRING</span></div></li>
              <li className="row"><div><p className="name">North Trail Co.</p><p className="meta">Qualified: partial · waiting for rep availability</p></div><div className="right"><span className="status warm">QUEUED</span></div></li>
              <li className="row"><div><p className="name">Cedar Labs</p><p className="meta">No rep available in SLA window, booking fallback started</p></div><div className="right"><span className="status dormant">FALLBACK</span></div></li>
            </ul>
          </section>
        </>
      )}

      {activeMode === 'workflows' && (
        <>
          <section className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>Workflow dialer rules</h2>
              <p>event-driven outbound automations connected to your pipeline</p>
            </div>
            <ul className="list">
              {workflowRules.map((r) => (
                <li key={r.name} className="row">
                  <div>
                    <p className="name">{r.name}</p>
                    <p className="meta">Trigger: {r.trigger}</p>
                    <p className="meta">Action: {r.action}</p>
                  </div>
                  <div className="right"><span className="status warm">{r.queue} queued</span></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Stage-triggered SMS workflows</h2>
              <p>GHL stage update · Twilio · per-tenant templates{role === 'rep' ? '' : ' · owner-editable'}</p>
            </div>
            <ul className="list">
              <li className="row">
                <div>
                  <p className="name">Discovery booked → SMS</p>
                  <p className="meta">&ldquo;Hi {'{first_name}'}, looking forward to our chat. Quick prep question: what&rsquo;s the #1 outcome you&rsquo;d need to see for this to be a win?&rdquo;</p>
                  <p className="meta">Fired 14× this week · 9 replies</p>
                </div>
                <div className="right"><span className="status good">ON</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">Proposal sent → SMS</p>
                  <p className="meta">&ldquo;{'{first_name}'} — proposal in your inbox. Anything jump out as a blocker?&rdquo;</p>
                  <p className="meta">Fired 8× · 5 replies · 2 closed-won</p>
                </div>
                <div className="right"><span className="status good">ON</span></div>
              </li>
              <li className="row">
                <div>
                  <p className="name">No-show → SMS</p>
                  <p className="meta">&ldquo;Hey {'{first_name}'}, missed you on the call — want me to send a couple new times?&rdquo;</p>
                  <p className="meta">Fired 3× · 3 reschedules booked</p>
                </div>
                <div className="right"><span className="status good">ON</span></div>
              </li>
            </ul>
          </section>
        </>
      )}
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
      .demo-wrap details.collapse {
        margin: 0 0 0.8rem;
        border: 1px solid var(--line, #e6e1d8);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        background: var(--paper, #fff);
      }
      .demo-wrap details.collapse[open] {
        box-shadow: 0 2px 10px rgba(15, 15, 15, 0.04);
      }
      .demo-wrap details.collapse[open] > summary {
        margin-bottom: 0.7rem;
        padding-bottom: 0.7rem;
        border-bottom: 1px solid var(--line, #e6e1d8);
      }
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

      /* Dialer view: settings grid */
      .demo-wrap .dialer-settings {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.6rem;
      }
      @media (max-width: 720px) { .demo-wrap .dialer-settings { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 420px) { .demo-wrap .dialer-settings { grid-template-columns: 1fr; } }
      .demo-wrap .setting-card {
        background: var(--paper);
        border: 1px solid var(--ink-soft);
        border-radius: 10px;
        padding: 0.75rem 0.9rem;
      }
      .demo-wrap .setting-label { margin: 0; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
      .demo-wrap .setting-value { margin: 0.3rem 0 0.15rem; font-size: 16px; font-weight: 700; color: var(--red); }
      .demo-wrap .setting-hint { margin: 0; font-size: 11px; color: var(--muted); }

      /* Reschedule transcript block */
      .demo-wrap .transcript {
        background: var(--paper);
        border: 1px solid var(--ink-soft);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        font-size: 13.5px;
        line-height: 1.55;
      }
      .demo-wrap .transcript .t-line {
        display: flex;
        gap: 0.7rem;
        align-items: flex-start;
        padding: 0.35rem 0;
        border-bottom: 1px dashed rgba(0,0,0,0.06);
      }
      .demo-wrap .transcript .t-line:last-child { border-bottom: 0; }
      .demo-wrap .transcript .t-line p { margin: 0; flex: 1; color: var(--ink); }
      .demo-wrap .transcript .t-who {
        flex-shrink: 0;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 2px 7px;
        border-radius: 4px;
        margin-top: 2px;
        min-width: 42px;
        text-align: center;
      }
      .demo-wrap .transcript .t-who.lead { background: var(--paper-2); color: var(--ink); }
      .demo-wrap .transcript .t-who.ai   { background: var(--red); color: #fff; }
      .demo-wrap .transcript .t-line.note { padding: 0.15rem 0 0.15rem 3.5rem; border-bottom: 0; }
      .demo-wrap .transcript .t-tooltip {
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--muted);
        background: rgba(255,40,0,0.06);
        border: 1px dashed rgba(255,40,0,0.25);
        padding: 2px 8px;
        border-radius: 4px;
      }

      /* Dial button (shared with pipeline rows) */
      .demo-wrap .dial-btn {
        background: var(--red);
        color: #fff;
        border: none;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 4px 10px;
        border-radius: 999px;
        cursor: not-allowed;
        opacity: 0.95;
      }
    `}</style>
  )
}
