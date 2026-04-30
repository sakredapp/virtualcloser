'use client'

import { useState } from 'react'
import Link from 'next/link'
import OfferTabs from '@/app/components/OfferTabs'

type Tab = 'overview' | 'pipeline' | 'dialer' | 'wavv' | 'roleplay' | 'analytics' | 'telegram'

const TABS: { key: Tab; label: string; sub: string }[] = [
  { key: 'overview',  label: 'Overview',    sub: 'Today, tasks, KPIs'        },
  { key: 'pipeline',  label: 'Pipeline',    sub: 'Leads + kanban'            },
  { key: 'dialer',    label: 'AI Dialer',   sub: 'Multi-mode + swatches'     },
  { key: 'wavv',      label: 'WAVV',        sub: 'Manual dialer KPIs'        },
  { key: 'roleplay',  label: 'Roleplay',    sub: 'Practice scenarios'        },
  { key: 'analytics', label: 'Analytics',   sub: 'Goals + activity'          },
  { key: 'telegram',  label: 'Telegram',    sub: 'Voice + text commands'     },
]

// ── Demo data ─────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Weekly close goal', value: '$4.2K / $8K', hint: 'pace · 3 days left', progress: 52, tg: true },
  { label: 'Calls booked this week', value: '9 / 15', hint: 'target you set Monday', progress: 60, tg: true },
  { label: 'Follow-ups queued', value: '11', hint: 'ready to approve' },
  { label: 'Priority today', value: 'Close Dana', hint: 'from your 7:42am voice note', tg: true },
]

const TODAY_PLAN = [
  { time: '9:30 AM', name: 'Dana Ruiz', co: 'Ruiz Consulting', type: 'Discovery', amount: '$48K', note: 'Confirm call placed 8:45 AM — picked up, confirmed', status: 'CONFIRMED', tone: 'good' },
  { time: '11:00 AM', name: 'Malcolm Ortiz', co: 'North Trail Co.', type: 'Follow-up', amount: '$22K', note: 'Opened last 2 emails, no reply — script queued', status: 'WARM', tone: 'warm' },
  { time: '2:00 PM', name: 'Priya Shah', co: 'Ledgerwise', type: 'Proposal', amount: '$36K', note: 'Rescheduled once — second confirm attempt at 12:30 PM', status: 'PENDING', tone: 'warm' },
  { time: '4:30 PM', name: 'Re-engage: Aisha Wu', co: 'Cedar Labs', type: 'Re-engage', amount: '$14K', note: '47 days quiet — re-engagement script queued', status: 'DORMANT', tone: 'dormant' },
]

const TASKS = [
  { title: 'Send Dana the case study', due: 'Today 4pm', source: 'Telegram', priority: 'high' },
  { title: 'Follow up: Priya — voicemail from AI dialer', due: 'Tomorrow 9am', source: 'AI Dialer', priority: 'high' },
  { title: 'Refresh Ledgerwise proposal numbers for Q2', due: 'Tomorrow 8am', source: 'Voice note', priority: 'med' },
  { title: 'Re-attempt price-objection roleplay scenario', due: 'Friday', source: 'Roleplay', priority: 'med' },
  { title: 'Call Ben Tracey re: pricing', due: 'May 31', source: 'Telegram', priority: 'low' },
]

const PIPELINE = [
  { stage: 'Discovery',    name: 'Dana Ruiz',      co: 'Ruiz Consulting',  amount: '$48K', status: 'HOT',     tone: 'hot',     note: 'Discovery 9:30am — confirm placed' },
  { stage: 'Discovery',    name: 'Malcolm Ortiz',  co: 'North Trail Co.',  amount: '$22K', status: 'WARM',    tone: 'warm',    note: 'Opened last 2 emails, no reply' },
  { stage: 'Discovery',    name: 'Ben Foster',     co: 'Foster & Sons',    amount: '$9K',  status: 'COLD',    tone: 'cold',    note: 'Cold outreach replied yesterday' },
  { stage: 'Proposal',     name: 'Priya Shah',     co: 'Ledgerwise',       amount: '$36K', status: 'WARM',    tone: 'warm',    note: 'Proposal walkthrough 2pm today' },
  { stage: 'Negotiation',  name: 'Nina Park',      co: 'Harbor & Main',    amount: '$62K', status: 'HOT',     tone: 'hot',     note: 'Visited pricing page 3x today' },
  { stage: 'Dormant',      name: 'Aisha Wu',       co: 'Cedar Labs',       amount: '$14K', status: 'DORMANT', tone: 'dormant', note: '47 days quiet — script queued' },
]

const PIPELINE_STAGES = ['Discovery', 'Proposal', 'Negotiation', 'Dormant']

const DIALER_CALLS = [
  { name: 'Dana Ruiz', co: 'Ruiz Consulting', time: '9:30 AM today', type: 'Discovery', amount: '$48K', note: 'Confirm call placed 8:45 AM — picked up, confirmed verbally', status: 'CONFIRMED', tone: 'good' },
  { name: 'Priya Shah', co: 'Ledgerwise', time: '2:00 PM today', type: 'Proposal', amount: '$36K', note: 'No-answer on first attempt · second attempt fires 12:30 PM', status: 'PENDING', tone: 'warm' },
  { name: 'Nina Park', co: 'Harbor & Main', time: '4:00 PM today', type: 'Negotiation', amount: '$62K', note: 'Reschedule requested → AI moved to Wed 11 AM, calendar patched', status: 'RESCHEDULED', tone: 'good' },
  { name: 'Malcolm Ortiz', co: 'North Trail Co.', time: 'Tomorrow 10 AM', type: 'Discovery', amount: '$22K', note: 'Confirmation queued — fires 9:00 AM tomorrow', status: 'QUEUED', tone: 'cold' },
]

const POSTCALL_SUMMARIES = [
  {
    name: 'Dana Ruiz',
    co: 'Ruiz Consulting',
    dur: '14 min',
    status: 'CONFIRMED',
    tone: 'good',
    summary: 'Confirmed Thursday 2pm. Asked to bring her CFO. Mentioned current vendor contract ends June 1 — wants a price comparison sheet.',
    next: 'Send 1-page pricing comparison before Thursday and add CFO to the calendar invite.',
  },
  {
    name: 'Priya Shah',
    co: 'Ledgerwise',
    dur: '47 sec',
    status: 'VOICEMAIL',
    tone: 'warm',
    summary: 'Voicemail. Standard greeting — not personal. No response after second prompt.',
    next: 'Auto-task created for tomorrow 9am — text Priya with Calendly link before next attempt.',
  },
  {
    name: 'Nina Park',
    co: 'Harbor & Main',
    dur: '6 min',
    status: 'RESCHEDULED',
    tone: 'good',
    summary: 'Asked to reschedule from 4pm Thursday to Wednesday. Board meeting conflict. Otherwise still committed.',
    next: 'Wed 11am locked in via Cal.com · calendar updated · meeting notes preserved.',
  },
]

const SMS_WORKFLOWS = [
  { stage: 'Discovery booked', template: 'Hi {first_name}, looking forward to our chat. Quick prep question: what\'s the #1 outcome you\'d need to see for this to be a win?', fires: 14, replies: 9, status: 'ON' },
  { stage: 'Proposal sent', template: '{first_name} — proposal in your inbox. Anything jump out as a blocker?', fires: 8, replies: 5, extra: '2 closed-won', status: 'ON' },
  { stage: 'No-show', template: 'Hey {first_name}, missed you on the call — want me to send a couple new times?', fires: 3, replies: 3, extra: '3 reschedules', status: 'ON' },
]

const SCENARIOS = [
  { name: 'Price objection · enterprise', difficulty: 'Hard', persona: 'Skeptical CFO at a 200-person firm', objections: 12, docs: 3, sessions: '0 / 2', status: 'START', tone: 'hot' },
  { name: 'Trial-user about to churn', difficulty: 'Standard', persona: 'PM who hasn\'t logged in for 11 days', objections: 8, docs: 2, sessions: '1 / 2', status: '76 / 100', tone: 'warm' },
  { name: 'Discovery: cold-warm', difficulty: 'Easy', persona: 'Curious operator from inbound form', objections: 5, docs: 4, sessions: '1 / 1', status: '84 / 100', tone: 'good' },
  { name: 'Renewal · price hike', difficulty: 'Brutal', persona: 'Owner who got a 22% renewal increase', objections: 14, docs: 3, sessions: '1 / 1', status: '88 / 100', tone: 'good' },
]

const ANALYTICS_STATS = [
  { label: 'Q2 revenue closed', value: '$14.8K', hint: 'vs $12.1K last Q2', progress: 58 },
  { label: 'Close rate', value: '28%', hint: '+4pts vs last month', progress: 28 },
  { label: 'Avg deal size', value: '$32K', hint: 'up from $27K', progress: 65 },
  { label: 'Calls booked (30d)', value: '47', hint: '18 confirmed · 6 no-show' },
]

const WEEKLY_ACTIVITY = [
  { day: 'Mon', calls: 4, tasks: 6 },
  { day: 'Tue', calls: 6, tasks: 8 },
  { day: 'Wed', calls: 3, tasks: 5 },
  { day: 'Thu', calls: 5, tasks: 7 },
  { day: 'Fri', calls: 2, tasks: 3 },
]

const TELEGRAM_COMMANDS = [
  { msg: '"Create a task: call Ben on the 31st about pricing"', ts: '7:42am', via: 'Text', result: 'Task created · due May 31 · linked to Ben Tracey in pipeline' },
  { msg: '"Dana marked no-show Tuesday, reschedule her for Thursday"', ts: '8:02am', via: 'Voice', result: 'No-show logged · new slot sent via Cal.com · pipeline updated' },
  { msg: '"Remind me — my Q2 target is 40 closed deals"', ts: '8:14am', via: 'Voice', result: 'Goal saved · progress 11/40 tracked on your dashboard' },
  { msg: '"Send Aisha the re-engagement draft"', ts: '9:11am', via: 'Text', result: 'Draft ready in your email · pending your approval' },
  { msg: '"Mark the Malcolm call done, he wants to revisit in Q3"', ts: '11:30am', via: 'Text', result: 'Task marked done · follow-up created for Q3 first week' },
  { msg: '"What\'s on my plate today?"', ts: '12:00pm', via: 'Text', result: '4 calls, 5 tasks — Dana is the priority, call is in 2 hours' },
]

// ── Main component ────────────────────────────────────────────────────────

export default function DemoPage() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <main className="wrap demo-wrap">
      <header className="hero">
        <h1 style={{ margin: '0 0 0.4rem' }}>See what your dashboard will actually look like.</h1>
        <p className="sub">
          A fully loaded individual operator. Every surface you get on day one — pipeline,
          AI dialer, roleplay, Telegram assistant — all from your phone.
        </p>
        <p className="nav">
          <Link href="/login">Client sign in</Link>
        </p>
      </header>

      <OfferTabs side="individual" view="demo" />

      <div className="dash-frame">
        <div className="dash-frame-chrome">
          <span className="dash-frame-dot" style={{ background: '#ff5f57' }} />
          <span className="dash-frame-dot" style={{ background: '#febc2e' }} />
          <span className="dash-frame-dot" style={{ background: '#28c840' }} />
          <span className="dash-frame-url">app.virtualcloser.com / dashboard</span>
        </div>

        {/* Tab bar */}
        <section className="card tab-nav" style={{ marginBottom: '0.8rem' }}>
          <div className="tab-row">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab ${tab === t.key ? 'tab-active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'overview'  && <OverviewTab  setTab={setTab} />}
        {tab === 'pipeline'  && <PipelineTab  />}
        {tab === 'dialer'    && <DialerTab    />}
        {tab === 'wavv'      && <WavvTab      />}
        {tab === 'roleplay'  && <RoleplayTab  />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'telegram'  && <TelegramTab  />}

      </div>{/* /dash-frame */}

      <DemoStyles />
    </main>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: Tab) => void }) {
  return (
    <>
      {/* KPI stat cards */}
      <section className="grid-4">
        {STATS.map((s) => (
          <article key={s.label} className="card stat">
            <p className="label">{s.label}</p>
            <p className="value small">{s.value}</p>
            {typeof s.progress === 'number' && (
              <div className="progress">
                <span style={{ width: `${Math.max(0, Math.min(100, s.progress))}%` }} />
              </div>
            )}
            {s.hint && <p className="hint">{s.hint}</p>}
            {s.tg && <span className="tg-chip">via Telegram</span>}
          </article>
        ))}
      </section>

      {/* Today's plan + Tasks side by side */}
      <section className="grid-2" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>Today&rsquo;s plan</h2>
            <p>synced to Google Calendar</p>
          </div>
          <ul className="list">
            {TODAY_PLAN.map((r) => (
              <li key={r.name} className="row">
                <div>
                  <p className="name">{r.time} — {r.name}</p>
                  <p className="meta">{r.co} · {r.type} · {r.amount}</p>
                  <p className="meta">{r.note}</p>
                </div>
                <div className="right">
                  <span className={`status ${r.tone}`}>{r.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Your tasks</h2>
            <p>5 active · from Telegram, voice, AI Dialer</p>
          </div>
          <ul className="list">
            {TASKS.map((t) => (
              <li key={t.title} className="row">
                <div>
                  <p className="name">{t.title}</p>
                  <p className="meta">Due {t.due}</p>
                </div>
                <div className="right">
                  <span className="src-tag">{t.source}</span>
                  <div style={{ marginTop: 4 }}>
                    <span className={`status ${t.priority === 'high' ? 'hot' : t.priority === 'med' ? 'warm' : 'cold'}`}>
                      {t.priority === 'high' ? 'TODAY' : t.priority === 'med' ? 'SOON' : 'LATER'}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </>
  )
}

// ── Pipeline tab ──────────────────────────────────────────────────────────

function PipelineTab() {
  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Your pipeline</h2>
          <p>drag to advance stages · tap Call now to fire the AI dialer immediately</p>
        </div>
        <div className="kanban">
          {PIPELINE_STAGES.map((stage) => {
            const leads = PIPELINE.filter((l) => l.stage === stage)
            return (
              <div key={stage} className="kanban-col">
                <p className="kanban-head">
                  {stage}
                  <span className="kanban-count">{leads.length}</span>
                </p>
                {leads.map((l) => (
                  <div key={l.name} className="lead-card">
                    <p className="lead-name">{l.name}</p>
                    <p className="lead-meta">{l.co} · {l.amount}</p>
                    <p className="lead-meta">{l.note}</p>
                    <div className="lead-actions">
                      <button className="dial-btn" disabled>Call now</button>
                      <span className={`status ${l.tone}`}>{l.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Pipeline signals</h2>
          <p><span className="src-tag">HubSpot</span> live sync via Zapier</p>
        </div>
        <ul className="list">
          <li className="row">
            <div>
              <p className="name">Nina Park · Harbor &amp; Main</p>
              <p className="meta">Negotiation · $62K — visited pricing page 3x today</p>
            </div>
            <div className="right"><span className="status hot">HOT</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Jordan Blake · Blake Dental</p>
              <p className="meta">Proposal stage advanced 2h ago · $48K</p>
            </div>
            <div className="right"><span className="status hot">HOT</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Luis Gómez · Meridian Home</p>
              <p className="meta">Follow-up · $22K — last touch 4 days ago, draft ready</p>
            </div>
            <div className="right"><span className="status warm">WARM</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Derek Tan · TanPak Logistics</p>
              <p className="meta">Objection: timing — auto-revisit scheduled Q3</p>
            </div>
            <div className="right"><span className="status cold">COLD</span></div>
          </li>
        </ul>
      </section>
    </>
  )
}

// ── AI Dialer tab ─────────────────────────────────────────────────────────

function DialerTab() {
  const [activeMode, setActiveMode] = useState<'receptionist' | 'appointment_setter' | 'live_transfer' | 'workflows'>('appointment_setter')

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
      sub: 'Run multiple AI salespeople with per-setter scripts, schedule, and lead ownership.',
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
              <p>today: 4 confirmations · 2 picked up · 1 rescheduled · 1 queued retry</p>
            </div>
            <ul className="list">
              {DIALER_CALLS.map((c) => (
                <li key={c.name} className="row">
                  <div>
                    <p className="name">{c.name} · {c.time}</p>
                    <p className="meta">{c.co} · {c.type} · {c.amount}</p>
                    <p className="meta">{c.note}</p>
                  </div>
                  <div className="right"><span className={`status ${c.tone}`}>{c.status}</span></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>Post-call summaries</h2>
              <p>AI writes summary + next action after every call</p>
            </div>
            <ul className="list">
              {POSTCALL_SUMMARIES.map((c) => (
                <li key={c.name} className="row">
                  <div>
                    <p className="name">{c.name} · {c.dur} · {c.co}</p>
                    <p className="meta"><strong>Summary:</strong> {c.summary}</p>
                    <p className="meta"><strong>Next:</strong> {c.next}</p>
                  </div>
                  <div className="right"><span className={`status ${c.tone}`}>{c.status}</span></div>
                </li>
              ))}
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

      {activeMode === 'appointment_setter' && <SetterDemoPanel />}

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
              <h2>Recent workflow triggers</h2>
              <p>latest events fired into queue + SMS follow-ups</p>
            </div>
            <ul className="list">
              {SMS_WORKFLOWS.map((w) => (
                <li key={w.stage} className="row">
                  <div>
                    <p className="name">{w.stage}</p>
                    <p className="meta" style={{ fontStyle: 'italic' }}>&ldquo;{w.template}&rdquo;</p>
                    <p className="meta">Fired {w.fires}x · {w.replies} replies{w.extra ? ` · ${w.extra}` : ''}</p>
                  </div>
                  <div className="right"><span className="status good">{w.status}</span></div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  )
}


// ── AI Salespeople: book-of-business demo ────────────────────────────────

type DemoSetter = { id: string; name: string; product: string; status: string; dials: number; appts: number; queue: number; tone: string; label: string }

const DEMO_SETTERS: DemoSetter[] = [
  { id: 'mortgage', name: 'Mortgage Setter', product: 'FHA refinance',     status: 'active', dials: 82, appts: 5, queue: 114, tone: 'good', label: 'RUNNING' },
  { id: 'solar',    name: 'Solar Setter',    product: 'Home solar consult', status: 'active', dials: 61, appts: 4, queue:  89, tone: 'warm', label: 'SCALING' },
  { id: 'insurance',name: 'Insurance Setter',product: 'Final expense',      status: 'paused', dials: 18, appts: 2, queue:  43, tone: 'cold', label: 'PAUSED'  },
]

const SETTER_WORK_TABS  = ['Dashboard', 'Leads', 'Followups', 'Calls', 'Pipeline']
const SETTER_CFG_TABS   = ['Settings', 'Persona', 'Script', 'SMS', 'Email', 'Objections', 'Schedule', 'Calendar', 'Lead Rules', 'Integrations']
const SETTER_CFG_IDS    = ['settings','persona','script','sms','email','objections','schedule','calendar','lead_rules','integrations']

function pillBtn(active: boolean, muted = false) {
  return {
    background: active ? '#ff2800' : muted ? '#f9fafb' : 'transparent',
    color:      active ? '#fff'    : muted ? '#6b7280' : '#374151',
    border:     active ? 'none'    : '1px solid #e5e7eb',
    borderRadius: 999, padding: '4px 12px',
    fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
  }
}

function SetterDemoPanel() {
  const [open, setOpen] = useState<string | null>('mortgage')
  const [tab,  setTab]  = useState('dashboard')

  const setter = DEMO_SETTERS.find(s => s.id === open)

  if (setter) {
    const isWork = !SETTER_CFG_IDS.includes(tab)
    return (
      <section className="card">
        {/* back + name bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button type="button" onClick={() => setOpen(null)}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: '#6b7280' }}>
            ← Setters
          </button>
          <strong style={{ fontSize: 15 }}>{setter.name}</strong>
          <span className={`status ${setter.tone}`} style={{ fontSize: 11 }}>{setter.label}</span>
        </div>

        {/* Work pill row */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 38 }}>Work</span>
          {SETTER_WORK_TABS.map(t => (
            <button key={t} type="button" onClick={() => setTab(t.toLowerCase())} style={pillBtn(tab === t.toLowerCase())}>{t}</button>
          ))}
        </div>
        {/* Config pill row */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderTop: '1px solid #f3f4f6', paddingTop: 4, marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 38 }}>Config</span>
          {SETTER_CFG_TABS.map(t => {
            const id = t.toLowerCase().replace(' ', '_')
            return <button key={t} type="button" onClick={() => setTab(id)} style={pillBtn(tab === id, true)}>{t}</button>
          })}
        </div>

        {/* ── Dashboard ── */}
        {tab === 'dashboard' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              {([['Dials today', setter.dials, ''], ['Appts today', setter.appts, 'good'], ['In queue', setter.queue, ''],
                 ['Connect rate', '24%', ''], ['Appt rate', '6%', 'good'], ['Overdue callbacks', 2, 'warn']] as [string, string|number, string][])
                .map(([label, val, tone]) => (
                  <div key={label} style={{ background: tone === 'good' ? '#dcfce7' : tone === 'warn' ? '#fef3c7' : '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: tone === 'good' ? '#15803d' : tone === 'warn' ? '#92400e' : '#0f172a' }}>{val}</div>
                    <div className="meta" style={{ marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10 }}>{label}</div>
                  </div>
              ))}
            </div>
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 12, color: '#92400e' }}>
              ⚠ 2 overdue callbacks — Priya Shah (SMS, due yesterday) · Marcus Cole (call, 3h overdue)
            </div>
            <p className="meta" style={{ fontWeight: 700, marginBottom: 4 }}>Recent calls</p>
            <ul className="list">
              <li className="row"><div><p className="name">Dana Ruiz · +1 (555) 210-3344</p><p className="meta">2m 41s · booked Thu 2:30 PM</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
              <li className="row"><div><p className="name">Marcus Cole · +1 (555) 876-0012</p><p className="meta">1m 18s · callback requested</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
              <li className="row"><div><p className="name">Unknown · +1 (555) 433-9921</p><p className="meta">38s · no answer → voicemail</p></div><div className="right"><span className="status dormant">VOICEMAIL</span></div></li>
            </ul>
          </>
        )}

        {/* ── Leads ── */}
        {tab === 'leads' && (
          <>
            <p className="meta" style={{ marginBottom: 8 }}>{setter.queue} leads in queue</p>
            <ul className="list" style={{ marginBottom: 10 }}>
              <li className="row"><div><p className="name">+1 (555) 210-3344</p><p className="meta">3 attempts · last outcome: booked</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
              <li className="row"><div><p className="name">+1 (555) 876-0012</p><p className="meta">2 attempts · last outcome: callback</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
              <li className="row"><div><p className="name">+1 (555) 433-9921</p><p className="meta">1 attempt · last outcome: no answer</p></div><div className="right"><span className="status dormant">QUEUED</span></div></li>
            </ul>
            <div style={{ border: '1px dashed #d1d5db', borderRadius: 8, padding: '10px 12px', background: '#fafafa', fontSize: 12 }}>
              <strong>CSV import</strong> — drop leads_may01.csv · 154 rows parsed · 149 accepted · 5 conflicts previewed before write
            </div>
          </>
        )}

        {/* ── Followups ── */}
        {tab === 'followups' && (
          <ul className="list">
            <li className="row"><div><p className="name" style={{ color: '#b91c1c' }}>⚠ Priya Shah — SMS callback</p><p className="meta">Due yesterday 10:00 AM · overdue</p></div><div className="right"><span className="status cold">OVERDUE</span></div></li>
            <li className="row"><div><p className="name" style={{ color: '#b91c1c' }}>⚠ Marcus Cole — call callback</p><p className="meta">Due today 2:00 PM · 3h overdue</p></div><div className="right"><span className="status cold">OVERDUE</span></div></li>
            <li className="row"><div><p className="name">Jordan Watts — call callback</p><p className="meta">Due tomorrow 9:00 AM</p></div><div className="right"><span className="status warm">PENDING</span></div></li>
          </ul>
        )}

        {/* ── Calls ── */}
        {tab === 'calls' && (
          <ul className="list">
            <li className="row"><div><p className="name">+1 (555) 210-3344 · outbound</p><p className="meta">2m 41s · booked · May 1 3:14 PM</p></div><div className="right"><span className="status good">BOOKED</span></div></li>
            <li className="row"><div><p className="name">+1 (555) 876-0012 · outbound</p><p className="meta">1m 18s · callback · May 1 2:52 PM</p></div><div className="right"><span className="status warm">FOLLOW-UP</span></div></li>
            <li className="row"><div><p className="name">+1 (555) 433-9921 · outbound</p><p className="meta">38s · no answer · May 1 2:30 PM</p></div><div className="right"><span className="status dormant">VOICEMAIL</span></div></li>
            <li className="row"><div><p className="name">+1 (555) 120-8810 · outbound</p><p className="meta">4m 02s · objection → nurture · May 1 1:44 PM</p></div><div className="right"><span className="status cold">NURTURE</span></div></li>
          </ul>
        )}

        {/* ── Pipeline ── */}
        {tab === 'pipeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([
              { stage: 'Appointment Set',     color: '#15803d', bg: '#dcfce7', leads: ['Dana Ruiz — Thu 2:30 PM', 'Jordan Watts — Fri 10:00 AM'] },
              { stage: 'Follow-Up Scheduled', color: '#92400e', bg: '#fef3c7', leads: ['Priya Shah (SMS overdue)', 'Marcus Cole (call overdue)', 'Jordan Watts (call tomorrow)'] },
              { stage: 'Engaged',             color: '#1d4ed8', bg: '#dbeafe', leads: ['Keisha Moore', 'Liam Torres'] },
              { stage: 'Contacted',           color: '#374151', bg: '#f3f4f6', leads: ['34 leads — 1–2 attempts, no connect yet'] },
              { stage: 'New Lead',            color: '#6b7280', bg: '#f9fafb', leads: ['67 leads — queued, not yet dialed'] },
            ] as {stage:string;color:string;bg:string;leads:string[]}[]).map(({ stage, color, bg, leads }) => (
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

        {/* ── Config tabs (illustrative) ── */}
        {SETTER_CFG_IDS.includes(tab) && (
          <div style={{ padding: '14px 0', color: '#64748b', fontSize: 13 }}>
            <strong style={{ textTransform: 'capitalize', color: '#374151' }}>{tab.replace('_', ' ')}</strong> — scripts, persona, schedule, and CRM routing are all scoped to <em>{setter.name}</em> and don&rsquo;t affect other AI Salespeople.
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
          <p>3 active · 246 leads loaded · 11 appointments set today · tap any setter to open its book of business</p>
        </div>
        <ul className="list">
          {DEMO_SETTERS.map(s => (
            <li key={s.id} className="row" style={{ cursor: 'pointer' }} onClick={() => { setOpen(s.id); setTab('dashboard') }}>
              <div>
                <p className="name">{s.name} · {s.product}</p>
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
          <h2>Lead import safety</h2>
          <p>each setter owns its phones — conflicts are previewed before any write</p>
        </div>
        <pre className="code-block" style={{ margin: 0 }}>{`Import preview — Solar Setter:
- 154 rows parsed
- 149 accepted
- 5 conflicts:
  +1 (555) 222-1199 → already owned by Mortgage Setter
  +1 (555) 222-8821 → already owned by Mortgage Setter

Action: "Skip conflicts and import rest"
Queue accepted: 149`}</pre>
      </section>
    </>
  )
}

// ── WAVV tab ──────────────────────────────────────────────────────────────
//
// Static demo of /dashboard/wavv. Same layout as the live page so prospects
// see exactly what they get when they buy the WAVV KPI add-on. Numbers are
// hand-picked to look like a real Day-7-of-the-month rep doing ~80 dials/day.

const WAVV_TODAY = {
  dials: 87,
  connects: 24,
  conversations: 17,
  appts: 4,
  talk_time: '1h 12m',
}

const WAVV_14D = {
  total_dials: 1142,
  connect_rate: 28,
  conversations: 218,
  conv_to_appt: 24,
}

// 14-day daily trend, oldest → newest with realistic Mon–Fri lift.
const WAVV_DAILY: { day: string; dials: number; connects: number; convs: number; appts: number }[] = [
  { day: 'Apr 16', dials: 92,  connects: 24, convs: 18, appts: 5 },
  { day: 'Apr 17', dials: 81,  connects: 22, convs: 16, appts: 4 },
  { day: 'Apr 18', dials: 64,  connects: 14, convs: 11, appts: 3 },
  { day: 'Apr 19', dials: 41,  connects:  8, convs:  6, appts: 1 },
  { day: 'Apr 20', dials: 12,  connects:  3, convs:  2, appts: 0 },
  { day: 'Apr 21', dials: 96,  connects: 28, convs: 21, appts: 6 },
  { day: 'Apr 22', dials: 102, connects: 31, convs: 24, appts: 7 },
  { day: 'Apr 23', dials: 88,  connects: 22, convs: 17, appts: 4 },
  { day: 'Apr 24', dials: 79,  connects: 21, convs: 16, appts: 5 },
  { day: 'Apr 25', dials: 53,  connects: 14, convs: 10, appts: 2 },
  { day: 'Apr 26', dials: 18,  connects:  4, convs:  3, appts: 0 },
  { day: 'Apr 27', dials: 94,  connects: 27, convs: 20, appts: 6 },
  { day: 'Apr 28', dials: 91,  connects: 26, convs: 19, appts: 5 },
  { day: 'Apr 29', dials: 87,  connects: 24, convs: 17, appts: 4 },
]

const WAVV_DISPOSITIONS = [
  { label: 'no_answer',    count: 412 },
  { label: 'voicemail',    count: 264 },
  { label: 'connected',    count: 198 },
  { label: 'left_message', count:  92 },
  { label: 'busy',         count:  71 },
  { label: 'wrong_number', count:  43 },
  { label: 'callback',     count:  31 },
  { label: 'appointment_set', count: 21 },
  { label: 'do_not_call',  count:  10 },
]

const WAVV_RECENT = [
  { time: 'Today 11:42 AM', lead: 'Dana Ruiz',     phone: '(415) 555-0142', dur: '4m 12s',  dispo: 'connected',       hasRec: true  },
  { time: 'Today 11:31 AM', lead: 'Malcolm Ortiz', phone: '(503) 555-0188', dur: '32s',     dispo: 'voicemail',       hasRec: true  },
  { time: 'Today 11:24 AM', lead: '—',             phone: '(214) 555-0119', dur: '0s',      dispo: 'no_answer',       hasRec: false },
  { time: 'Today 11:18 AM', lead: 'Priya Shah',    phone: '(917) 555-0167', dur: '6m 41s',  dispo: 'appointment_set', hasRec: true  },
  { time: 'Today 11:09 AM', lead: 'Ben Foster',    phone: '(615) 555-0173', dur: '1m 03s',  dispo: 'left_message',    hasRec: true  },
  { time: 'Today 10:54 AM', lead: 'Aisha Wu',      phone: '(720) 555-0149', dur: '8s',      dispo: 'busy',            hasRec: false },
  { time: 'Today 10:47 AM', lead: 'Nina Park',     phone: '(312) 555-0151', dur: '2m 58s',  dispo: 'callback',        hasRec: true  },
  { time: 'Today 10:33 AM', lead: '—',             phone: '(404) 555-0102', dur: '0s',      dispo: 'wrong_number',    hasRec: false },
]

function WavvTab() {
  const maxDailyDials = Math.max(...WAVV_DAILY.map((d) => d.dials))
  const dispoTotal = WAVV_DISPOSITIONS.reduce((s, d) => s + d.count, 0)

  return (
    <>
      {/* Connection banner */}
      <section
        className="card"
        style={{
          marginBottom: '0.8rem',
          background: 'rgba(34, 197, 94, 0.08)',
          borderLeft: '3px solid #22c55e',
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink)' }}>
          <strong style={{ color: '#16a34a' }}>● Live</strong> — receiving WAVV call dispositions via your GoHighLevel Call Status workflow webhook. Last event: <strong>32 seconds ago</strong>.
        </p>
      </section>

      {/* Today KPIs */}
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Today</h2>
          <p>fed live from your GHL → WAVV webhook</p>
        </div>
        <div className="grid-4" style={{ margin: 0, gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {([
            ['Dials', WAVV_TODAY.dials],
            ['Connects', WAVV_TODAY.connects],
            ['Conversations', WAVV_TODAY.conversations],
            ['Appts set', WAVV_TODAY.appts],
            ['Talk time', WAVV_TODAY.talk_time],
          ] as Array<[string, string | number]>).map(([label, value]) => (
            <article key={label} className="card stat">
              <p className="label">{label}</p>
              <p className="value small">{value}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 14-day rollup */}
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Last 14 days</h2>
          <p>connect + appointment ratios so you spot drift before it costs you a week</p>
        </div>
        <div className="grid-4" style={{ margin: 0 }}>
          {([
            ['Total dials', WAVV_14D.total_dials.toLocaleString()],
            ['Connect rate', `${WAVV_14D.connect_rate}%`],
            ['Conversations', WAVV_14D.conversations],
            ['Conv → appt', `${WAVV_14D.conv_to_appt}%`],
          ] as Array<[string, string | number]>).map(([label, value]) => (
            <article key={label} className="card stat">
              <p className="label">{label}</p>
              <p className="value small">{value}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Daily trend — collapsible */}
      <details className="card">
        <summary>
          <div className="section-head" style={{ marginBottom: 0, width: '100%' }}>
            <h2><span className="chev">▶</span>&nbsp;&nbsp;Daily trend</h2>
            <p>last 14 days · click to expand</p>
          </div>
        </summary>
        <div className="scroll-x" style={{ marginTop: '0.6rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px', width: '14%' }}>Day</th>
                <th style={{ padding: '6px 8px', width: '10%' }}>Dials</th>
                <th style={{ padding: '6px 8px', width: '12%' }}>Connects</th>
                <th style={{ padding: '6px 8px', width: '10%' }}>Convs</th>
                <th style={{ padding: '6px 8px', width: '10%' }}>Appts</th>
                <th style={{ padding: '6px 8px' }}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {WAVV_DAILY.map((k) => (
                <tr key={k.day} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{k.day}</td>
                  <td style={{ padding: '6px 8px' }}>{k.dials}</td>
                  <td style={{ padding: '6px 8px' }}>{k.connects}</td>
                  <td style={{ padding: '6px 8px' }}>{k.convs}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{k.appts}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ background: '#f1f1f1', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${(k.dials / maxDailyDials) * 100}%`, height: '100%', background: 'var(--red)', borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Disposition mix — collapsible */}
      <details className="card">
        <summary>
          <div className="section-head" style={{ marginBottom: 0, width: '100%' }}>
            <h2><span className="chev">▶</span>&nbsp;&nbsp;Disposition mix · last 30 days</h2>
            <p>raw WAVV labels · click to expand</p>
          </div>
        </summary>
        <ul className="list" style={{ display: 'grid', gap: 6, marginTop: '0.6rem', listStyle: 'none', padding: 0 }}>
          {WAVV_DISPOSITIONS.map((d) => {
            const pct = Math.round((d.count / dispoTotal) * 100)
            return (
              <li
                key={d.label}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <span style={{ width: 150, fontFamily: 'ui-monospace, monospace', fontSize: 12, flexShrink: 0 }}>
                  {d.label}
                </span>
                <div style={{ flex: 1, background: '#f1f1f1', borderRadius: 4, height: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'var(--red)',
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span style={{ width: 90, textAlign: 'right', fontSize: 12, flexShrink: 0 }}>
                  {d.count} <span style={{ color: 'var(--muted)' }}>({pct}%)</span>
                </span>
              </li>
            )
          })}
        </ul>
      </details>

      {/* Recent calls */}
      <section className="card">
        <div className="section-head">
          <h2>Recent calls</h2>
          <p>auto-linked to the matching lead in your pipeline · recordings stream from WAVV</p>
        </div>
        <div className="scroll-x">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: '6px 8px' }}>Time</th>
              <th style={{ padding: '6px 8px' }}>Lead</th>
              <th style={{ padding: '6px 8px' }}>To</th>
              <th style={{ padding: '6px 8px' }}>Duration</th>
              <th style={{ padding: '6px 8px' }}>Disposition</th>
              <th style={{ padding: '6px 8px' }}>Recording</th>
            </tr>
          </thead>
          <tbody>
            {WAVV_RECENT.map((c, i) => (
              <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px' }}>{c.time}</td>
                <td style={{ padding: '6px 8px' }}>{c.lead}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{c.phone}</td>
                <td style={{ padding: '6px 8px' }}>{c.dur}</td>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{c.dispo}</span>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  {c.hasRec ? (
                    <span style={{ color: 'var(--red)' }}>▶ play</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* What you actually get blurb */}
      <section
        className="card"
        style={{ marginTop: '0.8rem', background: 'var(--paper-alt, #f7f4ef)' }}
      >
        <div className="section-head">
          <h2>What you actually get</h2>
          <p>$20/mo · unlimited dials · zero WAVV API access required</p>
        </div>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
          <li>Every WAVV call you place inside GoHighLevel auto-flows to this dashboard. No exports, no spreadsheets.</li>
          <li>Daily KPIs (dials, connects, conversations, appts, talk time) update within seconds of the call ending.</li>
          <li>Raw disposition labels surface so you see <em>exactly</em> what your agents are marking — and when "no_answer" starts spiking week-over-week.</li>
          <li>Calls auto-link to leads in your VC pipeline by GHL contact ID (and phone last-10 as fallback). Click a call → jump to the lead.</li>
          <li>Recording playback streams direct from WAVV / GHL — we never store the audio, just the link.</li>
          <li>Rolls up cleanly into the leaderboard add-on for team accounts.</li>
        </ul>
      </section>
    </>
  )
}

// ── Roleplay tab ──────────────────────────────────────────────────────────

function RoleplayTab() {
  return (
    <>
      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Your assigned scenarios</h2>
          <p>2 due Friday · self-assign anytime</p>
        </div>
        <ul className="list">
          {SCENARIOS.map((s) => (
            <li key={s.name} className="row">
              <div>
                <p className="name">{s.name}</p>
                <p className="meta">{s.persona}</p>
                <p className="meta">{s.objections} objections · {s.docs} training docs</p>
              </div>
              <div className="right">
                <span className={`difficulty diff-${s.difficulty.toLowerCase()}`}>{s.difficulty}</span>
                <div style={{ marginTop: 4 }}>
                  <span className={`status ${s.tone}`}>{s.status}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>This month · usage</h2>
          <p>12 sessions · 142 min · avg score 82</p>
        </div>
        <ul className="list">
          <li className="row">
            <div>
              <p className="name">Renewal · price hike</p>
              <p className="meta">Self-assigned · 1 session · 16 min · yesterday</p>
            </div>
            <div className="right">
              <span className="score-100"><strong>88</strong><span className="score-100-denom">/ 100</span></span>
            </div>
          </li>
          <li className="row">
            <div>
              <p className="name">Discovery: cold-warm</p>
              <p className="meta">Self-assigned · 1 session · 9 min · 2 days ago</p>
            </div>
            <div className="right">
              <span className="score-100"><strong>84</strong><span className="score-100-denom">/ 100</span></span>
            </div>
          </li>
          <li className="row">
            <div>
              <p className="name">Trial-user about to churn</p>
              <p className="meta">Assigned · 1 session · 8 min · 3 days ago · debrief: clipped the close at 0:48</p>
            </div>
            <div className="right">
              <span className="score-100"><strong>76</strong><span className="score-100-denom">/ 100</span></span>
            </div>
          </li>
          <li className="row">
            <div>
              <p className="name">Price objection · enterprise</p>
              <p className="meta">Assigned · 0 sessions completed</p>
            </div>
            <div className="right"><span className="status hot">START</span></div>
          </li>
        </ul>
      </section>
    </>
  )
}

// ── Analytics tab ─────────────────────────────────────────────────────────

function AnalyticsTab() {
  const maxCalls = Math.max(...WEEKLY_ACTIVITY.map((d) => d.calls))
  const maxTasks = Math.max(...WEEKLY_ACTIVITY.map((d) => d.tasks))
  return (
    <>
      <section className="grid-4" style={{ marginBottom: '0.8rem' }}>
        {ANALYTICS_STATS.map((s) => (
          <article key={s.label} className="card stat">
            <p className="label">{s.label}</p>
            <p className="value small">{s.value}</p>
            {typeof s.progress === 'number' && (
              <div className="progress">
                <span style={{ width: `${s.progress}%` }} />
              </div>
            )}
            <p className="hint">{s.hint}</p>
          </article>
        ))}
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>This week · activity</h2>
            <p>calls booked vs tasks completed</p>
          </div>
          <div className="bar-chart">
            {WEEKLY_ACTIVITY.map((d) => (
              <div key={d.day} className="bar-group">
                <div className="bars">
                  <div
                    className="bar bar-calls"
                    style={{ height: `${(d.calls / maxCalls) * 100}%` }}
                    title={`${d.calls} calls`}
                  />
                  <div
                    className="bar bar-tasks"
                    style={{ height: `${(d.tasks / maxTasks) * 100}%` }}
                    title={`${d.tasks} tasks`}
                  />
                </div>
                <p className="bar-label">{d.day}</p>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><span className="legend-dot" style={{ background: 'var(--red)' }} />Calls</span>
            <span><span className="legend-dot" style={{ background: 'var(--ink)' }} />Tasks</span>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Goal progress · Q2</h2>
            <p>set via Telegram · tracked automatically</p>
          </div>
          <ul className="list">
            <li className="row">
              <div>
                <p className="name">Close 40 deals</p>
                <p className="meta">11 closed · 6 in final stage</p>
                <div className="progress" style={{ margin: '0.4rem 0 0' }}><span style={{ width: '27%' }} /></div>
              </div>
              <div className="right"><span className="label-sm">27%</span></div>
            </li>
            <li className="row">
              <div>
                <p className="name">$100K revenue</p>
                <p className="meta">$14.8K closed · pace +8%</p>
                <div className="progress" style={{ margin: '0.4rem 0 0' }}><span style={{ width: '15%' }} /></div>
              </div>
              <div className="right"><span className="label-sm">15%</span></div>
            </li>
            <li className="row">
              <div>
                <p className="name">15 calls booked / week</p>
                <p className="meta">9 this week · on track</p>
                <div className="progress" style={{ margin: '0.4rem 0 0' }}><span style={{ width: '60%' }} /></div>
              </div>
              <div className="right"><span className="label-sm">60%</span></div>
            </li>
            <li className="row">
              <div>
                <p className="name">Roleplay: score 85+</p>
                <p className="meta">Avg 82 this month · +8 vs last month</p>
                <div className="progress" style={{ margin: '0.4rem 0 0' }}><span style={{ width: '82%' }} /></div>
              </div>
              <div className="right"><span className="label-sm">82</span></div>
            </li>
          </ul>
        </article>
      </section>
    </>
  )
}

// ── Telegram tab ──────────────────────────────────────────────────────────

function TelegramTab() {
  return (
    <>
      <section className="grid-2" style={{ marginBottom: '0.8rem' }}>
        <article className="card">
          <div className="section-head"><h2>How it works</h2><p>your personal AI assistant · always on</p></div>
          <ul className="list">
            <li className="row">
              <div>
                <p className="name">Talk to it like a person</p>
                <p className="meta">Text or send a voice note. &ldquo;Create a task,&rdquo; &ldquo;log a call,&rdquo; &ldquo;what&rsquo;s on my plate today&rdquo; — it knows your pipeline, your goals, your calendar.</p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">It writes to your dashboard</p>
                <p className="meta">Everything you say lands in the right place — tasks on your task list, goals on your analytics, calls on your timeline. No manual entry.</p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">It pushes back when things need attention</p>
                <p className="meta">Morning scan at 9am, midday pulse at noon, AI dialer outcomes as they happen, dormant lead alerts. It messages you — you don&rsquo;t have to check in.</p>
              </div>
            </li>
          </ul>
        </article>

        <article className="card">
          <div className="section-head"><h2>Last 24h · processed commands</h2><p>voice notes auto-transcribed · text parsed instantly</p></div>
          <ul className="list">
            {TELEGRAM_COMMANDS.map((c, i) => (
              <li key={i} className="row">
                <div>
                  <p className="name">
                    <span className="src-tag">{c.via}</span>
                    {c.msg}
                  </p>
                  <p className="meta">{c.ts} — {c.result}</p>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Morning scan · what it sends you at 9am</h2>
          <p>delivered every weekday · your day in plain English</p>
        </div>
        <pre className="digest">{`Good morning. Here's your day.

4 calls today:
  9:30 AM  Dana Ruiz (discovery) — HOT. Confirm call placed, she picked up.
  11:00 AM Malcolm Ortiz (follow-up) — opened your last 2 emails.
  2:00 PM  Priya Shah (proposal) — rescheduled once, second confirm fires 12:30.
  4:30 PM  Re-engage Aisha Wu — 47 days quiet, script ready if you want it.

5 tasks due:
  Today:     Send Dana the case study. Follow up Priya (voicemail).
  Tomorrow:  Refresh Ledgerwise numbers. Dialer follow-up.
  Friday:    Re-attempt price-objection roleplay.

Biggest lever: close Dana today. She's ready.`}</pre>
      </section>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

function DemoStyles() {
  return (
    <style jsx global>{`
      /* ── Layout ── */
      .demo-wrap .dash-frame {
        margin-top: 0.9rem;
        border: 1.5px solid var(--ink, #0f0f0f);
        border-radius: 14px;
        background: var(--paper-2, #f7f4ef);
        padding: 0;
        overflow: hidden;
        box-shadow: 0 16px 50px rgba(0,0,0,0.18), 0 4px 10px rgba(0,0,0,0.08);
      }
      .demo-wrap .dash-frame-chrome {
        display: flex; align-items: center; gap: 6px;
        padding: 10px 14px;
        background: linear-gradient(180deg, #ebe5d6 0%, #ddd5c2 100%);
        border-bottom: 1px solid var(--ink, #0f0f0f);
      }
      .demo-wrap .dash-frame-dot {
        width: 11px; height: 11px; border-radius: 50%; display: inline-block;
        box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12);
      }
      .demo-wrap .dash-frame-url {
        margin-left: 12px; flex: 1; text-align: center;
        font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--muted, #5a5a5a); letter-spacing: 0.04em;
        background: var(--paper, #fff); padding: 3px 10px; border-radius: 999px;
        max-width: 360px; margin-right: auto;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .demo-wrap .dash-frame > section,
      .demo-wrap .dash-frame > .tab-nav { margin-left: 1rem; margin-right: 1rem; }
      .demo-wrap .dash-frame > section:first-of-type,
      .demo-wrap .dash-frame > .tab-nav:first-of-type { margin-top: 1rem; }
      .demo-wrap .dash-frame > section:last-child { margin-bottom: 1rem; }
      @media (max-width: 520px) {
        .demo-wrap .dash-frame > section,
        .demo-wrap .dash-frame > .tab-nav { margin-left: 0.5rem; margin-right: 0.5rem; }
        .demo-wrap .dash-frame-url { display: none; }
      }

      /* ── Tab nav ── */
      .demo-wrap .tab-nav { padding: 0.75rem 1.1rem; }
      .demo-wrap .tab-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
      .demo-wrap .tab {
        padding: 8px 16px; border-radius: 999px;
        border: 1.5px solid var(--ink-soft, #e3ddd0);
        background: var(--paper, #fff); color: var(--ink, #0f0f0f);
        font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
        cursor: pointer; white-space: nowrap;
        transition: background 120ms, border-color 120ms, box-shadow 120ms, transform 120ms;
      }
      .demo-wrap .tab:hover { border-color: var(--red); color: var(--red); background: rgba(255,40,0,0.04); }
      .demo-wrap .tab-active {
        background: linear-gradient(180deg, var(--red) 0%, var(--red-deep, #c21a00) 100%);
        color: #fff; border-color: var(--red-deep, #c21a00);
        box-shadow: 0 4px 14px rgba(255,40,0,0.32), inset 0 1px 0 rgba(255,255,255,0.18);
        transform: translateY(-1px);
      }
      .demo-wrap .tab-active:hover {
        color: #fff;
        background: linear-gradient(180deg, var(--red) 0%, var(--red-deep, #c21a00) 100%);
        border-color: var(--red-deep, #c21a00);
      }
      @media (max-width: 520px) {
        .demo-wrap .tab-row { display: grid; grid-template-columns: repeat(3, 1fr); }
        .demo-wrap .tab { font-size: 11px; padding: 7px 8px; text-align: center; white-space: normal; line-height: 1.2; }
      }

      /* ── Quick nav cards ── */
      .demo-wrap .nav-cards {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 0.5rem;
        margin: 0.8rem 1rem 0;
      }
      @media (max-width: 860px) { .demo-wrap .nav-cards { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 520px) { .demo-wrap .nav-cards { grid-template-columns: repeat(2, 1fr); margin: 0.6rem 0.5rem 0; } }
      .demo-wrap .nav-card {
        background: var(--paper, #fff);
        border: 1.5px solid var(--ink-soft, #e3ddd0);
        border-radius: 10px;
        padding: 0.75rem 0.9rem;
        text-align: left;
        cursor: pointer;
        transition: border-color 120ms, box-shadow 120ms, transform 120ms;
      }
      .demo-wrap .nav-card:hover {
        border-color: var(--red);
        box-shadow: 0 3px 12px rgba(255,40,0,0.14);
        transform: translateY(-1px);
      }
      .demo-wrap .nav-card-label { margin: 0; font-size: 13px; font-weight: 700; color: var(--ink); }
      .demo-wrap .nav-card-sub   { margin: 0.15rem 0 0; font-size: 11px; color: var(--muted); line-height: 1.3; }

      /* ── Grid layouts ── */
      .demo-wrap .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin: 0 1rem; }
      .demo-wrap .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; margin: 0 1rem; }
      @media (max-width: 960px) { .demo-wrap .grid-4 { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 680px) { .demo-wrap .grid-2 { grid-template-columns: 1fr; } }
      @media (max-width: 520px) {
        .demo-wrap .grid-4 { grid-template-columns: repeat(2, 1fr); margin: 0 0.5rem; }
        .demo-wrap .grid-2 { margin: 0 0.5rem; }
      }

      /* sections inside dash-frame that aren't grid */
      .demo-wrap .dash-frame > section.card,
      .demo-wrap .dash-frame > details.card { margin: 0.8rem 1rem 0; }
      .demo-wrap details.card > summary { list-style: none; cursor: pointer; }
      .demo-wrap details.card > summary::-webkit-details-marker { display: none; }
      .demo-wrap details.card > summary .chev { transition: transform 0.18s ease; display: inline-block; color: var(--muted); font-size: 12px; }
      .demo-wrap details.card[open] > summary .chev { transform: rotate(90deg); }
      .demo-wrap .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .demo-wrap .dash-frame > section.card:last-child { margin-bottom: 1rem; }
      @media (max-width: 520px) {
        .demo-wrap .dash-frame > section.card,
        .demo-wrap .dash-frame > details.card { margin: 0.6rem 0.5rem 0; }
        .demo-wrap .dash-frame > section.card:last-child { margin-bottom: 0.8rem; }
      }

      /* ── Stat cards ── */
      .demo-wrap .stat { padding: 1.1rem 1.2rem; }
      .demo-wrap .stat .label { margin: 0; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 700; line-height: 1.4; }
      .demo-wrap .stat .value { margin: 0.35rem 0 0; font-weight: 700; color: var(--ink); }
      .demo-wrap .stat .value.small { font-size: 18px; line-height: 1.25; }
      .demo-wrap .stat .hint { margin: 0.25rem 0 0; font-size: 11px; color: var(--muted); }
      .demo-wrap .tg-chip { display: inline-block; margin-top: 0.45rem; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--red); }
      .demo-wrap .label-sm { font-size: 12px; font-weight: 700; color: var(--red); }

      /* ── Progress bars ── */
      .demo-wrap .progress { height: 4px; border-radius: 2px; background: var(--ink-soft, #e3ddd0); margin: 0.45rem 0 0; overflow: hidden; }
      .demo-wrap .progress span { display: block; height: 100%; border-radius: 2px; background: var(--red); }

      /* ── Section heads ── */
      .demo-wrap .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.6rem; gap: 0.6rem; flex-wrap: wrap; }
      .demo-wrap .section-head h2 { margin: 0; font-size: 16px; font-weight: 700; color: var(--ink); }
      .demo-wrap .section-head p  { margin: 0; font-size: 12px; color: var(--muted); }
      @media (max-width: 520px) { .demo-wrap .section-head { flex-direction: column; align-items: flex-start; gap: 0.1rem; } }

      /* ── List rows ── */
      .demo-wrap .list { list-style: none; padding: 0; margin: 0; }
      .demo-wrap .row {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 0.8rem; padding: 0.65rem 1rem;
        border-bottom: 1px solid var(--ink-soft, #e3ddd0);
      }
      .demo-wrap .row:last-child { border-bottom: 0; padding-bottom: 0.65rem; }
      .demo-wrap .row > div:first-child { min-width: 0; flex: 1; }
      .demo-wrap .row .name { margin: 0; font-weight: 600; font-size: 14px; color: var(--ink); }
      .demo-wrap .row .meta { margin: 0.2rem 0 0; font-size: 12px; color: var(--muted); line-height: 1.45; }
      .demo-wrap .right { white-space: nowrap; flex-shrink: 0; text-align: right; }
      @media (max-width: 520px) { .demo-wrap .row { flex-wrap: wrap; gap: 0.35rem; } .demo-wrap .right { width: 100%; text-align: left; } }

      /* ── Status pills ── */
      .demo-wrap .status { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; padding: 3px 9px; border-radius: 999px; background: var(--paper-2); color: var(--ink); }
      .demo-wrap .status.hot     { background: var(--red);             color: #fff; }
      .demo-wrap .status.warm    { background: #ffb300;                color: #1a0e00; }
      .demo-wrap .status.cold    { background: #c9d3df;                color: #1a2a3a; }
      .demo-wrap .status.dormant { background: #6b6b6b;                color: #fff; }
      .demo-wrap .status.good    { background: #18a35a;                color: #fff; }
      .demo-wrap .status.risk    { background: var(--red-deep, #c21a00); color: #fff; }

      /* ── Source / example tags ── */
      .demo-wrap .src-tag {
        display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; padding: 2px 6px; border-radius: 4px;
        background: rgba(255,40,0,0.1); color: var(--red); margin-right: 6px; vertical-align: middle;
      }
      .demo-wrap .difficulty { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; }
      .demo-wrap .diff-easy     { background: #e7f6ed; color: #18a35a; }
      .demo-wrap .diff-standard { background: #eef2ff; color: #4257bf; }
      .demo-wrap .diff-hard     { background: #fff1d6; color: #b87100; }
      .demo-wrap .diff-brutal   { background: #ffe5e0; color: var(--red-deep, #c21a00); }

      /* ── Kanban ── */
      .demo-wrap .kanban { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }
      @media (max-width: 900px) { .demo-wrap .kanban { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 520px) { .demo-wrap .kanban { grid-template-columns: 1fr; } }
      .demo-wrap .kanban-col {
        background: var(--paper-2, #f7f4ef); border: 1px solid var(--ink-soft, #e3ddd0);
        border-radius: 10px; padding: 0.7rem; min-height: 120px;
      }
      .demo-wrap .kanban-head {
        margin: 0 0 0.6rem; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
        color: var(--muted); display: flex; justify-content: space-between; align-items: center;
      }
      .demo-wrap .kanban-count { background: var(--red); color: #fff; font-size: 10px; padding: 1px 7px; border-radius: 999px; font-weight: 700; }
      .demo-wrap .lead-card {
        background: var(--paper, #fff); border: 1px solid var(--ink-soft, #e3ddd0);
        border-radius: 8px; padding: 0.55rem 0.7rem; margin-bottom: 0.45rem;
        box-shadow: 0 1px 2px rgba(0,0,0,0.04);
      }
      .demo-wrap .lead-card:last-child { margin-bottom: 0; }
      .demo-wrap .lead-name { margin: 0; font-size: 13px; font-weight: 700; color: var(--ink); }
      .demo-wrap .lead-meta { margin: 0.15rem 0 0; font-size: 11px; color: var(--muted); }
      .demo-wrap .lead-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; margin-top: 0.5rem; }
      .demo-wrap .dial-btn {
        background: var(--red); color: #fff; border: none;
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        padding: 4px 9px; border-radius: 999px; cursor: not-allowed; opacity: 0.95;
      }

      /* ── Settings grid ── */
      .demo-wrap .settings-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
      @media (max-width: 720px) { .demo-wrap .settings-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 420px) { .demo-wrap .settings-grid { grid-template-columns: 1fr; } }
      .demo-wrap .setting-card { background: var(--paper, #fff); border: 1px solid var(--ink-soft, #e3ddd0); border-radius: 10px; padding: 0.75rem 0.9rem; }
      .demo-wrap .setting-label { margin: 0; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
      .demo-wrap .setting-value { margin: 0.3rem 0 0.15rem; font-size: 16px; font-weight: 700; color: var(--red); }
      .demo-wrap .setting-hint  { margin: 0; font-size: 11px; color: var(--muted); }

      /* ── Reschedule transcript ── */
      .demo-wrap .transcript {
        background: var(--paper, #fff); border: 1px solid var(--ink-soft, #e3ddd0);
        border-radius: 10px; padding: 0.85rem 1rem; font-size: 13.5px; line-height: 1.55;
      }
      .demo-wrap .t-line {
        display: flex; gap: 0.7rem; align-items: flex-start;
        padding: 0.35rem 0; border-bottom: 1px dashed rgba(0,0,0,0.07);
      }
      .demo-wrap .t-line:last-child { border-bottom: 0; }
      .demo-wrap .t-line p { margin: 0; flex: 1; color: var(--ink); }
      .demo-wrap .t-who {
        flex-shrink: 0; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
        padding: 2px 7px; border-radius: 4px; margin-top: 2px; min-width: 42px; text-align: center;
      }
      .demo-wrap .t-who.lead { background: var(--paper-2, #f7f4ef); color: var(--ink); }
      .demo-wrap .t-who.ai   { background: var(--red); color: #fff; }
      .demo-wrap .t-line.note { padding: 0.18rem 0 0.18rem 3.5rem; border-bottom: 0; }
      .demo-wrap .t-note {
        font-size: 11.5px; font-style: italic; color: var(--muted);
        background: rgba(0,0,0,0.03); border-radius: 4px; padding: 2px 8px;
      }

      /* ── Bar chart ── */
      .demo-wrap .bar-chart {
        display: flex; align-items: flex-end; gap: 8px; height: 100px; margin-top: 0.4rem;
        padding: 0 0 0.5rem; border-bottom: 1px solid var(--ink-soft, #e3ddd0);
      }
      .demo-wrap .bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
      .demo-wrap .bars { display: flex; gap: 3px; align-items: flex-end; height: 80px; flex: 1; }
      .demo-wrap .bar { width: 10px; border-radius: 3px 3px 0 0; min-height: 4px; }
      .demo-wrap .bar-calls { background: var(--red); }
      .demo-wrap .bar-tasks { background: var(--ink); opacity: 0.3; }
      .demo-wrap .bar-label { font-size: 10px; color: var(--muted); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
      .demo-wrap .chart-legend { display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 11px; color: var(--muted); font-weight: 600; }
      .demo-wrap .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }

      /* ── Score chips ── */
      .demo-wrap .score-100 { display: inline-flex; align-items: baseline; gap: 2px; padding: 4px 10px; border-radius: 8px; background: rgba(255,40,0,0.06); border: 1px solid rgba(255,40,0,0.18); }
      .demo-wrap .score-100 strong { font-size: 18px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
      .demo-wrap .score-100-denom { font-size: 11px; color: var(--muted); font-weight: 600; }

      /* ── Digest ── */
      .demo-wrap .digest {
        background: var(--ink, #0f0f0f); color: #d8d8d8; padding: 1rem 1.1rem;
        border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12.5px; line-height: 1.6; overflow-x: auto; white-space: pre; margin: 0;
      }
    `}</style>
  )
}
