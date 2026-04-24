'use client'

import Link from 'next/link'
import { useState } from 'react'

type TierKey = 'starter' | 'pro' | 'space_station'

type DemoData = {
  label: string
  monthly: number
  buildRange: [number, number]
  tagline: string
  summary: { runsToday: number; leadsProcessed: number; actionsCreated: number; latestRun: string }
  leads: Array<{ name: string; company: string; status: 'hot' | 'warm' | 'cold' | 'dormant'; note: string }>
  drafts: Array<{ to: string; subject: string; body: string }>
  features: string[]
  extras?: string[]
}

const DEMOS: Record<TierKey, DemoData> = {
  starter: {
    label: 'Starter',
    monthly: 50,
    buildRange: [1500, 2500],
    tagline: 'Solo closer. Follow-up on autopilot. Your own branded sub-domain.',
    summary: { runsToday: 3, leadsProcessed: 42, actionsCreated: 7, latestRun: 'Morning scan · 9:02 AM' },
    leads: [
      { name: 'Dana Ruiz', company: 'Ruiz Consulting', status: 'hot', note: 'Replied "send pricing" 2h ago' },
      { name: 'Malcolm Ortiz', company: 'North Trail Co.', status: 'warm', note: 'Opened last 2 emails, no reply' },
      { name: 'Priya Shah', company: 'Ledgerwise', status: 'warm', note: 'Booked and rescheduled once' },
      { name: 'Ben Tracey', company: 'Tracey & Sons', status: 'cold', note: 'No activity in 18 days' },
      { name: 'Aisha Wu', company: 'Cedar Labs', status: 'dormant', note: '47 days quiet — re-engagement queued' },
    ],
    drafts: [
      {
        to: 'Dana Ruiz',
        subject: 'Pricing + a quick win I noticed',
        body: 'Dana — here\'s the pricing sheet. I also spotted one thing on your intake flow we could fix this week that pays for month one. Worth a 15-min call Thursday?',
      },
      {
        to: 'Aisha Wu',
        subject: 'Still on your radar?',
        body: 'Aisha — it\'s been a while. No pressure at all; just wanted to see if Cedar\'s priorities shifted. If now\'s not the time, tell me when is and I\'ll stop bugging you in the meantime.',
      },
    ],
    features: [
      'Daily morning scan + prioritized hot list',
      'Approve-or-tweak drafted follow-ups',
      'Dormant lead re-engagement',
      'Voice brain-dump → tasks + notes',
      'Slack / email hot-lead alerts',
    ],
  },
  pro: {
    label: 'Pro',
    monthly: 150,
    buildRange: [3500, 5000],
    tagline: 'Real pipeline. Real CRM sync. Your playbook, tuned to your voice.',
    summary: { runsToday: 6, leadsProcessed: 138, actionsCreated: 19, latestRun: 'Hot pulse · 2:01 PM' },
    leads: [
      { name: 'Jordan Blake', company: 'Blake Dental Group', status: 'hot', note: 'CRM: advanced to "proposal" stage' },
      { name: 'Nina Park', company: 'Harbor & Main', status: 'hot', note: 'Visited pricing page 3x today' },
      { name: 'Luis Gómez', company: 'Meridian Home Svcs', status: 'warm', note: 'HubSpot: last touch 4 days ago' },
      { name: 'Sarah Knoll', company: 'Knoll Advisory', status: 'warm', note: 'Opened proposal, no reply' },
      { name: 'Derek Tan', company: 'TanPak Logistics', status: 'cold', note: 'Objection: timing' },
      { name: 'Rae Mitchell', company: 'Mitchell & Co', status: 'dormant', note: '61 days — re-engagement tuned to their objection' },
    ],
    drafts: [
      {
        to: 'Jordan Blake',
        subject: 'Proposal v2 (your redlines applied)',
        body: 'Jordan — revised per your call. Summary of what changed on p.2. If v2 works, DocuSign goes out same day. If it doesn\'t, tell me what\'s still off.',
      },
      {
        to: 'Nina Park',
        subject: 'Noticed you came back to pricing',
        body: 'Nina — saw you back on pricing today. I\'m guessing you\'re either pitching internally or second-guessing. Happy to jump on 10 min either way and make your life easier.',
      },
      {
        to: 'Rae Mitchell',
        subject: 'Circling back — Q2 edition',
        body: 'Rae — last time you said "not this quarter." We\'re in a new quarter. Still a no, or is now the window?',
      },
    ],
    features: [
      'Everything in Starter',
      'HubSpot / Pipedrive sync — CRM stays source of truth',
      'Gmail or Outlook connection for one-click send',
      'Custom objection + playbook tuning to your voice',
      'Weekly pipeline review in plain English',
      'Priority support + monthly optimization call',
    ],
  },
  space_station: {
    label: 'Space Station',
    monthly: 400,
    buildRange: [8000, 15000],
    tagline: 'Team-grade AI SDR. Dedicated infra. Custom workflows. White-glove.',
    summary: { runsToday: 14, leadsProcessed: 612, actionsCreated: 74, latestRun: 'Team rollup · 2:14 PM' },
    leads: [
      { name: 'Everett Capital (3 contacts)', company: 'Everett Capital', status: 'hot', note: 'Procurement + CFO + champion all engaged' },
      { name: 'Westbridge Health', company: 'Westbridge Health', status: 'hot', note: 'MSA in legal review' },
      { name: 'Kaplan Group', company: 'Kaplan Group', status: 'warm', note: 'Multi-threaded; next step w/ IT' },
      { name: 'Orion Retail', company: 'Orion Retail', status: 'warm', note: 'Expansion into 2nd region' },
      { name: 'Hammond Brothers', company: 'Hammond Brothers', status: 'cold', note: 'Budget freeze — auto-revisit Q3' },
      { name: 'Sable & Finch', company: 'Sable & Finch', status: 'dormant', note: 'New champion detected on LinkedIn — reopening' },
    ],
    drafts: [
      {
        to: 'Everett Capital · CFO track',
        subject: 'ROI model updated with your Q1 actuals',
        body: 'Attached: the ROI model now running on your actual Q1 numbers. Payback moved from 9 mo → 6 mo. Legal has the MSA — anything blocking from your side?',
      },
      {
        to: 'Westbridge Health · Legal',
        subject: 'Redlines addressed + BAA attached',
        body: 'All three redline threads resolved in the attached. BAA included. Ready for signature whenever your counsel greenlights.',
      },
      {
        to: 'Sable & Finch · new champion',
        subject: 'Congrats on the new role — saw the news',
        body: 'Saw your announcement. We worked with your predecessor on a scoped pilot last year. Want me to walk you through what was built and whether it\'s worth reviving?',
      },
    ],
    features: [
      'Everything in Pro',
      'Dedicated infrastructure + isolated data',
      'Bring-your-own AI keys (full control of cost + usage)',
      'Custom workflows built for your sales motion',
      'Team dashboards + per-rep coaching notes',
      'SLA, white-glove onboarding, quarterly strategy reviews',
    ],
    extras: ['Multi-threading view', 'Per-rep coaching mode', 'Executive rollup email every Friday'],
  },
}

const TIERS: TierKey[] = ['starter', 'pro', 'space_station']

export default function DemoPage() {
  const [tier, setTier] = useState<TierKey>('starter')
  const d = DEMOS[tier]

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Virtual Closer · Live demo</p>
        <h1>See what your dashboard will actually look like.</h1>
        <p className="sub">
          {d.tagline}
        </p>
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
          <h2>Choose a tier to preview</h2>
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
                {info.label} · ${info.monthly}/mo
              </button>
            )
          })}
        </div>
      </section>

      <section className="grid-4">
        <article className="card stat">
          <p className="label">Runs today</p>
          <p className="value">{d.summary.runsToday}</p>
        </article>
        <article className="card stat">
          <p className="label">Leads processed</p>
          <p className="value">{d.summary.leadsProcessed}</p>
        </article>
        <article className="card stat">
          <p className="label">Actions created</p>
          <p className="value">{d.summary.actionsCreated}</p>
        </article>
        <article className="card stat">
          <p className="label">Latest run</p>
          <p className="value small">{d.summary.latestRun}</p>
        </article>
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>Prioritized leads</h2>
            <p>{d.leads.length}</p>
          </div>
          <ul className="list">
            {d.leads.map((l) => (
              <li key={l.name} className="row">
                <div>
                  <p className="name">{l.name}</p>
                  <p className="meta">{l.company}</p>
                  <p className="meta">{l.note}</p>
                </div>
                <div className="right">
                  <span className={`status ${l.status}`}>{l.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Pending email drafts</h2>
            <p>{d.drafts.length}</p>
          </div>
          <ul className="list">
            {d.drafts.map((draft, i) => (
              <li key={i} className="draft">
                <p className="meta">To: {draft.to}</p>
                <p className="subject">{draft.subject}</p>
                <p className="body">{draft.body}</p>
                <div className="actions">
                  <button className="btn approve" type="button" disabled style={{ opacity: 0.7, cursor: 'default' }}>
                    Approve + send
                  </button>
                  <button className="btn dismiss" type="button" disabled style={{ opacity: 0.7, cursor: 'default' }}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>What&apos;s in the {d.label} build</h2>
          <p>${d.buildRange[0].toLocaleString()}–${d.buildRange[1].toLocaleString()} one-time · ${d.monthly}/mo</p>
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
            Compare all tiers
          </Link>
        </div>
      </section>
    </main>
  )
}
