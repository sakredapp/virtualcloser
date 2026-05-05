'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'

type TierKey = 'individual' | 'enterprise'

type TierRow = { key: TierKey; label: string; monthly: number; build: number }

const INPUT_STYLE: CSSProperties = {
  padding: '0.65rem',
  borderRadius: 10,
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}

const LABEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  fontSize: '0.85rem',
  color: '#5a6aa6',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}


export default function NewClientPlanFields({
  tiers,
}: {
  tiers: TierRow[]
}) {
  const [tier, setTier] = useState<TierKey>(tiers[0].key)
  const current = tiers.find((t) => t.key === tier) ?? tiers[0]
  const [monthly, setMonthly] = useState<number>(current.monthly)
  const [build, setBuild] = useState<number>(current.build)
  const [maxSeats, setMaxSeats] = useState<string>('5')

  function changeTier(next: TierKey) {
    const row = tiers.find((t) => t.key === next) ?? tiers[0]
    setTier(next)
    setMonthly(row.monthly)
    setBuild(row.build)
    if (next === 'individual') {
      // Individual tier doesn't expose a seat cap.
      setMaxSeats('')
    } else if (!maxSeats) {
      setMaxSeats('5')
    }
  }

  return (
    <>
      <label style={LABEL_STYLE}>
        <span>Tier</span>
        <select
          name="tier"
          value={tier}
          onChange={(e) => changeTier(e.target.value as TierKey)}
          style={INPUT_STYLE}
        >
          {tiers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label} — ${t.monthly}/mo · ${t.build.toLocaleString()} build
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
        <label style={LABEL_STYLE}>
          <span>Monthly fee ($)</span>
          <input
            name="monthly_fee"
            type="number"
            value={monthly}
            onChange={(e) => setMonthly(Number(e.target.value))}
            style={INPUT_STYLE}
          />
        </label>
        <label style={LABEL_STYLE}>
          <span>Build fee ($)</span>
          <input
            name="build_fee"
            type="number"
            value={build}
            onChange={(e) => setBuild(Number(e.target.value))}
            style={INPUT_STYLE}
          />
        </label>
      </div>
      <small className="meta" style={{ marginTop: '-0.3rem' }}>
        Switching tier auto-fills the fees. Override either one to apply a discount.
      </small>

      {/* Enterprise-only: seat cap */}
      {tier === 'enterprise' && (
        <label style={LABEL_STYLE}>
          <span>Max seats (active members the owner can invite)</span>
          <input
            name="max_seats"
            type="number"
            min={1}
            max={10000}
            value={maxSeats}
            onChange={(e) => setMaxSeats(e.target.value)}
            style={INPUT_STYLE}
            placeholder="e.g. 5"
          />
          <small className="meta">Includes the owner. Leave blank for unlimited.</small>
        </label>
      )}

      {/* AI SDR — free-form hours + rate */}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <span style={{ ...LABEL_STYLE, display: 'block' }}>AI SDR hours</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
          <label style={LABEL_STYLE}>
            <span>Hrs / week (0 = no SDR plan)</span>
            <input
              name="sdr_hours_per_week"
              type="number"
              min={0}
              max={168}
              defaultValue={0}
              style={INPUT_STYLE}
              placeholder="e.g. 20"
            />
          </label>
          <label style={LABEL_STYLE}>
            <span>$ / hr</span>
            <input
              name="sdr_dollar_per_hour"
              type="number"
              min={0.5}
              max={50}
              step={0.25}
              defaultValue={6}
              style={INPUT_STYLE}
            />
          </label>
        </div>
        <small className="meta" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
          Monthly = hrs/wk × 4.3 × $/hr. Leave hrs at 0 to skip the SDR plan for now.
        </small>
      </div>
    </>
  )
}
