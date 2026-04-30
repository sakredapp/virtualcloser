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
  | 'wavv'
  | 'org'

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

type PipelineRow = {
  name: string
  meta: string
  status: 'HOT' | 'WARM' | 'COLD' | 'DORMANT'
  sub: string
  stage: 'Discovery' | 'Proposal' | 'Negotiation' | 'Dormant'
}
const PIPELINE: PipelineRow[] = [
  { name: 'Dana Ruiz', meta: 'Ruiz Consulting · $48K', status: 'HOT', sub: 'Discovery 9:30am · pricing + quick win', stage: 'Discovery' },
  { name: 'Malcolm Ortiz', meta: 'North Trail Co. · $22K', status: 'WARM', sub: 'Opened last 2 emails, no reply', stage: 'Discovery' },
  { name: 'Priya Shah', meta: 'Ledgerwise · $36K', status: 'WARM', sub: 'Proposal walkthrough 2pm', stage: 'Proposal' },
  { name: 'Nina Park', meta: 'Harbor & Main · $62K', status: 'HOT', sub: 'Visited pricing page 3x today', stage: 'Negotiation' },
  { name: 'Aisha Wu', meta: 'Cedar Labs · $14K', status: 'DORMANT', sub: '47 days quiet — script queued', stage: 'Dormant' },
  { name: 'Ben Foster', meta: 'Foster & Sons · $9K', status: 'COLD', sub: 'Cold outreach replied yesterday', stage: 'Discovery' },
]

const PIPELINE_STAGES: Array<PipelineRow['stage']> = ['Discovery', 'Proposal', 'Negotiation', 'Dormant']

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
  rep: ['overview', 'pipeline', 'dialer', 'wavv', 'roleplay', 'rooms', 'inbox'],
  manager: ['overview', 'leaderboard', 'dialer', 'wavv', 'roleplay', 'rooms', 'inbox', 'pipeline'],
  owner: ['overview', 'leaderboard', 'org', 'dialer', 'wavv', 'roleplay', 'rooms', 'inbox'],
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
      {currentTab === 'wavv' && <WavvView role={role} />}
      {currentTab === 'org' && <OrgView />}
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
    case 'wavv':
      return 'WAVV'
    case 'org':
      return 'Org'
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
      <div className="kanban">
        {PIPELINE_STAGES.map((stage) => {
          const leads = PIPELINE.filter((row) => row.stage === stage)
          return (
            <div key={stage} className="kanban-col">
              <p className="kanban-head">
                {stage}
                <span className="kanban-count">{leads.length}</span>
              </p>
              {leads.map((row) => (
                <div key={row.name} className="lead-card">
                  <p className="lead-name">{row.name}</p>
                  <p className="lead-meta">{row.meta}</p>
                  <p className="lead-meta">{row.sub}</p>
                  <div className="lead-actions">
                    <button className="dial-btn" disabled>Call now</button>
                    <span className={`status ${row.status.toLowerCase()}`}>{row.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
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
                : 'example past sessions — tap a row to listen'}
            </span>
          </summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            {(role === 'rep' ? SESSIONS.filter((s) => s.rep === 'Marcus Vega') : SESSIONS).map((s, i) => (
              <li key={i} className="row">
                <div>
                  <p className="name">{s.scenario}</p>
                  <p className="meta">{s.rep} · {s.mins} min · {s.ago}</p>
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

// ── Org chart view (owner only) ───────────────────────────────────────────

const ORG_TEAMS = [
  {
    name: 'East Team',
    manager: { name: 'Priya Shah', role: 'manager' },
    reps: [
      { name: 'Sarah Chen',  role: 'rep', dials: 94, appts: 7 },
      { name: 'Marcus Vega', role: 'rep', dials: 81, appts: 4 },
      { name: 'Aisha Wu',    role: 'rep', dials: 62, appts: 2 },
    ],
  },
  {
    name: 'West Team',
    manager: { name: 'Ben Foster', role: 'manager' },
    reps: [
      { name: 'Tom Park',    role: 'rep', dials: 53, appts: 1 },
      { name: 'Jordan Kim',  role: 'rep', dials: 71, appts: 3 },
    ],
  },
]

const ROLE_DOT: Record<string, string> = {
  owner: '#7c3aed', admin: '#1d4ed8', manager: '#0369a1', rep: '#374151', observer: '#9ca3af',
}

function OrgView() {
  return (
    <>
      {/* Owner node */}
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Organization chart</h2>
          <p>owner → managers → reps · live in your account, managed from the Org tab</p>
        </div>

        {/* Owner */}
        <div style={{ marginBottom: 16 }}>
          <p style={orgLabel}>Owner</p>
          <OrgChip name="Dana Ruiz" role="owner" />
        </div>

        {/* Connector line */}
        <div style={{ borderLeft: '2px solid #e5e7eb', marginLeft: 20, paddingLeft: 20, display: 'grid', gap: 14 }}>

          {ORG_TEAMS.map((team) => {
            const teamDials = team.reps.reduce((s, r) => s + r.dials, 0)
            const teamAppts = team.reps.reduce((s, r) => s + r.appts, 0)
            return (
              <div key={team.name} style={{ background: 'var(--paper, #fff)', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
                {/* Team header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>{team.name}</strong>
                  <span className="meta">{teamDials} dials · {teamAppts} appts this week</span>
                </div>

                {/* Manager */}
                <div style={{ marginBottom: 10 }}>
                  <p style={orgLabel}>Manager</p>
                  <OrgChip name={team.manager.name} role={team.manager.role} />
                </div>

                {/* Reps */}
                <div style={{ borderLeft: '2px solid #f3f4f6', marginLeft: 16, paddingLeft: 14 }}>
                  <p style={orgLabel}>Reps ({team.reps.length})</p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {team.reps.map((r) => (
                      <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <OrgChip name={r.name} role={r.role} compact />
                        <span className="meta" style={{ fontSize: 11 }}>{r.dials} dials · {r.appts} appts</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* What owners can do */}
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Org management</h2>
          <p>everything below is live in your account — no hardcoded structure</p>
        </div>
        <ul className="list">
          <li className="row">
            <div>
              <p className="name">Create + name teams</p>
              <p className="meta">East, West, Enterprise, SMB — whatever maps to your sales motion</p>
            </div>
            <div className="right"><span className="status good">LIVE</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Assign a manager to each team</p>
              <p className="meta">Dropdown of available managers — once assigned, removed from other options</p>
            </div>
            <div className="right"><span className="status good">LIVE</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Add reps to a team</p>
              <p className="meta">Each rep can only be in one team — reassigning moves them automatically</p>
            </div>
            <div className="right"><span className="status good">LIVE</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">WAVV KPIs per rep, per team, account-wide</p>
              <p className="meta">Each rep sets up their personal webhook URL in Integrations → you see their dials on the WAVV tab</p>
            </div>
            <div className="right"><span className="status good">LIVE</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Manager sees their team only · Owner sees all teams</p>
              <p className="meta">Data scoping enforced at the query layer — not just a UI filter</p>
            </div>
            <div className="right"><span className="status good">LIVE</span></div>
          </li>
        </ul>
      </section>

      {/* Unassigned pool */}
      <section className="card">
        <div className="section-head">
          <h2>Unassigned members</h2>
          <p>not yet placed in a team — drag into any team from the Org tab</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <OrgChip name="Alex Torres" role="rep" />
          <OrgChip name="Nina Reeves" role="observer" />
        </div>
      </section>
    </>
  )
}

const orgLabel: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: '#9ca3af', margin: '0 0 6px',
}

function OrgChip({ name, role, compact = false }: { name: string; role: string; compact?: boolean }) {
  const color = ROLE_DOT[role] ?? '#374151'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: 'var(--paper, #fff)', border: '1px solid #e5e7eb',
      borderRadius: 8, padding: compact ? '4px 10px' : '7px 12px', fontSize: compact ? 12 : 13,
    }}>
      <span style={{ fontWeight: 600 }}>{name}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, color, background: `${color}18`,
        borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>{role}</span>
    </div>
  )
}

// ── WAVV view ─────────────────────────────────────────────────────────────

const WAVV_REPS = [
  { id: 'r1', name: 'Sarah Chen',  team: 'East', dials: 94,  connects: 27, convs: 22, appts: 7, talkMin: 108 },
  { id: 'r2', name: 'Marcus Vega', team: 'East', dials: 81,  connects: 21, convs: 16, appts: 4, talkMin: 79  },
  { id: 'r3', name: 'Aisha Wu',    team: 'East', dials: 62,  connects: 14, convs: 10, appts: 2, talkMin: 52  },
  { id: 'r4', name: 'Priya Shah',  team: 'East', dials: 88,  connects: 26, convs: 21, appts: 6, talkMin: 97  },
  { id: 'r5', name: 'Ben Foster',  team: 'West', dials: 74,  connects: 18, convs: 13, appts: 3, talkMin: 63  },
  { id: 'r6', name: 'Tom Park',    team: 'West', dials: 53,  connects: 11, convs:  7, appts: 1, talkMin: 38  },
]

const WAVV_DAILY_ENT = [
  { day: 'Apr 24', east: 189, west: 112 },
  { day: 'Apr 25', east: 134, west:  84 },
  { day: 'Apr 26', east:  40, west:  22 },
  { day: 'Apr 27', east:   0, west:   0 },
  { day: 'Apr 28', east: 201, west: 118 },
  { day: 'Apr 29', east: 193, west: 109 },
  { day: 'Apr 30', east: 212, west: 127 },
]

const WAVV_RECENT_ENT = [
  { rep: 'Sarah Chen',  lead: 'Dana Ruiz',     phone: '(415) 555-0142', dur: '4m 12s', dispo: 'appointment_set' },
  { rep: 'Priya Shah',  lead: 'Malcolm Ortiz', phone: '(503) 555-0188', dur: '2m 44s', dispo: 'connected'       },
  { rep: 'Marcus Vega', lead: '—',             phone: '(214) 555-0119', dur: '0s',     dispo: 'no_answer'       },
  { rep: 'Sarah Chen',  lead: 'Nina Park',     phone: '(917) 555-0167', dur: '6m 01s', dispo: 'appointment_set' },
  { rep: 'Aisha Wu',    lead: 'Ben Foster',    phone: '(615) 555-0173', dur: '1m 03s', dispo: 'voicemail'       },
  { rep: 'Tom Park',    lead: '—',             phone: '(312) 555-0151', dur: '8s',     dispo: 'busy'            },
]

function DialerStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? '#fef3c7' : 'var(--paper)',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      padding: '8px 12px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0', color: '#0f172a' }}>{value}</p>
    </div>
  )
}

function dispoTone(d: string) {
  if (d === 'appointment_set') return 'good'
  if (d === 'connected') return 'warm'
  if (d === 'voicemail' || d === 'left_message') return 'dormant'
  return 'cold'
}

function WavvView({ role }: { role: Role }) {
  const eastReps = WAVV_REPS.filter((r) => r.team === 'East')
  const westReps = WAVV_REPS.filter((r) => r.team === 'West')
  const myRep    = WAVV_REPS[0] // Marcus Vega POV for rep; Sarah Chen for display

  const eastTotals = eastReps.reduce((a, r) => ({ dials: a.dials + r.dials, connects: a.connects + r.connects, convs: a.convs + r.convs, appts: a.appts + r.appts }), { dials: 0, connects: 0, convs: 0, appts: 0 })
  const westTotals = westReps.reduce((a, r) => ({ dials: a.dials + r.dials, connects: a.connects + r.connects, convs: a.convs + r.convs, appts: a.appts + r.appts }), { dials: 0, connects: 0, convs: 0, appts: 0 })
  const acctTotals = WAVV_REPS.reduce((a, r) => ({ dials: a.dials + r.dials, connects: a.connects + r.connects, convs: a.convs + r.convs, appts: a.appts + r.appts }), { dials: 0, connects: 0, convs: 0, appts: 0 })

  const visibleReps = role === 'rep' ? [myRep] : role === 'manager' ? eastReps : WAVV_REPS
  const visibleTotals = role === 'rep' ? { dials: myRep.dials, connects: myRep.connects, convs: myRep.convs, appts: myRep.appts } : role === 'manager' ? eastTotals : acctTotals
  const maxDials = Math.max(...WAVV_DAILY_ENT.map((d) => d.east + d.west))

  return (
    <>
      {/* KPI strip */}
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>WAVV · {role === 'rep' ? 'Your dials' : role === 'manager' ? 'East team · last 7 days' : 'All teams · last 7 days'}</h2>
          <p>live from GHL Call Status webhook → per-rep KPIs</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {([['Dials', visibleTotals.dials], ['Connects', visibleTotals.connects], ['Conversations', visibleTotals.convs], ['Appts set', visibleTotals.appts]] as [string, number][]).map(([label, value]) => (
            <div key={label} style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
              <div className="meta" style={{ marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Owner: per-team summary */}
      {role === 'owner' && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head"><h2>Team comparison</h2><p>last 7 days</p></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                <th style={{ padding: '6px 8px' }}>Team</th>
                <th style={{ padding: '6px 8px' }}>Reps</th>
                <th style={{ padding: '6px 8px' }}>Dials</th>
                <th style={{ padding: '6px 8px' }}>Connects</th>
                <th style={{ padding: '6px 8px' }}>Appts</th>
                <th style={{ padding: '6px 8px' }}>Connect %</th>
              </tr>
            </thead>
            <tbody>
              {([['East', eastTotals, 4], ['West', westTotals, 2]] as [string, typeof eastTotals, number][]).map(([team, t, repCount]) => (
                <tr key={team} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{team}</td>
                  <td style={{ padding: '6px 8px' }}>{repCount}</td>
                  <td style={{ padding: '6px 8px' }}>{t.dials}</td>
                  <td style={{ padding: '6px 8px' }}>{t.connects}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{t.appts}</td>
                  <td style={{ padding: '6px 8px' }}>{t.dials ? `${Math.round((t.connects / t.dials) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Daily trend (manager/owner) */}
      {role !== 'rep' && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head"><h2>Daily volume · last 7 days</h2><p>East vs West</p></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                <th style={{ padding: '6px 8px' }}>Day</th>
                {role === 'owner' && <th style={{ padding: '6px 8px' }}>East</th>}
                {role === 'owner' && <th style={{ padding: '6px 8px' }}>West</th>}
                <th style={{ padding: '6px 8px' }}>Total</th>
                <th style={{ padding: '6px 8px', width: '40%' }}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {WAVV_DAILY_ENT.map((d) => {
                const total = role === 'manager' ? d.east : d.east + d.west
                return (
                  <tr key={d.day} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{d.day}</td>
                    {role === 'owner' && <td style={{ padding: '6px 8px' }}>{d.east}</td>}
                    {role === 'owner' && <td style={{ padding: '6px 8px' }}>{d.west}</td>}
                    <td style={{ padding: '6px 8px' }}>{total}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ background: '#f1f1f1', borderRadius: 4, height: 8 }}>
                        <div style={{ width: `${(total / maxDials) * 100}%`, height: '100%', background: '#ff2800', borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Rep leaderboard (manager sees East, owner sees all) */}
      {role !== 'rep' && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Rep leaderboard</h2>
            <p>{role === 'manager' ? 'East team · last 7 days' : 'all reps · last 7 days'}</p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                {role === 'owner' && <th style={{ padding: '6px 8px' }}>Team</th>}
                <th style={{ padding: '6px 8px' }}>Rep</th>
                <th style={{ padding: '6px 8px' }}>Dials</th>
                <th style={{ padding: '6px 8px' }}>Connects</th>
                <th style={{ padding: '6px 8px' }}>Appts</th>
                <th style={{ padding: '6px 8px' }}>Connect %</th>
              </tr>
            </thead>
            <tbody>
              {[...visibleReps].sort((a, b) => b.appts - a.appts).map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  {role === 'owner' && <td style={{ padding: '6px 8px', color: '#6b7280', fontSize: 12 }}>{r.team}</td>}
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '6px 8px' }}>{r.dials}</td>
                  <td style={{ padding: '6px 8px' }}>{r.connects}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.appts}</td>
                  <td style={{ padding: '6px 8px' }}>{r.dials ? `${Math.round((r.connects / r.dials) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Rep: own stats */}
      {role === 'rep' && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head"><h2>Your trend · last 7 days</h2><p>Sarah Chen</p></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                <th style={{ padding: '6px 8px' }}>Day</th>
                <th style={{ padding: '6px 8px' }}>Dials</th>
                <th style={{ padding: '6px 8px' }}>Connects</th>
                <th style={{ padding: '6px 8px' }}>Appts</th>
              </tr>
            </thead>
            <tbody>
              {[{ day: 'Apr 24', d: 14, c: 4, a: 1 }, { day: 'Apr 25', d: 11, c: 3, a: 1 }, { day: 'Apr 26', d: 4, c: 1, a: 0 }, { day: 'Apr 27', d: 0, c: 0, a: 0 }, { day: 'Apr 28', d: 22, c: 7, a: 2 }, { day: 'Apr 29', d: 21, c: 6, a: 2 }, { day: 'Apr 30', d: 22, c: 6, a: 1 }].map((r) => (
                <tr key={r.day} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{r.day}</td>
                  <td style={{ padding: '6px 8px' }}>{r.d}</td>
                  <td style={{ padding: '6px 8px' }}>{r.c}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Recent calls */}
      <section className="card">
        <div className="section-head">
          <h2>Recent calls</h2>
          <p>{role === 'rep' ? 'your last 6' : role === 'manager' ? 'East team · last 6' : 'all reps · last 6'}</p>
        </div>
        <ul className="list">
          {(role === 'rep' ? WAVV_RECENT_ENT.filter((r) => r.rep === 'Sarah Chen') : WAVV_RECENT_ENT).map((c, i) => (
            <li key={i} className="row">
              <div>
                {role !== 'rep' && <p className="name">{c.rep} · {c.lead}</p>}
                {role === 'rep' && <p className="name">{c.lead} · {c.phone}</p>}
                <p className="meta">{c.dur} · {c.dispo.replace(/_/g, ' ')}</p>
              </div>
              <div className="right"><span className={`status ${dispoTone(c.dispo)}`}>{c.dispo.replace(/_/g, ' ').toUpperCase()}</span></div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

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
      label: 'AI Salespeople',
      color: '#1d4ed8',
      bg: '#eff6ff',
      sub: 'Multiple setters per team with scoped leads, scripts, and CRM routing.',
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

  // Org-wide hour package for the demo: Lighthouse Group bought 60 hrs/wk
  // and the owner allocates it across the org.
  const orgHours = {
    plan: 'AI SDR · 60 hrs/wk',
    capHours: 60,
    granted: 56, // owner has handed out 56 of 60
    teams: [
      {
        name: 'East team',
        manager: 'Priya Shah',
        managerHrs: 25, // owner gave manager 25 hrs to distribute
        managerUsed: 6.4,
        reps: [
          { name: 'Sarah Chen',  fromMgr: 12, used: 4.1 },
          { name: 'Marcus Vega', fromMgr: 8,  used: 1.6 },
          { name: 'Aisha Wu',    fromMgr: 5,  used: 0.7 },
        ],
      },
      {
        name: 'West team',
        manager: 'Ben Foster',
        managerHrs: 21,
        managerUsed: 3.0,
        reps: [
          { name: 'Tom Park',   fromMgr: 12, used: 2.1 },
          { name: 'Jordan Kim', fromMgr: 9,  used: 0.9 },
        ],
      },
    ],
    direct: [
      { name: 'Alex Torres', hrs: 6, used: 1.2 }, // owner→rep direct
      { name: 'Nina Reeves', hrs: 4, used: 0.0 },
    ],
  }
  const repWeek = {
    granted: 12, used: 4.1, // Sarah Chen as the demo rep
    modes: [
      { label: 'Appointment Setter', hrs: 6, used: 2.7, color: '#1d4ed8', bg: '#eff6ff' },
      { label: 'Receptionist',       hrs: 3, used: 0.9, color: '#166534', bg: '#ecfdf3' },
      { label: 'Live Transfer',      hrs: 2, used: 0.4, color: '#c2410c', bg: '#fff7ed' },
      { label: 'Workflows',          hrs: 1, used: 0.1, color: '#6b21a8', bg: '#f3e8ff' },
    ],
    shifts: [
      { day: 'Mon', start: '9am',  end: '12pm', mode: 'Appointment Setter' },
      { day: 'Tue', start: '9am',  end: '12pm', mode: 'Appointment Setter' },
      { day: 'Wed', start: '10am', end: '4pm',  mode: null },
      { day: 'Thu', start: '9am',  end: '5pm',  mode: null },
      { day: 'Fri', start: '9am',  end: '12pm', mode: 'Receptionist' },
    ],
  }

  return (
    <>
      {/* ── SDR hour package & allocation hierarchy ── */}
      <section className="card" style={{ marginBottom: '0.8rem', background: 'linear-gradient(120deg, #f0f9ff 0%, #ecfeff 100%)', borderColor: '#bae6fd' }}>
        <div className="section-head">
          <h2>{role === 'owner' ? 'AI SDR allocation' : role === 'manager' ? 'Your team\'s SDR pool' : 'Your SDR week'}</h2>
          <p>{orgHours.plan} · ISO week · resets Monday</p>
        </div>

        {role === 'owner' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
              <DialerStat label="Plan cap" value={`${orgHours.capHours}h/wk`} />
              <DialerStat label="Granted out" value={`${orgHours.granted}h`} />
              <DialerStat label="Unallocated" value={`${orgHours.capHours - orgHours.granted}h`} accent />
              <DialerStat label="Pool mode" value="Per-rep" />
            </div>
            {orgHours.teams.map((t) => (
              <div key={t.name} style={{ background: 'var(--paper)', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong>{t.name}</strong>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.managerHrs}h to {t.manager} · {t.managerUsed}h used</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                  {t.reps.map((r) => (
                    <li key={r.name} style={{ marginBottom: 2 }}>
                      <strong>{r.name}</strong> — {r.fromMgr}h from {t.manager} · {r.used}h used
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div style={{ background: 'var(--paper)', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 6px', letterSpacing: '0.06em' }}>
                Direct rep grants (bypass manager)
              </p>
              {orgHours.direct.map((d) => (
                <p key={d.name} style={{ fontSize: 12, margin: '2px 0' }}>
                  <strong>{d.name}</strong> — {d.hrs}h · {d.used}h used
                </p>
              ))}
            </div>
          </>
        )}

        {role === 'manager' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
              <DialerStat label="From owner" value="25h" />
              <DialerStat label="Distributed" value="25h" />
              <DialerStat label="Team used" value="12.8h" />
              <DialerStat label="Remaining (team)" value="12.2h" accent />
            </div>
            <p style={{ fontSize: 12, color: '#0f172a', margin: '0 0 6px', fontWeight: 600 }}>Your direct reports — Priya → reps</p>
            {orgHours.teams[0].reps.map((r) => (
              <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--paper)', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 4, fontSize: 13 }}>
                <span><strong>{r.name}</strong></span>
                <span style={{ color: 'var(--muted)' }}>{r.fromMgr}h granted · {r.used}h used</span>
              </div>
            ))}
          </>
        )}

        {role === 'rep' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
              <DialerStat label="Granted" value={`${repWeek.granted}h`} />
              <DialerStat label="Used" value={`${repWeek.used}h`} />
              <DialerStat label="Remaining" value={`${(repWeek.granted - repWeek.used).toFixed(1)}h`} accent />
              <DialerStat label="From" value="Priya (mgr)" />
            </div>
            <p style={{ fontSize: 12, color: '#0f172a', margin: '0 0 8px', fontWeight: 600 }}>Split your hours across modes</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 12 }}>
              {repWeek.modes.map((m) => {
                const pct = m.hrs > 0 ? Math.round((m.used / m.hrs) * 100) : 0
                return (
                  <div key={m.label} style={{ background: m.bg, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ color: m.color, fontSize: 12 }}>{m.label}</strong>
                      <span style={{ fontSize: 11, color: m.color, fontWeight: 700 }}>{pct}%</span>
                    </div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: m.color, margin: '0 0 2px' }}>{m.hrs}h</p>
                    <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                      <div style={{ background: m.color, width: `${pct}%`, height: 4 }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <p style={{ fontSize: 12, color: '#0f172a', margin: '0 0 6px', fontWeight: 600 }}>Shifts · {repWeek.shifts.length} scheduled</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {repWeek.shifts.map((s, i) => (
                <span
                  key={i}
                  style={{ fontSize: 11, background: 'var(--paper)', border: '1px solid #e5e7eb', padding: '4px 10px', borderRadius: 999, color: '#0f172a' }}
                >
                  <strong>{s.day}</strong> {s.start}–{s.end}
                  {s.mode && <span style={{ color: '#0369a1', marginLeft: 6 }}>· {s.mode}</span>}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Dialer modes</h2>
          <p>each mode has its own scripts, rules, analytics, and queue behavior</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={activeMode}
            onChange={(e) => setActiveMode(e.target.value as typeof activeMode)}
            style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', fontSize: 14, fontWeight: 600, background: '#fff', cursor: 'pointer', color: '#0f172a' }}
          >
            {modeSwatches.map((m) => (
              <option key={m.key} value={m.key}>{m.label} — {m.badge}</option>
            ))}
          </select>
          {(() => {
            const m = modeSwatches.find((x) => x.key === activeMode)!
            return <span style={{ background: m.bg, color: m.color, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.badge}</span>
          })()}
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

      {activeMode === 'appointment_setter' && <EnterpriseSetterDemo setterLabel={setterLabel} />}
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


// ── Enterprise AI Salespeople: book-of-business demo ─────────────────────

type EntSetter = { id: string; name: string; team: string; product: string; dials: number; appts: number; queue: number; tone: string; label: string }

const ENT_DEMO_SETTERS: EntSetter[] = [
  { id: 'mort_a',   name: 'Mortgage Setter A', team: 'East',  product: 'FHA refinance',     dials: 124, appts:  8, queue: 312, tone: 'good', label: 'HEALTHY'   },
  { id: 'solar_b',  name: 'Solar Setter B',    team: 'West',  product: 'Home solar consult', dials:  97, appts:  6, queue: 218, tone: 'warm', label: 'ACTIVE'    },
  { id: 'ins_c',    name: 'Insurance Setter C', team: 'Owners', product: 'Final expense',    dials:  61, appts:  3, queue: 144, tone: 'hot',  label: 'ATTENTION' },
  { id: 'mort_d',   name: 'Mortgage Setter D', team: 'East',  product: 'VA loan refi',       dials:  88, appts:  5, queue: 201, tone: 'good', label: 'HEALTHY'   },
]

const ENT_WORK_TABS = ['Dashboard', 'Leads', 'Followups', 'Calls', 'Pipeline']
const ENT_CFG_TABS  = ['Settings', 'Persona', 'Script', 'SMS', 'Email', 'Objections', 'Schedule', 'Calendar', 'Lead Rules', 'Integrations']
const ENT_CFG_IDS   = ['settings','persona','script','sms','email','objections','schedule','calendar','lead_rules','integrations']

function entPill(active: boolean, muted = false) {
  return {
    background: active ? '#ff2800' : muted ? '#f9fafb' : 'transparent',
    color:      active ? '#fff'    : muted ? '#6b7280' : '#374151',
    border:     active ? 'none'    : '1px solid #e5e7eb',
    borderRadius: 999, padding: '4px 12px',
    fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
  }
}

function EnterpriseSetterDemo({ setterLabel }: { setterLabel: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const [tab,  setTab]  = useState('dashboard')

  const setter = ENT_DEMO_SETTERS.find(s => s.id === open)

  if (setter) {
    return (
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button type="button" onClick={() => setOpen(null)}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: '#6b7280' }}>
            ← All setters
          </button>
          <strong style={{ fontSize: 15 }}>{setter.team} · {setter.name}</strong>
          <span className={`status ${setter.tone}`} style={{ fontSize: 11 }}>{setter.label}</span>
        </div>

        {/* Work pill row */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 38 }}>Work</span>
          {ENT_WORK_TABS.map(t => (
            <button key={t} type="button" onClick={() => setTab(t.toLowerCase())} style={entPill(tab === t.toLowerCase())}>{t}</button>
          ))}
        </div>
        {/* Config pill row */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderTop: '1px solid #f3f4f6', paddingTop: 4, marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 38 }}>Config</span>
          {ENT_CFG_TABS.map(t => {
            const id = t.toLowerCase().replace(' ', '_')
            return <button key={t} type="button" onClick={() => setTab(id)} style={entPill(tab === id, true)}>{t}</button>
          })}
        </div>

        {/* ── Dashboard ── */}
        {tab === 'dashboard' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              {([['Dials today', setter.dials, ''], ['Appts today', setter.appts, 'good'], ['In queue', setter.queue, ''],
                 ['Connect rate', '26%', ''], ['Appt rate', '7%', 'good'], ['Overdue callbacks', setter.tone === 'hot' ? 5 : 1, setter.tone === 'hot' ? 'warn' : '']] as [string, string|number, string][])
                .map(([label, val, tone]) => (
                  <div key={label} style={{ background: tone === 'good' ? '#dcfce7' : tone === 'warn' ? '#fef3c7' : '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: tone === 'good' ? '#15803d' : tone === 'warn' ? '#92400e' : '#0f172a' }}>{val}</div>
                    <div className="meta" style={{ marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10 }}>{label}</div>
                  </div>
              ))}
            </div>
            {setter.tone === 'hot' && (
              <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 12, color: '#92400e' }}>
                ⚠ 5 overdue callbacks need manager attention — 2 escalation-flagged calls in Needs Human Review
              </div>
            )}
            <p className="meta" style={{ fontWeight: 700, marginBottom: 4 }}>Recent calls</p>
            <ul className="list">
              <li className="row"><div><p className="name">Dana Ruiz · +1 (555) 210-3344</p><p className="meta">2m 41s · booked Thu 2:30 PM</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
              <li className="row"><div><p className="name">Marcus Cole · +1 (555) 876-0012</p><p className="meta">1m 18s · callback requested</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
              <li className="row"><div><p className="name">+1 (555) 433-9921</p><p className="meta">38s · no answer → voicemail</p></div><div className="right"><span className="status dormant">VOICEMAIL</span></div></li>
            </ul>
          </>
        )}

        {/* ── Leads ── */}
        {tab === 'leads' && (
          <>
            <p className="meta" style={{ marginBottom: 8 }}>{setter.queue} leads in queue</p>
            <ul className="list" style={{ marginBottom: 10 }}>
              <li className="row"><div><p className="name">+1 (555) 210-3344</p><p className="meta">3 attempts · booked</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
              <li className="row"><div><p className="name">+1 (555) 876-0012</p><p className="meta">2 attempts · callback</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
              <li className="row"><div><p className="name">+1 (555) 433-9921</p><p className="meta">1 attempt · no answer</p></div><div className="right"><span className="status dormant">QUEUED</span></div></li>
            </ul>
            <div style={{ border: '1px dashed #d1d5db', borderRadius: 8, padding: '10px 12px', background: '#fafafa', fontSize: 12 }}>
              <strong>CSV import</strong> — 2,000 rows uploaded · 1,942 accepted · 58 conflicts previewed across all setters
            </div>
          </>
        )}

        {/* ── Followups ── */}
        {tab === 'followups' && (
          <ul className="list">
            {setter.tone === 'hot' && <>
              <li className="row"><div><p className="name" style={{ color: '#b91c1c' }}>⚠ Escalation — needs human review</p><p className="meta">Prospect disputed terms · routed to manager</p></div><div className="right"><span className="status hot">ESCALATED</span></div></li>
              <li className="row"><div><p className="name" style={{ color: '#b91c1c' }}>⚠ Priya Shah — call callback overdue</p><p className="meta">Due yesterday · 5h overdue</p></div><div className="right"><span className="status cold">OVERDUE</span></div></li>
            </>}
            <li className="row"><div><p className="name">Jordan Watts — call callback</p><p className="meta">Due tomorrow 9:00 AM</p></div><div className="right"><span className="status warm">PENDING</span></div></li>
            <li className="row"><div><p className="name">Keisha Moore — SMS callback</p><p className="meta">Due today 4:00 PM</p></div><div className="right"><span className="status warm">PENDING</span></div></li>
          </ul>
        )}

        {/* ── Calls ── */}
        {tab === 'calls' && (
          <ul className="list">
            <li className="row"><div><p className="name">+1 (555) 210-3344 · outbound</p><p className="meta">2m 41s · booked · May 1 3:14 PM</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
            <li className="row"><div><p className="name">+1 (555) 876-0012 · outbound</p><p className="meta">1m 18s · callback · May 1 2:52 PM</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
            <li className="row"><div><p className="name">+1 (555) 433-9921 · outbound</p><p className="meta">38s · no answer · May 1 2:30 PM</p></div><div className="right"><span className="status dormant">VOICEMAIL</span></div></li>
            <li className="row"><div><p className="name">+1 (555) 120-8810 · outbound</p><p className="meta">4m 02s · escalation flagged · May 1 1:44 PM</p></div><div className="right"><span className="status hot">ESCALATED</span></div></li>
          </ul>
        )}

        {/* ── Pipeline ── */}
        {tab === 'pipeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([
              { stage: 'Appointment Set',     color: '#15803d', bg: '#dcfce7', leads: [`Dana Ruiz — Thu 2:30 PM`, `Jordan Watts — Fri 10:00 AM`] },
              { stage: 'Follow-Up Scheduled', color: '#92400e', bg: '#fef3c7', leads: ['Priya Shah (overdue)', 'Marcus Cole (overdue)', 'Keisha Moore (pending)'] },
              { stage: 'Needs Human Review',  color: '#78350f', bg: '#fde68a', leads: setter.tone === 'hot' ? ['Escalation: disputed terms', 'Escalation: hot prospect stalled'] : [] },
              { stage: 'Engaged',             color: '#1d4ed8', bg: '#dbeafe', leads: ['Liam Torres', 'Aisha Patel', 'Ray Ochoa'] },
              { stage: 'Contacted',           color: '#374151', bg: '#f3f4f6', leads: [`${Math.round(setter.queue * 0.3)} leads — 1–2 attempts, no connect`] },
              { stage: 'New Lead',            color: '#6b7280', bg: '#f9fafb', leads: [`${Math.round(setter.queue * 0.5)} leads — queued, not yet dialed`] },
            ] as {stage:string;color:string;bg:string;leads:string[]}[]).filter(s => s.leads.length > 0).map(({ stage, color, bg, leads }) => (
              <div key={stage} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ background: '#f8fafc', padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ background: bg, color, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{stage}</span>
                  <span className="meta">{leads.length} lead{leads.length !== 1 ? 's' : ''}</span>
                </div>
                <ul style={{ margin: 0, padding: '4px 12px 8px', listStyle: 'none' }}>
                  {leads.map(l => <li key={l} style={{ fontSize: 12, color: '#374151', padding: '2px 0' }}>{l}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ── Config tabs ── */}
        {ENT_CFG_IDS.includes(tab) && (
          <div style={{ padding: '14px 0', color: '#64748b', fontSize: 13 }}>
            <strong style={{ textTransform: 'capitalize', color: '#374151' }}>{tab.replace('_', ' ')}</strong> — per-setter config: scripts, persona, schedule, and CRM routing scoped to <em>{setter.team} · {setter.name}</em>. Changes here don&rsquo;t affect other setters.
          </div>
        )}
      </section>
    )
  }

  // ── Setter list view ──
  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>AI Salespeople</h2>
          <p>{setterLabel} · 9 active setters · 27 appointments set today · tap any setter to open its book of business</p>
        </div>
        <ul className="list">
          {ENT_DEMO_SETTERS.map(s => (
            <li key={s.id} className="row" style={{ cursor: 'pointer' }} onClick={() => { setOpen(s.id); setTab('dashboard') }}>
              <div>
                <p className="name">{s.team} · {s.name} · {s.product}</p>
                <p className="meta">{s.dials} dials today · {s.appts} appointments · {s.queue} in queue</p>
                <p className="meta" style={{ color: '#1d4ed8' }}>→ Dashboard / Leads / Followups / Calls / Pipeline</p>
              </div>
              <div className="right"><span className={`status ${s.tone}`}>{s.label}</span></div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="section-head">
          <h2>Cross-setter dedup protection</h2>
          <p>enterprise imports prevent duplicate phone ownership across all setters under the same account</p>
        </div>
        <pre className="code-block" style={{ margin: 0 }}>{`Tonight's import — East Team Setter B:
- 2,000 rows uploaded
- 1,942 accepted
- 58 conflicts previewed
  (already owned by other setters)

Action: "Skip conflicts and import rest"
Result: no ownership collisions written`}</pre>
      </section>
    </>
  )
}

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

      /* Tab pills — red-glow active, red hover */
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

      /* Kanban board (pipeline tab) */
      .demo-wrap .kanban {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.6rem;
      }
      @media (max-width: 900px) {
        .demo-wrap .kanban { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 520px) {
        .demo-wrap .kanban { grid-template-columns: 1fr; }
      }
      .demo-wrap .kanban-col {
        background: var(--paper-2, #f7f4ef);
        border: 1px solid var(--ink-soft, #e3ddd0);
        border-radius: 10px;
        padding: 0.7rem;
        min-height: 120px;
      }
      .demo-wrap .kanban-head {
        margin: 0 0 0.6rem;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .demo-wrap .kanban-count {
        background: var(--red);
        color: #fff;
        font-size: 10px;
        padding: 1px 7px;
        border-radius: 999px;
        font-weight: 700;
      }
      .demo-wrap .lead-card {
        background: var(--paper, #fff);
        border: 1px solid var(--ink-soft, #e3ddd0);
        border-radius: 8px;
        padding: 0.55rem 0.7rem;
        margin-bottom: 0.45rem;
        box-shadow: 0 1px 2px rgba(0,0,0,0.04);
      }
      .demo-wrap .lead-card:last-child { margin-bottom: 0; }
      .demo-wrap .lead-name {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--ink);
      }
      .demo-wrap .lead-meta {
        margin: 0.15rem 0 0;
        font-size: 11px;
        color: var(--muted);
      }
      .demo-wrap .lead-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.5rem;
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
