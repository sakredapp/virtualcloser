'use client'

import Link from 'next/link'
import OfferTabs from '@/app/components/OfferTabs'

type TierKey = 'salesperson' | 'team_builder' | 'executive'

type TierLabel = 'Salesperson' | 'Team Builder' | 'Executive'

type Stat = {
  label: string
  value: string
  hint?: string
  progress?: number // 0-100
  tg?: boolean       // "via Telegram" badge
}

type ListRow = { title: string; meta?: string; sub?: string; tag?: string; tone?: 'hot' | 'warm' | 'cold' | 'dormant' | 'good' | 'watch' | 'risk' }

type Panel = {
  title: string
  rightMeta?: string
  source?: string  // integration badge e.g. "Zapier" or "API"
  rows: ListRow[]
}

type DemoData = {
  label: TierLabel
  tagline: string
  stats: Stat[]
  panels: Panel[]
  features: string[]
  extras?: string[]
}

// ── Shared base rows ─────────────────────────────────────────────────────────
const todaysPlanRows: ListRow[] = [
  { title: '9:30 — Discovery · Dana Ruiz', meta: 'Ruiz Consulting', sub: 'Zoom · prep: "pricing + quick win" from your voice note', tag: 'HOT', tone: 'hot' },
  { title: '11:00 — Follow-up call · Malcolm Ortiz', meta: 'North Trail Co.', sub: 'Opened last 2 emails, no reply', tag: 'WARM', tone: 'warm' },
  { title: '2:00 — Proposal walkthrough · Priya Shah', meta: 'Ledgerwise', sub: 'Rescheduled once — auto-confirm sent this morning', tag: 'WARM', tone: 'warm' },
  { title: '4:30 — Re-engage: Aisha Wu', meta: 'Cedar Labs', sub: '47 days quiet — script queued', tag: 'DORMANT', tone: 'dormant' },
]

const telegramInboxRows: ListRow[] = [
  { title: '"Create a task: call Ben on the 31st about pricing"', meta: 'from Telegram · 7:42am', sub: 'task created · added to calendar · linked to Ben Tracey' },
  { title: '"Dana marked no-show Tuesday, reschedule her for Thursday"', meta: 'from voice · 8:02am', sub: 'no-show logged · new slot sent · pipeline updated' },
  { title: '"Remind me — my Q2 target is 40 closed deals"', meta: 'from voice · 8:14am', sub: 'goal saved · progress 11/40 shown on dashboard' },
  { title: '"Send Aisha the re-engagement draft"', meta: 'from Telegram · 9:11am', sub: '→ draft ready for approval in your inbox' },
]

const pipelineSignalRows: ListRow[] = [
  { title: 'Jordan Blake · Blake Dental Group', meta: 'Proposal · $48K', sub: 'Advanced from "discovery" → "proposal" 2h ago', tag: 'HOT', tone: 'hot' },
  { title: 'Nina Park · Harbor & Main', meta: 'Negotiation · $62K', sub: 'Visited pricing page 3x today', tag: 'HOT', tone: 'hot' },
  { title: 'Luis Gómez · Meridian Home Svcs', meta: 'Follow-up · $22K', sub: 'Last touch 4 days ago — draft ready', tag: 'WARM', tone: 'warm' },
  { title: 'Derek Tan · TanPak Logistics', meta: 'Objection: timing', sub: 'Auto-revisit scheduled for Q3', tag: 'COLD', tone: 'cold' },
  { title: 'Rae Mitchell · Mitchell & Co', meta: 'Dormant 61 days', sub: 'Re-engagement tuned to their objection', tag: 'DORMANT', tone: 'dormant' },
]

const callIntelRows: ListRow[] = [
  { title: 'Call: Jordan Blake (34 min) — summary', meta: 'yesterday 3:12pm', sub: 'Objections: security review. Next step: revised proposal v2. Logged to HubSpot.' },
  { title: 'Draft: Jordan — Proposal v2 (your redlines applied)', meta: 'ready to send', sub: '"Revised per your call. Summary of what changed on p.2…"' },
  { title: 'Call: Nina Park (21 min) — summary', meta: 'this morning', sub: 'Champion confirmed. Blocker: procurement cycle. CFO intro requested.' },
  { title: 'Draft: Nina — Noticed you came back to pricing', meta: 'ready to send', sub: '"Happy to jump on 10 min and make your life easier…"' },
]

const teamMomentumRows: ListRow[] = [
  { title: 'East Team (Mgr: Rivera) · 9 reps', meta: '$612K · pace +14%', sub: 'Call quality 4.6/5 · follow-up discipline strong', tag: 'GOOD', tone: 'good' },
  { title: 'West Team (Mgr: Koh) · 7 reps', meta: '$481K · pace +2%', sub: 'Discovery depth dropping — coaching tasks auto-created', tag: 'WATCH', tone: 'watch' },
  { title: 'South Team (Mgr: Bennett) · 6 reps', meta: '$298K · pace -11%', sub: '3 reps below activity floor; 2 dormant deal-sets', tag: 'RISK', tone: 'risk' },
  { title: 'Enterprise Team (Mgr: Sosa) · 4 reps', meta: '$450K · pace +6%', sub: 'Everett Capital + Westbridge Health in final stage', tag: 'GOOD', tone: 'good' },
]

const execDealsRows: ListRow[] = [
  { title: 'Everett Capital (3 contacts)', meta: 'MSA in legal · $890K', sub: 'CFO + procurement + champion engaged — payback 9mo → 6mo', tag: 'HOT', tone: 'hot' },
  { title: 'Westbridge Health', meta: 'BAA attached · $540K', sub: 'Redlines addressed; awaiting counsel greenlight', tag: 'HOT', tone: 'hot' },
  { title: 'Fulfillment: Apex Health onboarding', meta: 'SLA breach · 4 days', sub: 'Handoff stalled between CSM and implementation partner', tag: 'RISK', tone: 'risk' },
  { title: 'Fulfillment: Orion Retail expansion', meta: 'SLA breach · 2 days', sub: 'Partner awaiting scoping doc — auto-ping sent to Mgr Koh', tag: 'WATCH', tone: 'watch' },
  { title: 'Sable & Finch — new champion detected', meta: 'LinkedIn signal', sub: 'Old pilot can be revived — outreach draft ready', tag: 'WARM', tone: 'warm' },
]

// AI Dialer status — shown when the AI Dialer add-on is on the build
const aiDialerRows: ListRow[] = [
  { title: 'Dana Ruiz · 9:30 AM today', meta: 'discovery · $48K · Ruiz Consulting', sub: 'Confirm call placed 8:45 AM — picked up, confirmed verbally', tag: 'CONFIRMED', tone: 'good' },
  { title: 'Priya Shah · 2:00 PM today', meta: 'proposal · $36K · Ledgerwise', sub: 'Confirm call → no answer · 2nd attempt queued 12:30 PM', tag: 'PENDING', tone: 'warm' },
  { title: 'Malcolm Ortiz · 10:00 AM tomorrow', meta: 'discovery · North Trail Co.', sub: 'Confirmation call queued — fires 9:00 AM tomorrow', tag: 'QUEUED', tone: 'cold' },
  { title: 'Nina Park · 4:00 PM today', meta: 'negotiation · $62K · Harbor & Main', sub: 'Reschedule requested → AI moved to Wed 11 AM, calendar patched', tag: 'RESCHED', tone: 'warm' },
  { title: 'Last 30 days · outcomes', meta: '47 confirmed · 9 reschedules · 6 no-answer · 2 cancelled', sub: '$23.40 spent · 124 min used / 300 min cap', tag: '78% PICKUP', tone: 'good' },
]

// AI Roleplay sessions — shown when the Roleplay add-on is on the build
const aiRoleplayRows: ListRow[] = [
  { title: 'Trial-user about to churn', meta: 'assigned by manager · 1 / 2 done', sub: 'Best score 76 / 100 · debrief: clipped the close at 0:48 — work the silence', tag: '76 / 100', tone: 'warm' },
  { title: 'Price objection · enterprise', meta: 'assigned by manager · 0 / 2 done', sub: '"Skeptical CFO at 200-person firm" · 12 objections · 3 training docs', tag: 'START', tone: 'hot' },
  { title: 'Discovery: cold-warm', meta: 'self-assigned · 1 / 1 done', sub: 'Score 84 / 100 · "Ready" — practiced again 2 days ago, +6 vs first try', tag: '84 / 100', tone: 'good' },
  { title: 'Renewal · price hike', meta: 'self-assigned · last attempt 2 days ago', sub: 'Score 88 / 100 · "Ready" — manager left voice note: nail this opener', tag: '88 / 100', tone: 'good' },
  { title: 'This month · usage', meta: '12 sessions · 142 min / 300 min cap', sub: 'Avg score 82 · trending +8 pts vs last month', tag: 'ON PACE', tone: 'good' },
]

// Wavv (BYO predictive dialer KPI ingest) — shown when Wavv add-on is on
const wavvRows: ListRow[] = [
  { title: 'Today so far', meta: '184 dials · 47 connects · 9 conversations', sub: '5.0% conversation rate · 25.5% pickup · pace +12% vs yesterday', tag: 'LIVE', tone: 'good' },
  { title: 'Top dispositions today', meta: '47 voicemail · 18 not interested · 9 callback set', sub: '3 booked appointments — auto-pulled into your calendar', tag: '3 BOOKED', tone: 'hot' },
  { title: 'Yesterday', meta: '512 dials · 137 connects · 24 conversations', sub: '4.7% conversation rate · all dispositions logged to your CRM', tag: 'WAVV API', tone: 'good' },
  { title: 'This week trend', meta: 'Mon 412 · Tue 488 · Wed 512 · Thu 184 (so far)', sub: 'Best window 10–11 AM · 9.1% conversation rate', tag: 'TREND', tone: 'warm' },
]

const DEMOS: Record<TierKey, DemoData> = {
  // ── Salesperson ─────────────────────────────────────────────────────────────
  salesperson: {
    label: 'Salesperson',
    tagline: 'Your personal sales assistant on Telegram. Tell it your goals, your clients, your to-dos — it builds the pipeline, the calendar, and the follow-up around you.',
    stats: [
      { label: 'Weekly close goal', value: '$4.2K / $8K', hint: 'pace · 3 days left', progress: 52, tg: true },
      { label: 'Calls booked this week', value: '9 / 15', hint: 'target you set Monday', progress: 60, tg: true },
      { label: 'Follow-ups queued', value: '11', hint: 'ready to approve' },
      { label: 'Priority today', value: 'Close Dana', hint: 'from your 7:42am voice note', tg: true },
    ],
    panels: [
      {
        title: 'Today\'s plan',
        rightMeta: 'synced to calendar',
        rows: todaysPlanRows,
      },
      {
        title: 'Voice + Telegram inbox',
        rightMeta: 'last 24h',
        rows: telegramInboxRows,
      },
    ],
    features: [
      'Voice-powered assistant you talk to like Jarvis',
      'Telegram bot: text or voice-note on the go → updates your CRM',
      'Calendar + meetings + no-show tracking in one tap',
      'Daily AI scan → prioritized follow-ups ready to approve',
      'Brain-dump → tasks, goals, notes, priorities',
      'Your brand, your sub-domain',
    ],
  },

  // ── Team Builder: everything above + pipeline + call intel ──────────────────
  team_builder: {
    label: 'Team Builder',
    tagline: 'Everything in Salesperson — plus live pipeline signals, call summaries, and one-click drafts. Your whole deal flow in one place.',
    stats: [
      // Salesperson stats carried forward
      { label: 'Weekly close goal', value: '$4.2K / $8K', hint: 'pace · 3 days left', progress: 52, tg: true },
      { label: 'Calls booked this week', value: '9 / 15', hint: 'target you set Monday', progress: 60, tg: true },
      { label: 'Follow-ups queued', value: '11', hint: 'ready to approve' },
      { label: 'Priority today', value: 'Close Dana', hint: 'from your 7:42am voice note', tg: true },
      // Team Builder additions
      { label: 'Proposals to ship', value: '4 / 7', hint: 'your Monday priority', progress: 57, tg: true },
      { label: 'Dormant to wake up', value: '3 / 5', hint: 'from your voice note', progress: 60, tg: true },
    ],
    panels: [
      // Salesperson panels carried forward
      {
        title: 'Today\'s plan',
        rightMeta: 'synced to calendar',
        rows: todaysPlanRows,
      },
      {
        title: 'Voice + Telegram inbox',
        rightMeta: 'last 24h',
        rows: telegramInboxRows,
      },
      // Team Builder additions
      {
        title: 'Pipeline signals',
        rightMeta: 'HubSpot · live',
        source: 'Zapier',
        rows: pipelineSignalRows,
      },
      {
        title: 'Call intel + drafts',
        rightMeta: 'Fathom · Gmail',
        source: 'Zapier',
        rows: callIntelRows,
      },
    ],
    features: [
      'Everything in Salesperson',
      'HubSpot / Pipedrive sync — CRM stays source of truth',
      'Gmail / Outlook one-click approve + send',
      'Call transcripts (Fathom / Fireflies) attached to every deal',
      'Custom objection + playbook tuning to your voice',
      'Weekly pipeline review in plain English',
    ],
  },

  // ── Executive: everything above + team rollups + exec deals ────────────────
  executive: {
    label: 'Executive',
    tagline: 'Everything in Team Builder — plus team momentum rollups, fulfillment oversight, and deal escalations across every manager and rep.',
    stats: [
      // Salesperson stats carried forward
      { label: 'Weekly close goal', value: '$4.2K / $8K', hint: 'pace · 3 days left', progress: 52, tg: true },
      { label: 'Calls booked this week', value: '9 / 15', hint: 'target you set Monday', progress: 60, tg: true },
      { label: 'Follow-ups queued', value: '11', hint: 'ready to approve' },
      { label: 'Priority today', value: 'Close Dana', hint: 'from your 7:42am voice note', tg: true },
      // Team Builder stats carried forward
      { label: 'Proposals to ship', value: '4 / 7', hint: 'your Monday priority', progress: 57, tg: true },
      { label: 'Dormant to wake up', value: '3 / 5', hint: 'from your voice note', progress: 60, tg: true },
      // Executive additions
      { label: 'Quarterly revenue goal', value: '$1.84M / $2.2M', hint: 'pace +8% · set with leadership', progress: 84, tg: true },
      { label: 'At-risk deals', value: '11', hint: 'momentum slipping — action needed' },
    ],
    panels: [
      // Salesperson panels carried forward
      {
        title: 'Today\'s plan',
        rightMeta: 'synced to calendar',
        rows: todaysPlanRows,
      },
      {
        title: 'Voice + Telegram inbox',
        rightMeta: 'last 24h',
        rows: telegramInboxRows,
      },
      // Team Builder panels carried forward
      {
        title: 'Pipeline signals',
        rightMeta: 'HubSpot · live',
        source: 'Zapier',
        rows: pipelineSignalRows,
      },
      {
        title: 'Call intel + drafts',
        rightMeta: 'Fathom · Gmail',
        source: 'Zapier',
        rows: callIntelRows,
      },
      // Executive additions
      {
        title: 'AI Dialer · appointment confirmations',
        rightMeta: 'add-on · per-minute',
        source: 'API',
        rows: aiDialerRows,
      },
      {
        title: 'AI Roleplay · your queue',
        rightMeta: 'add-on · per-minute',
        source: 'API',
        rows: aiRoleplayRows,
      },
      {
        title: 'Wavv predictive dialer · KPI live feed',
        rightMeta: 'add-on · BYO Wavv account',
        source: 'API',
        rows: wavvRows,
      },
      {
        title: 'Team momentum',
        rightMeta: 'CRM + Fathom rollup',
        source: 'API',
        rows: teamMomentumRows,
      },
      {
        title: 'Deals + partners needing you',
        rightMeta: 'escalations',
        source: 'API',
        rows: execDealsRows,
      },
    ],
    features: [
      'Everything in Team Builder',
      'Team / manager / rep / fulfillment-partner hierarchy',
      'Revenue + momentum rollups across every team, live',
      'Per-team health scoring from CRM + call intelligence (Fathom / Gong)',
      'Deal velocity + call quality tied together',
      'Fulfillment-partner oversight (discussions, SLAs, handoffs)',
      'Dedicated infra + isolated data + BYOK AI keys',
      'AI Dialer auto-confirms every booked appointment 30–60 min before start',
      'AI Roleplay scenarios pinned to your real product + objection bank',
      'Wavv (or Vapi) outbound dialer KPIs land on your dashboard live',
    ],
    extras: [
      'Executive rollup to your Telegram every Friday',
      'Per-rep coaching tasks auto-generated from call transcripts',
      'Custom n8n workflows + quarterly strategy reviews',
    ],
  },
}

export default function DemoPage() {
  // The /demo page now shows a single, fully-loaded view of an Executive
  // tenant — every surface visible — with each section badged so the visitor
  // can see what's in the $99 base vs. what's an à-la-carte add-on. The
  // 3-tier pitch lives only in the catalog now.
  const tier: TierKey = 'executive'
  const d = DEMOS[tier]

  return (
    <main className="wrap demo-wrap">
      <header className="hero">
        <h1 style={{ margin: '0 0 0.4rem' }}>See what your dashboard will actually look like.</h1>
        <p className="sub">
          One operator, fully loaded. Every surface a Virtual Closer rep sees on day one —
          pipeline, voice + Telegram inbox, drafts, call intel — all from your phone.
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

      <section className="grid-4">
        {d.stats.map((s) => (
          <article key={s.label} className="card stat">
            <p className="label">{s.label}</p>
            <p className="value small">{s.value}</p>
            {typeof s.progress === 'number' && (
              <div className="progress" aria-label={`${s.progress}% of goal`}>
                <span style={{ width: `${Math.max(0, Math.min(100, s.progress))}%` }} />
              </div>
            )}
            {s.hint && <p className="hint">{s.hint}</p>}
            {s.tg && <span className="tg-chip">● via Telegram</span>}
          </article>
        ))}
      </section>

      <section className="grid-2">
        {d.panels.map((panel) => (
          <article key={panel.title} className="card">
            <div className="section-head">
              <h2>{panel.title}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {panel.source && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: panel.source === 'API' ? 'var(--red)' : 'var(--blue, #2563eb)',
                    color: '#fff',
                    opacity: 0.9,
                  }}>
                    {panel.source === 'API' ? 'via API' : 'via Zapier'}
                  </span>
                )}
                {panel.rightMeta && <p>{panel.rightMeta}</p>}
              </div>
            </div>
            <ul className="list">
              {panel.rows.map((r, i) => (
                <li key={i} className="row">
                  <div>
                    <p className="name">{r.title}</p>
                    {r.meta && <p className="meta">{r.meta}</p>}
                    {r.sub && <p className="meta">{r.sub}</p>}
                  </div>
                  {r.tag && (
                    <div className="right">
                      <span className={`status ${r.tone ?? ''}`}>{r.tag}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {/* ── New feature showcase: AI Dialer control center ────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>AI Dialer · control center</h2>
          <p><span className="src-tag">/dashboard/dialer</span> per-tenant timing · owner-editable</p>
        </div>
        <p className="meta" style={{ margin: '0 0 0.7rem', fontSize: '0.85rem' }}>
          Owners and admins control exactly when the dialer fires for their account — no engineering tickets, no waiting on us. Every confirmation call follows your rules.
        </p>
        <div className="settings-grid">
          <div className="setting-card">
            <p className="setting-label">Auto-confirm appointments</p>
            <p className="setting-value">On</p>
            <p className="setting-hint">Disable globally with one toggle</p>
          </div>
          <div className="setting-card">
            <p className="setting-label">Lead time window</p>
            <p className="setting-value">25 – 45 min</p>
            <p className="setting-hint">Before scheduled start</p>
          </div>
          <div className="setting-card">
            <p className="setting-label">Max attempts</p>
            <p className="setting-value">2</p>
            <p className="setting-hint">Per meeting</p>
          </div>
          <div className="setting-card">
            <p className="setting-label">Retry on voicemail</p>
            <p className="setting-value">On · 30 min</p>
            <p className="setting-hint">Wait between attempts</p>
          </div>
          <div className="setting-card">
            <p className="setting-label">Post-call AI summary</p>
            <p className="setting-value">On</p>
            <p className="setting-hint">Claude reads transcript</p>
          </div>
          <div className="setting-card">
            <p className="setting-label">Auto follow-up tasks</p>
            <p className="setting-value">On</p>
            <p className="setting-hint">Negative outcomes only</p>
          </div>
        </div>
      </section>

      {/* ── Post-call AI summary ──────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Post-call intelligence</h2>
          <p>Claude reads every transcript · 2-3 sentence summary + next action</p>
        </div>
        <ul className="list">
          <li className="row">
            <div>
              <p className="name">Dana Ruiz · 14 min · Ruiz Consulting</p>
              <p className="meta"><strong>Summary:</strong> Confirmed Thursday 2pm. Dana asked to bring her CFO. Mentioned current vendor contract ends June 1 — wants a price comparison sheet.</p>
              <p className="meta"><strong>Next:</strong> Send 1-page pricing comparison before Thursday and add CFO to calendar invite.</p>
            </div>
            <div className="right"><span className="status good">CONFIRMED</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Priya Shah · 47 sec · Ledgerwise</p>
              <p className="meta"><strong>Summary:</strong> Voicemail. No response after second prompt. Standard greeting — not personal.</p>
              <p className="meta"><strong>Next:</strong> Auto-task created for tomorrow 9am: text Priya with Calendly link before next dialer attempt.</p>
            </div>
            <div className="right"><span className="status warm">VOICEMAIL</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Nina Park · 6 min · Harbor &amp; Main</p>
              <p className="meta"><strong>Summary:</strong> Asked to reschedule from 4pm Thursday to Wednesday. Tied to a board meeting conflict that just popped up. Otherwise still committed.</p>
              <p className="meta"><strong>Next:</strong> Wed 11am locked in via Cal.com · calendar updated · meeting notes preserved.</p>
            </div>
            <div className="right"><span className="status good">RESCHEDULED</span></div>
          </li>
        </ul>
      </section>

      {/* ── Reschedule no-soft-close protocol ─────────────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Reschedule call · no-soft-close protocol</h2>
          <p>excerpt from a real Vapi reschedule call · hard-coded into every assistant prompt</p>
        </div>
        <div className="transcript">
          <div className="line"><span className="who lead">Lead</span><p>Yeah I can&rsquo;t do Thursday. Can we move it?</p></div>
          <div className="line"><span className="who ai">AI</span><p>No problem. Same time on Tuesday — 2pm — work for you?</p></div>
          <div className="line note"><span className="tooltip">tool · check_slot(day_iso=Tue, reuse original time)</span></div>
          <div className="line"><span className="who lead">Lead</span><p>Hmm Tuesday&rsquo;s tight. What about later in the week?</p></div>
          <div className="line"><span className="who ai">AI</span><p>I have Wednesday 11am, Thursday 3pm, or Friday 10am open. Which one?</p></div>
          <div className="line note"><span className="tooltip">tool · find_slots() · 3 explicit options, no &ldquo;sometime next week&rdquo;</span></div>
          <div className="line"><span className="who lead">Lead</span><p>Wednesday 11.</p></div>
          <div className="line"><span className="who ai">AI</span><p>Wednesday 11am locked in. You&rsquo;ll get a calendar invite in two minutes. Talk then.</p></div>
          <div className="line note"><span className="tooltip">tool · book_slot(start_iso) · hangup</span></div>
        </div>
        <p className="meta" style={{ marginTop: '0.7rem', fontSize: '0.82rem' }}>
          The AI never says &ldquo;sometime next week&rdquo; or &ldquo;I&rsquo;ll have someone follow up.&rdquo; If two attempts fail, it ends the call with a clean handoff: <em>&ldquo;Your rep will reach out personally.&rdquo;</em>
        </p>
      </section>

      {/* ── Manual dial from pipeline ─────────────────────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>One-click dial from your pipeline</h2>
          <p><span className="src-tag">/dashboard/pipeline</span> kanban + manual call buttons</p>
        </div>
        <div className="kanban">
          <div className="kanban-col">
            <p className="kanban-head">Discovery <span className="kanban-count">3</span></p>
            <div className="lead-card">
              <p className="lead-name">Dana Ruiz</p>
              <p className="lead-meta">Ruiz Consulting · $48K</p>
              <div className="lead-actions">
                <button className="dial-btn" disabled>Call now</button>
                <span className="status hot">HOT</span>
              </div>
            </div>
            <div className="lead-card">
              <p className="lead-name">Malcolm Ortiz</p>
              <p className="lead-meta">North Trail · $22K</p>
              <div className="lead-actions">
                <button className="dial-btn" disabled>Call now</button>
                <span className="status warm">WARM</span>
              </div>
            </div>
          </div>
          <div className="kanban-col">
            <p className="kanban-head">Proposal <span className="kanban-count">2</span></p>
            <div className="lead-card">
              <p className="lead-name">Priya Shah</p>
              <p className="lead-meta">Ledgerwise · $36K</p>
              <div className="lead-actions">
                <button className="dial-btn" disabled>Call now</button>
                <span className="status warm">WARM</span>
              </div>
            </div>
          </div>
          <div className="kanban-col">
            <p className="kanban-head">Negotiation <span className="kanban-count">1</span></p>
            <div className="lead-card">
              <p className="lead-name">Nina Park</p>
              <p className="lead-meta">Harbor &amp; Main · $62K</p>
              <div className="lead-actions">
                <button className="dial-btn" disabled>Call now</button>
                <span className="status hot">HOT</span>
              </div>
            </div>
          </div>
        </div>
        <p className="meta" style={{ marginTop: '0.7rem', fontSize: '0.82rem' }}>
          Drag cards across stages. Tap any lead to open the full detail view, see every call summary, every email, every Telegram note. Tap <em>Call now</em> to fire the AI dialer immediately.
        </p>
      </section>

      {/* ── SMS workflows ─────────────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Stage-triggered SMS workflows</h2>
          <p>GHL stage update · Twilio · per-tenant templates</p>
        </div>
        <ul className="list">
          <li className="row">
            <div>
              <p className="name">Stage: Discovery booked → SMS</p>
              <p className="meta"><strong>Template:</strong> &ldquo;Hi {'{first_name}'}, looking forward to our chat. Quick prep question: what&rsquo;s the #1 outcome you&rsquo;d need to see for this to be a win?&rdquo;</p>
              <p className="meta">Fired 14 times in the last 7 days · 9 replies</p>
            </div>
            <div className="right"><span className="status good">ON</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Stage: Proposal sent → SMS</p>
              <p className="meta"><strong>Template:</strong> &ldquo;{'{first_name}'} — proposal in your inbox. Anything jump out as a blocker?&rdquo;</p>
              <p className="meta">Fired 8 times · 5 replies · 2 closed-won</p>
            </div>
            <div className="right"><span className="status good">ON</span></div>
          </li>
          <li className="row">
            <div>
              <p className="name">Stage: No-show → SMS</p>
              <p className="meta"><strong>Template:</strong> &ldquo;Hey {'{first_name}'}, missed you on the call — want me to send a couple new times?&rdquo;</p>
              <p className="meta">Fired 3 times · 3 reschedules booked</p>
            </div>
            <div className="right"><span className="status good">ON</span></div>
          </li>
        </ul>
      </section>

      {/* ── Onboarding checklist (admin perspective) ──────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Admin onboarding checklist</h2>
          <p><span className="src-tag">/admin/clients/[id]</span> what we see when we set you up</p>
        </div>
        <p className="meta" style={{ margin: '0 0 0.7rem', fontSize: '0.85rem' }}>
          Every integration has a green/yellow/red status badge so we know exactly what&rsquo;s left to flip on. No silent gaps, no &ldquo;why isn&rsquo;t the dialer working?&rdquo; tickets.
        </p>
        <div className="checklist-grid">
          <div className="check-item ok"><span className="check-name">Vapi voice</span><span className="check-state">Provisioned</span></div>
          <div className="check-item ok"><span className="check-name">Twilio SMS</span><span className="check-state">Connected</span></div>
          <div className="check-item ok"><span className="check-name">GHL CRM</span><span className="check-state">Webhook live</span></div>
          <div className="check-item warn"><span className="check-name">HubSpot</span><span className="check-state">Token expiring</span></div>
          <div className="check-item ok"><span className="check-name">Training docs</span><span className="check-state">14 active</span></div>
          <div className="check-item ok"><span className="check-name">Roleplay scenarios</span><span className="check-state">6 published</span></div>
          <div className="check-item ok"><span className="check-name">Telegram members</span><span className="check-state">7 linked</span></div>
          <div className="check-item warn"><span className="check-name">Cal.com booking URL</span><span className="check-state">Not set</span></div>
        </div>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Like what you see?</h2>
          <p>this is the individual build · build your quote on the pricing tab</p>
        </div>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href="/offer" className="btn approve" style={{ textDecoration: 'none' }}>
            Build your quote
          </Link>
          <Link
            href="mailto:hello@virtualcloser.com?subject=Kickoff%20call"
            className="btn dismiss"
            style={{ textDecoration: 'none' }}
          >
            Book a call
          </Link>
        </div>
      </section>
      </div>{/* /dash-frame */}

      <style jsx global>{`
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
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          background: linear-gradient(180deg, #ebe5d6 0%, #ddd5c2 100%);
          border-bottom: 1px solid var(--ink, #0f0f0f);
        }
        .demo-wrap .dash-frame-dot {
          width: 11px; height: 11px; border-radius: 50%;
          display: inline-block;
          box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12);
        }
        .demo-wrap .dash-frame-url {
          margin-left: 12px; flex: 1; text-align: center;
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--muted, #5a5a5a);
          letter-spacing: 0.04em;
          background: var(--paper, #fff);
          padding: 3px 10px;
          border-radius: 999px;
          max-width: 360px;
          margin-right: auto;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .demo-wrap .dash-frame > section { margin-left: 1rem; margin-right: 1rem; }
        .demo-wrap .dash-frame > section:first-of-type { margin-top: 1rem; }
        .demo-wrap .dash-frame > section:last-child { margin-bottom: 1rem; }
        @media (max-width: 520px) {
          .demo-wrap .dash-frame > section { margin-left: 0.5rem; margin-right: 0.5rem; }
          .demo-wrap .dash-frame-url { display: none; }
        }

        /* Source/example tags reused from enterprise demo */
        .demo-wrap .src-tag {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255,40,0,0.1);
          color: var(--red);
          margin-right: 6px;
          vertical-align: middle;
        }

        /* Settings grid (dialer control center) */
        .demo-wrap .settings-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.6rem;
        }
        @media (max-width: 720px) { .demo-wrap .settings-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 420px) { .demo-wrap .settings-grid { grid-template-columns: 1fr; } }
        .demo-wrap .setting-card {
          background: var(--paper, #fff);
          border: 1px solid var(--ink-soft, #e3ddd0);
          border-radius: 10px;
          padding: 0.75rem 0.9rem;
        }
        .demo-wrap .setting-label { margin: 0; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
        .demo-wrap .setting-value { margin: 0.3rem 0 0.15rem; font-size: 16px; font-weight: 700; color: var(--red); }
        .demo-wrap .setting-hint { margin: 0; font-size: 11px; color: var(--muted); }

        /* Transcript block */
        .demo-wrap .transcript {
          background: var(--paper, #fff);
          border: 1px solid var(--ink-soft, #e3ddd0);
          border-radius: 10px;
          padding: 0.85rem 1rem;
          font-size: 13.5px;
          line-height: 1.55;
        }
        .demo-wrap .transcript .line {
          display: flex;
          gap: 0.7rem;
          align-items: flex-start;
          padding: 0.35rem 0;
          border-bottom: 1px dashed rgba(0,0,0,0.06);
        }
        .demo-wrap .transcript .line:last-child { border-bottom: 0; }
        .demo-wrap .transcript .line p { margin: 0; flex: 1; color: var(--ink); }
        .demo-wrap .transcript .who {
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
        .demo-wrap .transcript .who.lead { background: var(--paper-2, #f7f4ef); color: var(--ink); }
        .demo-wrap .transcript .who.ai { background: var(--red); color: #fff; }
        .demo-wrap .transcript .line.note { padding: 0.15rem 0 0.15rem 3.5rem; border-bottom: 0; }
        .demo-wrap .transcript .tooltip {
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--muted);
          background: rgba(255,40,0,0.06);
          border: 1px dashed rgba(255,40,0,0.25);
          padding: 2px 8px;
          border-radius: 4px;
        }

        /* Kanban */
        .demo-wrap .kanban {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.6rem;
        }
        @media (max-width: 720px) { .demo-wrap .kanban { grid-template-columns: 1fr; } }
        .demo-wrap .kanban-col {
          background: var(--paper-2, #f7f4ef);
          border: 1px solid var(--ink-soft, #e3ddd0);
          border-radius: 10px;
          padding: 0.7rem;
          min-height: 140px;
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
        .demo-wrap .lead-name { margin: 0; font-size: 13px; font-weight: 700; color: var(--ink); }
        .demo-wrap .lead-meta { margin: 0.15rem 0 0.4rem; font-size: 11px; color: var(--muted); }
        .demo-wrap .lead-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
        .demo-wrap .dial-btn {
          background: var(--red);
          color: #fff;
          border: none;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 4px 9px;
          border-radius: 999px;
          cursor: not-allowed;
          opacity: 0.95;
        }

        /* Onboarding checklist */
        .demo-wrap .checklist-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.45rem;
        }
        @media (max-width: 520px) { .demo-wrap .checklist-grid { grid-template-columns: 1fr; } }
        .demo-wrap .check-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.6rem;
          padding: 0.55rem 0.8rem;
          border-radius: 8px;
          background: var(--paper, #fff);
          border: 1px solid var(--ink-soft, #e3ddd0);
          border-left-width: 4px;
        }
        .demo-wrap .check-item.ok   { border-left-color: #18a35a; }
        .demo-wrap .check-item.warn { border-left-color: #ffb300; }
        .demo-wrap .check-item.bad  { border-left-color: var(--red); }
        .demo-wrap .check-name { font-size: 13px; font-weight: 600; color: var(--ink); }
        .demo-wrap .check-state {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .demo-wrap .check-item.ok .check-state   { color: #18a35a; }
        .demo-wrap .check-item.warn .check-state { color: #b87100; }
        .demo-wrap .check-item.bad .check-state  { color: var(--red); }
      `}</style>
    </main>
  )
}
