'use client'

import { useEffect, useState } from 'react'

/*
  CXO Suite — public demo dashboard.

  A faithful, fully-faked clone of the CXO executive dashboard a real seat
  (e.g. Spencer's) sees after signing in. No auth, no network, no persistence —
  every number, prospect, email and event below is invented. It reuses the
  real dashboard CSS vocabulary (.dash-shell / .dash-sidebar / .wrap / .card /
  .kpi-* / .grid-*) and the CXO palette tokens so it matches the live product
  pixel-for-pixel, then swaps Pinnacle for a generic "Revenue" page per the
  demo brief.

  Brand: we force data-brand='cxo' on <html> on mount so the espresso/vanilla
  tokens apply on any host (the canonical entry is suitecxo.com/demo, already
  CXO-branded, but this keeps preview/localhost faithful too).
*/

const CXO_LOGO =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png'

type View = 'command' | 'pipeline' | 'revenue' | 'inbox' | 'calendar'

const NAV: { key: View; label: string; sub: string }[] = [
  { key: 'command',  label: 'Command Center', sub: 'Today, drafts, agenda' },
  { key: 'pipeline', label: 'Pipeline',       sub: 'Prospects + deals' },
  { key: 'revenue',  label: 'Revenue',        sub: 'Closed, pace, sources' },
  { key: 'inbox',    label: 'Inbox',          sub: 'Email triage + drafts' },
  { key: 'calendar', label: 'Calendar',       sub: 'Week at a glance' },
]

// ── Tone → color helpers (resolve against CXO tokens) ───────────────────────
function toneColor(tone: string): string {
  switch (tone) {
    case 'hot': return '#B4452B'      // warm clay (signal)
    case 'warm': return '#9A7B3F'     // amber
    case 'good': return '#3F7A52'     // sage green
    case 'cold': return 'var(--muted)'
    case 'dormant': return '#7A7A7A'
    default: return 'var(--muted)'
  }
}

export default function CxoDemo() {
  const [view, setView] = useState<View>('command')
  const [mobileOpen, setMobileOpen] = useState(false)

  // Force CXO theming regardless of host, restore on unmount.
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-brand')
    el.setAttribute('data-brand', 'cxo')
    return () => {
      if (prev) el.setAttribute('data-brand', prev)
      else el.removeAttribute('data-brand')
    }
  }, [])

  useEffect(() => { setMobileOpen(false) }, [view])

  return (
    // data-app-shell triggers the dashboard framing CSS (paper canvas, hidden
    // marketing chrome, bordered .wrap) exactly like the real /dashboard tree.
    <div
      data-app-shell
      className={['dash-shell', mobileOpen ? 'is-mobile-open' : ''].filter(Boolean).join(' ')}
    >
      {/* Mobile top bar */}
      <div className="dash-mobilebar">
        <button
          type="button"
          className="dash-mobilebar-btn"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <span aria-hidden className="dash-burger"><span /><span /><span /></span>
        </button>
        <span className="dash-mobilebar-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CXO_LOGO} alt="CXO Suite" />
        </span>
      </div>
      <div className="dash-scrim" onClick={() => setMobileOpen(false)} aria-hidden />

      {/* Sidebar */}
      <aside className="dash-sidebar" aria-label="Dashboard navigation">
        <div className="dash-sidebar-head">
          <span className="dash-sidebar-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CXO_LOGO} alt="CXO Suite" />
          </span>
          <span
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--accent-bright, #C9C2B0)',
              border: '1px solid var(--border-soft)', borderRadius: 999,
              padding: '3px 8px',
            }}
          >
            Demo
          </span>
        </div>

        <nav className="dash-sidebar-nav" aria-label="Sections">
          {NAV.map((t) => (
            <div key={t.key} className="dash-side-group">
              <button
                type="button"
                onClick={() => setView(t.key)}
                className={['dash-side-link', view === t.key ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
                aria-current={view === t.key ? 'page' : undefined}
              >
                <span className="dash-side-label">{t.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot">
          <a href="/cxo" className="dash-side-link dash-side-muted">
            <span className="dash-side-label">← Back to site</span>
          </a>
          <a href="/cxo#contact" className="dash-side-link dash-side-upgrade">
            <span className="dash-side-label">Get your seat →</span>
          </a>
        </div>
      </aside>

      {/* Main */}
      <main className="dash-main">
        <div className="wrap">
          {view === 'command' && <CommandCenter />}
          {view === 'pipeline' && <Pipeline />}
          {view === 'revenue' && <Revenue />}
          {view === 'inbox' && <Inbox />}
          {view === 'calendar' && <Calendar />}
        </div>
      </main>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  COMMAND CENTER
// ════════════════════════════════════════════════════════════════════════

const DIGEST = [
  { label: 'Drafts to approve', value: 4 },
  { label: 'Emails to answer', value: 7 },
  { label: 'Deals gone quiet', value: 3 },
  { label: 'Meetings today', value: 5 },
]

const GOALS = [
  { label: 'This week',    value: '$182K / $250K', pct: 73, cta: 'Pace · 2 days left' },
  { label: 'This month',   value: '$640K / $900K', pct: 71, cta: 'On track' },
  { label: 'This quarter', value: '$1.9M / $2.6M', pct: 73, cta: 'Ahead of plan' },
  { label: 'This year',    value: '$6.4M / $9.5M', pct: 67, cta: 'Stretch goal set in Jan' },
]

const AGENDA = [
  { time: '9:00 AM',  title: 'Weekly leadership sync', who: 'Internal · 6 attendees', tone: 'good' },
  { time: '10:30 AM', title: 'Northwind Group — renewal review', who: 'Dana Whitfield, CFO', tone: 'hot' },
  { time: '12:30 PM', title: 'Lunch hold — Atlas Partners intro', who: 'Marcus Lee', tone: 'warm' },
  { time: '2:00 PM',  title: 'Ledgerwise — proposal walkthrough', who: 'Priya Shah, VP Ops', tone: 'warm' },
  { time: '4:30 PM',  title: 'Board prep — Q3 forecast', who: 'Internal', tone: 'good' },
]

const TASKS = [
  { title: 'Approve the Northwind renewal draft', due: 'Today · 10am', source: 'Inbox', priority: 'high' },
  { title: 'Send Ledgerwise the updated pricing sheet', due: 'Today · 1pm', source: 'Pipeline', priority: 'high' },
  { title: 'Re-engage Cedar Labs (47 days quiet)', due: 'Tomorrow', source: 'Pipeline', priority: 'med' },
  { title: 'Review Q3 forecast deck before board prep', due: 'Today · 4pm', source: 'Calendar', priority: 'med' },
  { title: 'Reply to Atlas Partners intro thread', due: 'Tomorrow · 9am', source: 'Inbox', priority: 'low' },
]

const LEAD_QUEUE = [
  { name: 'Dana Whitfield', co: 'Northwind Group', value: '$240K', status: 'HOT',  tone: 'hot',  note: 'Renewal review at 10:30 — wants multi-year terms' },
  { name: 'Priya Shah',     co: 'Ledgerwise',      value: '$96K',  status: 'WARM', tone: 'warm', note: 'Proposal walkthrough today, opened deck 3x' },
  { name: 'Marcus Lee',     co: 'Atlas Partners',  value: '$155K', status: 'WARM', tone: 'warm', note: 'Warm intro from board member, first call pending' },
  { name: 'Elena Park',     co: 'Harbor & Main',   value: '$310K', status: 'HOT',  tone: 'hot',  note: 'Visited pricing page 4x this week' },
]

function CommandCenter() {
  return (
    <>
      <Hero
        eyebrow="CXO Suite · Command Center"
        title="Good morning, Jordan"
        sub="Here's what needs you today — drafts to approve, deals slipping, and your next five meetings, pulled together automatically."
      />

      {/* Exec digest */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.6rem',
        }}
      >
        {DIGEST.map((c) => (
          <div
            key={c.label}
            style={{
              background: 'var(--paper)', border: '1px solid var(--border-soft)',
              borderRadius: 12, padding: '0.9rem 1rem', boxShadow: 'var(--shadow-card)',
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800, color: c.value > 0 ? 'var(--accent)' : 'var(--muted)', lineHeight: 1 }}>
              {c.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontWeight: 600 }}>
              {c.label}
            </div>
          </div>
        ))}
      </section>

      {/* Today: revenue snapshot + agenda */}
      <section className="grid-2">
        <div className="card">
          <div className="section-head"><h2>This month</h2></div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div className="kpi-value">$640K</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: toneColor('good') }}>▲ 18% vs last month</div>
          </div>
          <div className="kpi-label">Revenue closed · 14 deals won</div>
          <MiniBars data={[38, 52, 41, 64, 58, 72, 69, 84]} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            Pacing to <strong style={{ color: 'var(--ink)' }}>$905K</strong> — just past the $900K goal.
          </div>
        </div>

        <div className="card">
          <div className="section-head"><h2>Today's agenda</h2></div>
          <ul className="list-clean">
            {AGENDA.map((e) => (
              <li key={e.time} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 74, flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{e.time}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{e.who}</div>
                </div>
                <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: 999, background: toneColor(e.tone), flex: '0 0 auto', marginTop: 5 }} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Goals */}
      <section className="summary grid-4">
        {GOALS.map((g) => (
          <div key={g.label} className="card stat">
            <p className="label">{g.label}</p>
            <p className="value" style={{ fontSize: '1.35rem' }}>{g.value}</p>
            <div className="progress"><span style={{ width: `${g.pct}%`, background: 'var(--accent)' }} /></div>
            <p className="hint">{g.cta}</p>
          </div>
        ))}
      </section>

      {/* Tasks + lead queue */}
      <section className="grid-2">
        <div className="card">
          <div className="section-head"><h2>Your tasks</h2></div>
          <ul className="list-clean">
            {TASKS.map((t) => (
              <li key={t.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ marginTop: 5, width: 8, height: 8, borderRadius: 999, flex: '0 0 auto', background: t.priority === 'high' ? toneColor('hot') : t.priority === 'med' ? toneColor('warm') : 'var(--muted)' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{t.due} · from {t.source}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="section-head"><h2>Lead priority queue</h2></div>
          <ul className="list-clean">
            {LEAD_QUEUE.map((l) => (
              <li key={l.name}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.co}</div>
                  <div style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 14 }}>{l.value}</div>
                  <StatusChip label={l.status} tone={l.tone} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{l.note}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  PIPELINE
// ════════════════════════════════════════════════════════════════════════

type Prospect = { name: string; co: string; value: string; status: string; tone: string; note: string }

const STAGES: { name: string; cards: Prospect[] }[] = [
  {
    name: 'Discovery',
    cards: [
      { name: 'Marcus Lee', co: 'Atlas Partners', value: '$155K', status: 'WARM', tone: 'warm', note: 'Warm intro from board — discovery booked Thu' },
      { name: 'Tomas Reyes', co: 'Brightline Mfg', value: '$72K', status: 'COLD', tone: 'cold', note: 'Replied to outbound, scoping fit' },
      { name: 'Sandra Cole', co: 'Kestrel Logistics', value: '$48K', status: 'COLD', tone: 'cold', note: 'Inbound demo request from website' },
    ],
  },
  {
    name: 'Qualified',
    cards: [
      { name: 'Priya Shah', co: 'Ledgerwise', value: '$96K', status: 'WARM', tone: 'warm', note: 'Budget confirmed, VP Ops championing' },
      { name: 'Devon Mills', co: 'Pinewood Health', value: '$128K', status: 'WARM', tone: 'warm', note: 'Two stakeholders engaged, security review next' },
    ],
  },
  {
    name: 'Proposal',
    cards: [
      { name: 'Elena Park', co: 'Harbor & Main', value: '$310K', status: 'HOT', tone: 'hot', note: 'Proposal sent, pricing page visited 4x' },
      { name: 'Grace Lin', co: 'Vantage Realty', value: '$84K', status: 'WARM', tone: 'warm', note: 'Walkthrough done, awaiting legal' },
    ],
  },
  {
    name: 'Negotiation',
    cards: [
      { name: 'Dana Whitfield', co: 'Northwind Group', value: '$240K', status: 'HOT', tone: 'hot', note: 'Renewal + expansion, multi-year terms on table' },
      { name: 'Owen Hart', co: 'Sterling & Co', value: '$190K', status: 'HOT', tone: 'hot', note: 'Redlines back from their counsel' },
    ],
  },
  {
    name: 'Closed Won',
    cards: [
      { name: 'Aisha Wu', co: 'Cedar Labs', value: '$132K', status: 'WON', tone: 'good', note: 'Signed Tuesday — kickoff scheduled' },
      { name: 'Ben Foster', co: 'Foster & Sons', value: '$58K', status: 'WON', tone: 'good', note: 'Closed, onboarding in flight' },
    ],
  },
]

function Pipeline() {
  const total = STAGES.flatMap((s) => s.cards).length
  return (
    <>
      <Hero
        eyebrow="CXO Suite · Pipeline"
        title="Pipeline"
        sub={`${total} active prospects across five stages · $1.86M weighted. Drag-and-drop in the live product — this is a snapshot.`}
      />
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
        {STAGES.map((s) => {
          const sum = s.cards.reduce((a, c) => a + Number(c.value.replace(/[^0-9.]/g, '')), 0)
          return (
            <div key={s.name} style={{ flex: '0 0 264px', width: 264 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', marginBottom: 8,
                  background: 'var(--paper-2)', border: '1px solid var(--border-soft)', borderRadius: 10,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                  {s.cards.length} · ${sum}K
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {s.cards.map((c) => (
                  <div
                    key={c.name}
                    style={{
                      background: 'var(--paper)', border: '1px solid var(--border-soft)',
                      borderRadius: 11, padding: '11px 12px', boxShadow: 'var(--shadow-card)',
                      borderLeft: `3px solid ${toneColor(c.tone)}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                      <StatusChip label={c.status} tone={c.tone} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.co}</div>
                    <div style={{ fontWeight: 800, fontSize: 15, margin: '6px 0 4px' }}>{c.value}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4 }}>{c.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  REVENUE  (replaces Pinnacle)
// ════════════════════════════════════════════════════════════════════════

const REV_KPIS = [
  { label: 'Revenue closed (MTD)', value: '$640K', hint: '▲ 18% vs last month', good: true },
  { label: 'Deals won', value: '14', hint: '6 new · 8 expansion' },
  { label: 'Avg deal size', value: '$45.7K', hint: 'up from $38.2K' },
  { label: 'Win rate', value: '31%', hint: '+4 pts vs Q1', good: true },
]

const REV_MONTHS = [
  { m: 'Jul', v: 410 }, { m: 'Aug', v: 455 }, { m: 'Sep', v: 392 }, { m: 'Oct', v: 488 },
  { m: 'Nov', v: 521 }, { m: 'Dec', v: 604 }, { m: 'Jan', v: 472 }, { m: 'Feb', v: 538 },
  { m: 'Mar', v: 590 }, { m: 'Apr', v: 547 }, { m: 'May', v: 612 }, { m: 'Jun', v: 640 },
]

const REV_SOURCES = [
  { label: 'Renewals & expansion', amount: 318, deals: 8, pct: 50 },
  { label: 'New business', amount: 196, deals: 4, pct: 31 },
  { label: 'Partner / referral', amount: 84, deals: 1, pct: 13 },
  { label: 'Inbound', amount: 42, deals: 1, pct: 6 },
]

function Revenue() {
  const max = Math.max(...REV_MONTHS.map((d) => d.v))
  return (
    <>
      <Hero
        eyebrow="CXO Suite · Revenue"
        title="Revenue"
        sub="Closed revenue, monthly pace, and where it's coming from — rolled up across every seat and pipeline."
      />

      <section className="summary grid-4">
        {REV_KPIS.map((k) => (
          <div key={k.label} className="card stat">
            <p className="label">{k.label}</p>
            <p className="value" style={{ fontSize: '1.8rem' }}>{k.value}</p>
            <p className="hint" style={{ color: k.good ? toneColor('good') : 'var(--muted)', fontWeight: k.good ? 700 : 500 }}>{k.hint}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="section-head"><h2>Revenue by month</h2></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 200, padding: '8px 0' }}>
          {REV_MONTHS.map((d, i) => {
            const h = Math.round((d.v / max) * 170)
            const last = i === REV_MONTHS.length - 1
            return (
              <div key={d.m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>${d.v}K</span>
                <div
                  title={`${d.m}: $${d.v}K`}
                  style={{
                    width: '100%', maxWidth: 34, height: h, borderRadius: '6px 6px 0 0',
                    background: last ? 'var(--accent)' : 'var(--accent-bright, #C9C2B0)',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: last ? 700 : 500 }}>{d.m}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="section-head"><h2>Revenue by source · this month</h2></div>
          <ul className="list-clean">
            {REV_SOURCES.map((s) => (
              <li key={s.label}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.deals} deal{s.deals > 1 ? 's' : ''}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 14 }}>${s.amount}K</span>
                </div>
                <div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${s.pct}%`, background: 'var(--accent)' }} /></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="section-head"><h2>Forecast</h2></div>
          <ul className="list-clean">
            <li style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)', fontSize: 14 }}>Committed this quarter</span><strong>$1.9M</strong></li>
            <li style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)', fontSize: 14 }}>Best case</span><strong>$2.4M</strong></li>
            <li style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)', fontSize: 14 }}>Quarter goal</span><strong>$2.6M</strong></li>
            <li style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)', fontSize: 14 }}>Run-rate (annualized)</span><strong>$7.7M</strong></li>
          </ul>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            At current pace you close the quarter <strong style={{ color: toneColor('good') }}>2 weeks early</strong> and land within 5% of the stretch goal.
          </div>
        </div>
      </section>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  INBOX (email triage)
// ════════════════════════════════════════════════════════════════════════

type Email = {
  from: string; addr: string; subject: string; snippet: string
  time: string; priority: 'urgent' | 'high' | 'normal' | 'low'
  body: string; draft?: string
}

const DRAFTS: Email[] = [
  {
    from: 'Dana Whitfield', addr: 'dana@northwindgroup.com',
    subject: 'Re: Renewal terms — multi-year',
    snippet: 'Thanks for sending the comparison. Before we lock the 3-year, can you confirm…',
    time: '8:42 AM', priority: 'urgent',
    body: 'Thanks for sending the comparison. Before we lock the 3-year, can you confirm the price protection clause applies to the expansion seats too? If so we\'re ready to move this week.',
    draft: 'Hi Dana — yes, the price protection in section 4 covers every seat added during the term, including the expansion block we discussed. I\'ll have the updated paper to you by noon so you can route it for signature this week. Looking forward to our 10:30.',
  },
  {
    from: 'Priya Shah', addr: 'priya@ledgerwise.io',
    subject: 'Re: Proposal walkthrough',
    snippet: 'The deck looks great. One question on the onboarding timeline before our 2pm…',
    time: '9:15 AM', priority: 'high',
    body: 'The deck looks great. One question on the onboarding timeline before our 2pm — can your team have us live before the end of the quarter?',
    draft: 'Hi Priya — absolutely. Standard onboarding runs 3 weeks, so signing by next Friday puts you live with two weeks to spare before quarter-end. I\'ll walk through the exact milestones at 2pm.',
  },
]

const NEEDS_REPLY: Email[] = [
  { from: 'Marcus Lee', addr: 'marcus@atlaspartners.com', subject: 'Intro from the board', snippet: 'Robert suggested I reach out — would love 20 minutes to see how CXO Suite…', time: 'Yesterday', priority: 'high', body: 'Robert suggested I reach out — would love 20 minutes to see how CXO Suite could fit our portfolio companies. Are you free later this week?' },
  { from: 'Grace Lin', addr: 'grace@vantagerealty.com', subject: 'Legal review status', snippet: 'Our counsel had two small redlines on the MSA — nothing major…', time: 'Yesterday', priority: 'normal', body: 'Our counsel had two small redlines on the MSA — nothing major, mostly notice periods. Can your team take a look this week?' },
  { from: 'Owen Hart', addr: 'owen@sterlingco.com', subject: 'Redlines attached', snippet: 'Counsel sent these back. Most are accepted; flagged two for discussion…', time: '2 days ago', priority: 'high', body: 'Counsel sent these back. Most are accepted; flagged two for discussion on liability caps. Call tomorrow?' },
]

const FYI: Email[] = [
  { from: 'Stripe', addr: 'receipts@stripe.com', subject: 'Payout of $128,400 completed', snippet: 'Your payout has been sent to your bank account ending 4421…', time: '7:02 AM', priority: 'low', body: 'Your payout of $128,400.00 has been sent to your bank account ending 4421 and should arrive within 1–2 business days.' },
  { from: 'Aisha Wu', addr: 'aisha@cedarlabs.com', subject: 'Signed! Excited to start', snippet: 'Countersigned and uploaded. The whole team is thrilled — when can we…', time: 'Yesterday', priority: 'normal', body: 'Countersigned and uploaded. The whole team is thrilled — when can we get the kickoff on the calendar?' },
]

function priorityChip(p: Email['priority']) {
  const map: Record<Email['priority'], { c: string; label: string }> = {
    urgent: { c: toneColor('hot'), label: 'Urgent' },
    high:   { c: toneColor('warm'), label: 'High' },
    normal: { c: 'var(--muted)', label: 'Normal' },
    low:    { c: '#9AA0A6', label: 'FYI' },
  }
  const { c, label } = map[p]
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '1px 7px' }}>
      {label}
    </span>
  )
}

function EmailRow({ e, showDraft }: { e: Email; showDraft?: boolean }) {
  return (
    <details style={{ borderBottom: '1px solid var(--border-soft)' }}>
      <summary
        style={{
          listStyle: 'none', cursor: 'pointer', display: 'flex', gap: 12,
          alignItems: 'center', padding: '11px 2px',
        }}
      >
        <div style={{ width: 130, flex: '0 0 auto', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.from}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.addr}</div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.snippet}</div>
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {priorityChip(e.priority)}
          <span style={{ fontSize: 11, color: 'var(--muted)', width: 64, textAlign: 'right' }}>{e.time}</span>
        </div>
      </summary>

      <div style={{ padding: '4px 2px 16px' }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)', background: 'var(--paper-2)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '12px 14px' }}>
          {e.body}
        </div>
        {showDraft && e.draft && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>
              ✦ AI-drafted reply
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, border: '1px solid var(--accent)', borderRadius: 10, padding: '12px 14px', background: 'var(--paper)' }}>
              {e.draft}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <DemoBtn primary>Approve &amp; send</DemoBtn>
              <DemoBtn>Edit</DemoBtn>
              <DemoBtn>Regenerate</DemoBtn>
              <DemoBtn>Snooze 1d</DemoBtn>
            </div>
          </div>
        )}
        {!showDraft && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <DemoBtn primary>Draft reply with AI</DemoBtn>
            <DemoBtn>Snooze</DemoBtn>
            <DemoBtn>Mark done</DemoBtn>
          </div>
        )}
      </div>
    </details>
  )
}

function Inbox() {
  return (
    <>
      <Hero
        eyebrow="CXO Suite · Inbox"
        title="Inbox"
        sub="Every email triaged by priority, with replies already drafted in your voice. Approve, tweak, or snooze — the assistant handles the rest."
      />

      <section className="card">
        <div className="section-head"><h2>Drafts ready to approve <span style={{ color: 'var(--accent)' }}>· {DRAFTS.length}</span></h2></div>
        <div>{DRAFTS.map((e) => <EmailRow key={e.addr} e={e} showDraft />)}</div>
      </section>

      <section className="card">
        <div className="section-head"><h2>Needs your reply <span style={{ color: 'var(--muted)' }}>· {NEEDS_REPLY.length}</span></h2></div>
        <div>{NEEDS_REPLY.map((e) => <EmailRow key={e.addr} e={e} />)}</div>
      </section>

      <section className="card">
        <div className="section-head"><h2>FYI <span style={{ color: 'var(--muted)' }}>· {FYI.length}</span></h2></div>
        <div>{FYI.map((e) => <EmailRow key={e.addr} e={e} />)}</div>
      </section>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  CALENDAR (week view)
// ════════════════════════════════════════════════════════════════════════

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const DATES = ['9', '10', '11', '12', '13']
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] // 8am–5pm

type CalEvent = { day: number; start: number; end: number; title: string; tone: string }
const EVENTS: CalEvent[] = [
  { day: 0, start: 9,    end: 10,   title: 'Leadership sync', tone: 'good' },
  { day: 0, start: 14,   end: 15,   title: 'Ledgerwise proposal', tone: 'warm' },
  { day: 1, start: 10.5, end: 11.5, title: 'Northwind renewal', tone: 'hot' },
  { day: 1, start: 13,   end: 14,   title: 'Atlas Partners intro', tone: 'warm' },
  { day: 2, start: 9,    end: 9.5,  title: 'Pipeline review', tone: 'good' },
  { day: 2, start: 11,   end: 12,   title: 'Harbor & Main', tone: 'hot' },
  { day: 2, start: 15,   end: 16,   title: 'Sterling redlines', tone: 'hot' },
  { day: 3, start: 9,    end: 10,   title: 'Cedar Labs kickoff', tone: 'good' },
  { day: 3, start: 16.5, end: 17,   title: 'Board prep', tone: 'good' },
  { day: 4, start: 10,   end: 11,   title: 'Pinewood security review', tone: 'warm' },
  { day: 4, start: 13,   end: 13.5, title: 'Vantage legal call', tone: 'warm' },
]

function Calendar() {
  const rowH = 48
  const startHour = HOURS[0]
  return (
    <>
      <Hero
        eyebrow="CXO Suite · Calendar"
        title="This week"
        sub="June 9–13 · synced from Google. Confirmations, reschedules and prep tasks are handled automatically before each meeting."
      />

      <section className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 720 }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(5, 1fr)', borderBottom: '1.5px solid var(--border-soft)' }}>
            <div />
            {DAYS.map((d, i) => (
              <div key={d} style={{ textAlign: 'center', padding: '6px 0 10px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{d}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: i === 2 ? 'var(--accent)' : 'var(--ink)' }}>{DATES[i]}</div>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(5, 1fr)' }}>
            {/* Hour labels */}
            <div>
              {HOURS.map((h) => (
                <div key={h} style={{ height: rowH, fontSize: 10, color: 'var(--muted)', textAlign: 'right', paddingRight: 8, transform: 'translateY(-6px)' }}>
                  {h <= 12 ? `${h} AM` : `${h - 12} PM`}
                </div>
              ))}
            </div>
            {/* Day columns */}
            {DAYS.map((_, dayIdx) => (
              <div key={dayIdx} style={{ position: 'relative', borderLeft: '1px solid var(--border-soft)' }}>
                {HOURS.map((h) => (
                  <div key={h} style={{ height: rowH, borderBottom: '1px solid var(--border-soft)' }} />
                ))}
                {EVENTS.filter((e) => e.day === dayIdx).map((e, i) => {
                  const top = (e.start - startHour) * rowH
                  const height = Math.max((e.end - e.start) * rowH - 4, 20)
                  const c = toneColor(e.tone)
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'absolute', top, left: 4, right: 4, height,
                        background: 'var(--paper)', borderLeft: `3px solid ${c}`,
                        border: '1px solid var(--border-soft)', borderLeftWidth: 3, borderLeftColor: c,
                        borderRadius: 7, padding: '3px 6px', overflow: 'hidden',
                        boxShadow: 'var(--shadow-card)',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.15, overflow: 'hidden' }}>{e.title}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {fmtHour(e.start)}–{fmtHour(e.end)}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

function fmtHour(h: number): string {
  const hr = Math.floor(h)
  const min = h % 1 === 0.5 ? ':30' : ''
  const ap = hr < 12 ? 'a' : 'p'
  const disp = hr <= 12 ? hr : hr - 12
  return `${disp}${min}${ap}`
}

// ════════════════════════════════════════════════════════════════════════
//  Shared bits
// ════════════════════════════════════════════════════════════════════════

function Hero({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <section className="hero">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="sub">{sub}</p>
    </section>
  )
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  const c = toneColor(tone)
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '1px 7px' }}>
      {label}
    </span>
  )
}

function MiniBars({ data }: { data: number[] }) {
  const max = Math.max(...data)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 44, marginTop: 12 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, height: `${(v / max) * 100}%`, background: i === data.length - 1 ? 'var(--accent)' : 'var(--accent-bright, #C9C2B0)', borderRadius: '3px 3px 0 0' }} />
      ))}
    </div>
  )
}

function DemoBtn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => e.preventDefault()}
      title="Demo only"
      style={{
        cursor: 'default', fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 9,
        border: `1px solid ${primary ? 'var(--accent)' : 'var(--border-soft)'}`,
        background: primary ? 'var(--accent)' : 'transparent',
        color: primary ? 'var(--paper)' : 'var(--ink)',
      }}
    >
      {children}
    </button>
  )
}
