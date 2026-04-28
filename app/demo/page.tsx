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
    </main>
  )
}
