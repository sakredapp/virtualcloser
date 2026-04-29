'use client'

import { useState, useCallback } from 'react'

export type FeatureKey =
  // Core — always on, not toggleable
  | 'telegram_bot'
  | 'cal_webhook'
  | 'web_dashboard'
  // Integrations
  | 'bluebubbles'
  | 'ghl'
  | 'google'
  | 'hubspot'
  | 'pipedrive'
  | 'salesforce'
  | 'fathom'
  | 'zapier'
  | 'custom_api'
  | 'custom_webhook'
  // Features
  | 'brain'
  | 'voice_memos'
  | 'team'
  | 'rooms'
  | 'leaderboard'
  | 'roleplay'

type FeatureDef = {
  key: FeatureKey
  label: string
  desc: string
  group: 'core' | 'integration' | 'feature' | 'addon'
  alwaysOn?: boolean
  /** Minimum tier required. Shown as a badge; prospect can still be toggled for planning. */
  tierMin?: 'enterprise'
}

const TIER_BADGE: Record<string, { label: string; color: string }> = {
  enterprise: { label: 'Enterprise', color: 'var(--red)' },
}

export const ALL_FEATURES: FeatureDef[] = [
  // Core
  { key: 'telegram_bot',  label: 'Telegram Bot',           desc: 'Core AI assistant interface',            group: 'core', alwaysOn: true },
  { key: 'cal_webhook',   label: 'Cal.com',                 desc: 'Booking → prospect auto-sync',           group: 'core', alwaysOn: true },
  { key: 'web_dashboard', label: 'Web Dashboard',           desc: '/dashboard for the client',              group: 'core', alwaysOn: true },
  // Integrations
  { key: 'bluebubbles',    label: 'iMessage (BlueBubbles)',  desc: 'Two-way iMessage via client Mac',        group: 'integration' },
  { key: 'ghl',            label: 'GoHighLevel CRM',        desc: 'GHL pipeline + contact sync (API)',      group: 'integration' },
  { key: 'google',         label: 'Google Workspace',       desc: 'Calendar, Gmail, Drive sync (OAuth)',    group: 'integration' },
  { key: 'hubspot',        label: 'HubSpot CRM',            desc: 'Contact + deal sync (API)',              group: 'integration' },
  { key: 'pipedrive',      label: 'Pipedrive',              desc: 'Pipeline sync (API)',                    group: 'integration' },
  { key: 'salesforce',     label: 'Salesforce',             desc: 'Full CRM sync (API)',                    group: 'integration' },
  { key: 'fathom',         label: 'Fathom / Fireflies',     desc: 'Meeting transcript ingestion',           group: 'integration' },
  { key: 'zapier',         label: 'Zapier',                 desc: 'No-code automation webhooks',            group: 'integration' },
  { key: 'custom_api',     label: 'Custom API Integration', desc: 'Direct API to any platform',             group: 'integration', tierMin: 'enterprise' },
  { key: 'custom_webhook', label: 'Custom Webhooks',        desc: 'Inbound + outbound custom endpoints',    group: 'integration', tierMin: 'enterprise' },
  // Features
  { key: 'brain',          label: 'Brain / Tasks',          desc: 'Voice brain dump + task management',     group: 'feature' },
  { key: 'voice_memos',    label: 'Voice Memos',            desc: 'Pitch recording + manager feedback',     group: 'feature' },
  { key: 'team',           label: 'Team Dashboard',         desc: 'Multi-rep + shared pipeline view',       group: 'feature', tierMin: 'enterprise' },
  { key: 'rooms',          label: 'Rooms',                  desc: 'Manager broadcast channels',             group: 'feature', tierMin: 'enterprise' },
  { key: 'leaderboard',    label: 'Leaderboard',            desc: 'Activity + revenue leaderboard',         group: 'feature', tierMin: 'enterprise' },
  { key: 'roleplay',       label: 'Roleplay (Add-on)',      desc: 'AI sales practice sessions',             group: 'addon' },
]

const GROUP_LABELS: Record<string, string> = {
  core:        'Core (always included)',
  integration: 'Integrations',
  feature:     'Features',
  addon:       'Add-ons',
}

const GROUP_ORDER = ['core', 'integration', 'feature', 'addon']

type Props = {
  prospectId: string
  initial: string[]
}

export default function FeatureSelector({ prospectId, initial }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const toggle = useCallback(async (key: FeatureKey) => {
    const next = new Set(selected)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setSelected(next)
    setSaving(true)
    try {
      await fetch('/api/admin/prospect-features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId, features: Array.from(next) }),
      })
      setSavedAt(Date.now())
    } catch {
      // revert on failure
      setSelected(selected)
    } finally {
      setSaving(false)
    }
  }, [selected, prospectId])

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: ALL_FEATURES.filter((f) => f.group === group),
  }))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
          Select what you&apos;re building for this client. The Build Chat will generate setup
          instructions for only these features.
        </p>
        {saving && (
          <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>Saving…</span>
        )}
        {!saving && savedAt && (
          <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>Saved ✓</span>
        )}
      </div>

      {grouped.map(({ group, items }) => (
        <div key={group} style={{ marginBottom: '1rem' }}>
          <p style={{
            margin: '0 0 0.45rem',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--muted)',
          }}>
            {GROUP_LABELS[group]}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.45rem' }}>
            {items.map((f) => {
              const on = f.alwaysOn || selected.has(f.key)
              const disabled = !!f.alwaysOn
              return (
                <button
                  key={f.key}
                  onClick={() => !disabled && toggle(f.key)}
                  disabled={disabled}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.55rem',
                    padding: '0.6rem 0.75rem',
                    border: `1.5px solid ${on && !disabled ? 'var(--red)' : 'var(--ink-soft)'}`,
                    borderRadius: '8px',
                    background: on && !disabled
                      ? 'rgba(255,40,0,0.06)'
                      : disabled
                        ? 'var(--paper-2)'
                        : 'var(--paper)',
                    cursor: disabled ? 'default' : 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    opacity: disabled ? 0.7 : 1,
                    transition: 'border-color 0.12s, background 0.12s',
                  }}
                >
                  {/* Checkbox dot */}
                  <span style={{
                    flexShrink: 0,
                    width: '14px',
                    height: '14px',
                    marginTop: '1px',
                    borderRadius: '3px',
                    border: `1.5px solid ${on ? 'var(--red)' : 'var(--ink-soft)'}`,
                    background: on ? 'var(--red)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {on && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>
                        {f.label}
                      </span>
                      {f.tierMin && (
                        <span style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: TIER_BADGE[f.tierMin].color,
                          border: `1px solid ${TIER_BADGE[f.tierMin].color}`,
                          borderRadius: '3px',
                          padding: '0 3px',
                          lineHeight: '14px',
                          opacity: 0.8,
                        }}>
                          {TIER_BADGE[f.tierMin].label}
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4, marginTop: '1px' }}>
                      {f.desc}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
