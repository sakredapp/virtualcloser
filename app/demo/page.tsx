'use client'

import Link from 'next/link'
import { useState } from 'react'

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
  rows: ListRow[]
}

type DemoData = {
  label: TierLabel
  tagline: string
  stats: Stat[]
  panels: [Panel, Panel]
  features: string[]
  extras?: string[]
}

const DEMOS: Record<TierKey, DemoData> = {
  // ── Salesperson: voice-first personal CRM for one closer ────────────────
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
        rows: [
          { title: '9:30 — Discovery · Dana Ruiz', meta: 'Ruiz Consulting', sub: 'Zoom · prep: "pricing + quick win" from your voice note', tag: 'HOT', tone: 'hot' },
          { title: '11:00 — Follow-up call · Malcolm Ortiz', meta: 'North Trail Co.', sub: 'Opened last 2 emails, no reply', tag: 'WARM', tone: 'warm' },
          { title: '2:00 — Proposal walkthrough · Priya Shah', meta: 'Ledgerwise', sub: 'Rescheduled once — auto-confirm sent this morning', tag: 'WARM', tone: 'warm' },
          { title: '4:30 — Re-engage: Aisha Wu', meta: 'Cedar Labs', sub: '47 days quiet — script queued', tag: 'DORMANT', tone: 'dormant' },
        ],
      },
      {
        title: 'Voice + Telegram inbox',
        rightMeta: 'last 24h',
        rows: [
          { title: '"Create a task: call Ben on the 31st about pricing"', meta: 'from Telegram · 7:42am', sub: '✓ task created · added to calendar · linked to Ben Tracey' },
          { title: '"Dana marked no-show Tuesday, reschedule her for Thursday"', meta: 'from voice · 8:02am', sub: '✓ no-show logged · new slot sent · pipeline updated' },
          { title: '"Remind me — my Q2 target is 40 closed deals"', meta: 'from voice · 8:14am', sub: '✓ goal saved · progress 11/40 shown on dashboard' },
          { title: '"Send Aisha the re-engagement draft"', meta: 'from Telegram · 9:11am', sub: '→ draft ready for approval in your inbox' },
        ],
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

  // ── Team Builder: real pipeline + CRM + calls ───────────────────────────
  team_builder: {
    label: 'Team Builder',
    tagline: 'Tell Telegram your weekly number, your priorities, and your deals — it runs the pipeline, the drafts, and the follow-up so you just close.',
    stats: [
      { label: 'Weekly revenue goal', value: '$18.4K / $25K', hint: 'on pace · Fri deadline', progress: 74, tg: true },
      { label: 'Proposals to ship', value: '4 / 7', hint: 'your Monday priority', progress: 57, tg: true },
      { label: 'Dormant to wake up', value: '3 / 5', hint: 'from your voice note', progress: 60, tg: true },
      { label: 'Drafts awaiting you', value: '8', hint: 'ready to approve' },
    ],
    panels: [
      {
        title: 'Pipeline signals',
        rightMeta: 'HubSpot · live',
        rows: [
          { title: 'Jordan Blake · Blake Dental Group', meta: 'Proposal · $48K', sub: 'Advanced from "discovery" → "proposal" 2h ago', tag: 'HOT', tone: 'hot' },
          { title: 'Nina Park · Harbor & Main', meta: 'Negotiation · $62K', sub: 'Visited pricing page 3x today', tag: 'HOT', tone: 'hot' },
          { title: 'Luis Gómez · Meridian Home Svcs', meta: 'Follow-up · $22K', sub: 'Last touch 4 days ago — draft ready', tag: 'WARM', tone: 'warm' },
          { title: 'Derek Tan · TanPak Logistics', meta: 'Objection: timing', sub: 'Auto-revisit scheduled for Q3', tag: 'COLD', tone: 'cold' },
          { title: 'Rae Mitchell · Mitchell & Co', meta: 'Dormant 61 days', sub: 'Re-engagement tuned to their objection', tag: 'DORMANT', tone: 'dormant' },
        ],
      },
      {
        title: 'Call intel + drafts',
        rightMeta: 'Fathom · Gmail',
        rows: [
          { title: 'Call: Jordan Blake (34 min) — summary', meta: 'yesterday 3:12pm', sub: 'Objections: security review. Next step: revised proposal v2. Logged to HubSpot.' },
          { title: 'Draft: Jordan — Proposal v2 (your redlines applied)', meta: 'ready to send', sub: '"Revised per your call. Summary of what changed on p.2…"' },
          { title: 'Call: Nina Park (21 min) — summary', meta: 'this morning', sub: 'Champion confirmed. Blocker: procurement cycle. CFO intro requested.' },
          { title: 'Draft: Nina — Noticed you came back to pricing', meta: 'ready to send', sub: '"Happy to jump on 10 min and make your life easier…"' },
        ],
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

  // ── Executive: revenue + momentum command center ────────────────────────
  executive: {
    label: 'Executive',
    tagline: 'Talk to Telegram like your COO. Set the quarterly number, the team focus, the red flags — get momentum, health, and fulfillment answers back.',
    stats: [
      { label: 'Quarterly revenue goal', value: '$1.84M / $2.2M', hint: 'pace +8% · set with leadership', progress: 84, tg: true },
      { label: 'Team close rate target', value: '28% / 32%', hint: 'your board commitment', progress: 88, tg: true },
      { label: 'At-risk deals', value: '11', hint: 'momentum slipping — action needed' },
      { label: 'Focus this week', value: 'Unblock South', hint: 'from your Sunday voice note', tg: true },
    ],
    panels: [
      {
        title: 'Team momentum',
        rightMeta: 'CRM + Fathom rollup',
        rows: [
          { title: 'East Team (Mgr: Rivera) · 9 reps', meta: '$612K · pace +14%', sub: 'Call quality 4.6/5 · follow-up discipline strong', tag: 'GOOD', tone: 'good' },
          { title: 'West Team (Mgr: Koh) · 7 reps', meta: '$481K · pace +2%', sub: 'Discovery depth dropping — coaching tasks auto-created', tag: 'WATCH', tone: 'watch' },
          { title: 'South Team (Mgr: Bennett) · 6 reps', meta: '$298K · pace -11%', sub: '3 reps below activity floor; 2 dormant deal-sets', tag: 'RISK', tone: 'risk' },
          { title: 'Enterprise Team (Mgr: Sosa) · 4 reps', meta: '$450K · pace +6%', sub: 'Everett Capital + Westbridge Health in final stage', tag: 'GOOD', tone: 'good' },
        ],
      },
      {
        title: 'Deals + partners needing you',
        rightMeta: 'escalations',
        rows: [
          { title: 'Everett Capital (3 contacts)', meta: 'MSA in legal · $890K', sub: 'CFO + procurement + champion engaged — payback 9mo → 6mo', tag: 'HOT', tone: 'hot' },
          { title: 'Westbridge Health', meta: 'BAA attached · $540K', sub: 'Redlines addressed; awaiting counsel greenlight', tag: 'HOT', tone: 'hot' },
          { title: 'Fulfillment: Apex Health onboarding', meta: 'SLA breach · 4 days', sub: 'Handoff stalled between CSM and implementation partner', tag: 'RISK', tone: 'risk' },
          { title: 'Fulfillment: Orion Retail expansion', meta: 'SLA breach · 2 days', sub: 'Partner awaiting scoping doc — auto-ping sent to Mgr Koh', tag: 'WATCH', tone: 'watch' },
          { title: 'Sable & Finch — new champion detected', meta: 'LinkedIn signal', sub: 'Old pilot can be revived — outreach draft ready', tag: 'WARM', tone: 'warm' },
        ],
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

const TIERS: TierKey[] = ['salesperson', 'team_builder', 'executive']

function DemoStyles() {
  // Global theme already handles colors; nothing to override for the demo page.
  return null
}

export default function DemoPage() {
  const [tier, setTier] = useState<TierKey>('salesperson')
  const d = DEMOS[tier]

  return (
    <main className="wrap demo-wrap">
      <DemoStyles />
      <header className="hero">
        <h1 style={{ margin: '0 0 0.4rem' }}>See what your dashboard will actually look like.</h1>
        <p className="sub">{d.tagline}</p>
        <p className="nav">
          <Link href="/offer">← Back to the offer</Link>
          <span>·</span>
          <Link href="/login">Client sign in</Link>
          <span>·</span>
          <Link href="mailto:hello@virtualcloser.com?subject=Kickoff%20call">Book a call</Link>
        </p>
      </header>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Choose a level to preview</h2>
          <p>demo data · nothing persists</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {TIERS.map((t) => {
            const info = DEMOS[t]
            const active = t === tier
            return (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={`btn ${active ? 'approve' : 'dismiss'}`}
                style={{ cursor: 'pointer' }}
              >
                {info.label}
              </button>
            )
          })}
        </div>
      </section>

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
              {panel.rightMeta && <p>{panel.rightMeta}</p>}
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
          <h2>What&apos;s in the {d.label} build</h2>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {d.features.map((f) => (
            <li key={f} className="row">
              <div>
                <p className="name" style={{ fontWeight: 500 }}>{f}</p>
              </div>
            </li>
          ))}
          {d.extras && d.extras.length > 0 && (
            <>
              <li className="row" style={{ background: 'transparent', border: 'none' }}>
                <div>
                  <p className="meta" style={{ color: 'var(--gold)' }}>Exclusive to {d.label}:</p>
                </div>
              </li>
              {d.extras.map((x) => (
                <li key={x} className="row">
                  <div>
                    <p className="name" style={{ fontWeight: 500 }}>{x}</p>
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link
            href={`mailto:hello@virtualcloser.com?subject=${encodeURIComponent(`${d.label} kickoff`)}`}
            className="btn approve"
            style={{ textDecoration: 'none' }}
          >
            Start on {d.label}
          </Link>
          <Link href="/offer" className="btn dismiss" style={{ textDecoration: 'none' }}>
            Compare all levels
          </Link>
        </div>
      </section>
    </main>
  )
}
