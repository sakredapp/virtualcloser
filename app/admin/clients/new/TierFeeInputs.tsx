'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'

type TierKey = 'salesperson' | 'team_builder' | 'executive'

type TierRow = { key: TierKey; label: string; monthly: number; build: number }

const INPUT_STYLE: CSSProperties = {
  padding: '0.65rem',
  borderRadius: 10,
  border: '1px solid #e6d9ac',
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

export default function TierFeeInputs({ tiers }: { tiers: TierRow[] }) {
  const [tier, setTier] = useState<TierKey>(tiers[0].key)
  const current = tiers.find((t) => t.key === tier) ?? tiers[0]
  const [monthly, setMonthly] = useState<number>(current.monthly)
  const [build, setBuild] = useState<number>(current.build)

  function changeTier(next: TierKey) {
    const row = tiers.find((t) => t.key === next) ?? tiers[0]
    setTier(next)
    setMonthly(row.monthly)
    setBuild(row.build)
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
    </>
  )
}
