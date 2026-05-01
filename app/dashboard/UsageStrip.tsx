// Reusable usage-cap strip. Server component — pass a repId + candidate
// addon keys and it renders a progress bar showing current period usage,
// the cap, and an upgrade CTA when over_cap.
//
// Used on /dashboard/dialer + /dashboard/roleplay so reps see their burn
// rate without needing to ask.

import Link from 'next/link'
import { resolveActiveAddon, usageFor } from '@/lib/usage'
import { ADDON_CATALOG, formatCap, type AddonKey } from '@/lib/addons'

type Props = {
  repId: string
  /** Candidate addon keys in priority order (Pro before Lite). */
  candidates: AddonKey[]
  /** Heading shown on the strip. */
  label: string
  /** Optional copy for the body. */
  blurb?: string
}

export default async function UsageStrip({ repId, candidates, label, blurb }: Props) {
  const key = await resolveActiveAddon(repId, candidates)

  if (!key) {
    return (
      <div
        style={{
          margin: '0 0 16px',
          padding: '20px 24px',
          borderRadius: 12,
          background: 'var(--paper)',
          color: 'var(--ink)',
          border: '1px dashed var(--border-soft)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ fontSize: 14, color: 'var(--text-meta)', fontWeight: 400 }}>
          {label}
        </div>
        <div style={{ marginTop: 6, fontSize: 14 }}>
          Not on your plan yet.{' '}
          <Link href="/offer" style={{ color: 'var(--red)', fontWeight: 600 }}>
            Add it →
          </Link>
        </div>
      </div>
    )
  }

  const def = ADDON_CATALOG[key]
  const snap = await usageFor(repId, key)
  const cap = snap.effective_cap ?? snap.cap
  const pct = cap && cap > 0 ? Math.min(100, Math.round((snap.used / cap) * 100)) : 0
  const overCap = snap.over_cap
  const nearCap = !overCap && pct >= 90

  return (
    <div
      style={{
        margin: '0 0 16px',
        padding: '20px 24px',
        borderRadius: 12,
        background: 'var(--paper)',
        color: 'var(--ink)',
        border: '1px solid ' + (overCap ? 'var(--red)' : nearCap ? '#d97706' : 'var(--border-soft)'),
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--text-meta)', fontWeight: 400 }}>
            {label}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{def.label}</div>
          {blurb ? <div style={{ fontSize: 13, color: 'var(--text-meta)', marginTop: 4 }}>{blurb}</div> : null}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em', color: overCap ? 'var(--red)' : 'var(--ink)' }}>
            {Math.round(snap.used)}
            {cap ? <span style={{ fontSize: 18, color: 'var(--text-meta)', fontWeight: 400 }}> / {cap}</span> : null}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-meta)', marginTop: 4 }}>
            {cap ? `${formatCap(def)}` : 'unlimited'} · period {snap.period}
          </div>
        </div>
      </div>

      {cap ? (
        <div
          style={{
            marginTop: 10,
            height: 6,
            borderRadius: 3,
            background: 'var(--paper-2, #f7f4ef)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: overCap ? 'var(--red)' : nearCap ? '#d97706' : '#10b981',
              transition: 'width 200ms ease',
            }}
          />
        </div>
      ) : null}

      {overCap && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: '#fff5f3',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          <strong style={{ color: 'var(--red)' }}>Cap hit.</strong> This add-on is paused until the
          1st.{' '}
          <Link href="/offer" style={{ color: 'var(--red)', fontWeight: 600 }}>
            Upgrade →
          </Link>
        </div>
      )}
      {nearCap && !overCap && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#92400e' }}>
          Heads up — you&apos;re at {pct}% of your cap.
        </div>
      )}
    </div>
  )
}
