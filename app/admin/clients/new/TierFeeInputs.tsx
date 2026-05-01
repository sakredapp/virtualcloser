'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'

type TierKey = 'individual' | 'enterprise'

type TierRow = { key: TierKey; label: string; monthly: number; build: number }

type HourPackage = {
  key: string
  label: string
  hours: number
  monthly_price_cents: number
}

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

const HOUR_CARD_STYLE = (active: boolean): CSSProperties => ({
  border: active ? '2px solid #0b1f5c' : '1px solid #e6d9ac',
  borderRadius: 10,
  padding: '10px 12px',
  background: active ? '#fef9c3' : '#ffffff',
  cursor: 'pointer',
  textAlign: 'center',
  fontSize: 13,
  color: '#0b1f5c',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  transition: 'all 80ms',
})

export default function NewClientPlanFields({
  tiers,
  hourPackages,
}: {
  tiers: TierRow[]
  hourPackages: HourPackage[]
}) {
  const [tier, setTier] = useState<TierKey>(tiers[0].key)
  const current = tiers.find((t) => t.key === tier) ?? tiers[0]
  const [monthly, setMonthly] = useState<number>(current.monthly)
  const [build, setBuild] = useState<number>(current.build)
  const [hourPlan, setHourPlan] = useState<string>('') // empty = no SDR plan
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

      {/* Hour package picker — visible on both tiers */}
      <div style={LABEL_STYLE}>
        <span>AI SDR hour package</span>
        <small className="meta" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
          Pick one to bill weekly hours like an SDR. Skip if they only want the base build for now.
        </small>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 8,
            marginTop: 6,
          }}
        >
          <button
            type="button"
            onClick={() => setHourPlan('')}
            style={HOUR_CARD_STYLE(hourPlan === '')}
          >
            <strong style={{ fontSize: 13 }}>Skip</strong>
            <span style={{ fontSize: 11, color: '#6b7280' }}>No SDR plan yet</span>
          </button>
          {hourPackages.map((pkg) => (
            <button
              key={pkg.key}
              type="button"
              onClick={() => setHourPlan(pkg.key)}
              style={HOUR_CARD_STYLE(hourPlan === pkg.key)}
            >
              <strong style={{ fontSize: 14 }}>{pkg.hours} hrs/wk</strong>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                ${(pkg.monthly_price_cents / 100).toFixed(0)}/mo
              </span>
            </button>
          ))}
        </div>
        <input type="hidden" name="hour_package_key" value={hourPlan} />
      </div>
    </>
  )
}
