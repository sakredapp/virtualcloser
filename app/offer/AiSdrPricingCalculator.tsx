'use client'

// Hire-an-SDR / Hire-a-Trainer pricing calculator — slider-driven.
//
// Customer picks: hours per week (and, for team mode, # of agents).
// We show: $/hr (volume tier from rep count), monthly hours, monthly $.
//
// Volume pricing band, single source of truth here. Same tiers apply to
// both SDR and Trainer (per user direction — same pricing, different
// product). Used by both /offer (individual) and /offer/enterprise:
//
//   1-5 reps / individual: $6.00/hr
//   6-25 reps:             $5.50/hr
//   26-50 reps:            $5.00/hr
//   51-100 reps:           $4.50/hr
//   100+ reps:             $4.15/hr

import { useMemo, useState } from 'react'

const WEEKS_PER_MONTH = 4.3 // round-number industry standard

const HOURS_MIN = 10
const HOURS_MAX = 80
const HOURS_STEP = 1 // drag-to-fine-tune; customer can land on any integer

const REPS_MIN = 1
const REPS_MAX = 250
const REPS_STEP_BAND: Array<[max: number, step: number]> = [
  [10, 1],
  [50, 5],
  [100, 10],
  [250, 25],
]

type Mode = 'individual' | 'team'

export type Product = 'sdr' | 'trainer'

const PRODUCT_COPY: Record<
  Product,
  {
    productLabel: string
    productLabelPlural: string
    kicker: { individual: string; team: string }
    headline: { individual: string; team: string }
    subhead: string
    perUnitNote: string
    sliderLabel: { reps: string }
  }
> = {
  sdr: {
    productLabel: 'SDR',
    productLabelPlural: 'SDRs',
    kicker: { individual: 'Hire your AI SDR', team: 'Hire AI SDRs for your team' },
    headline: {
      individual: 'Pick how many hours a week your SDR dials.',
      team: 'Pick how many SDRs and how many hours each dials.',
    },
    subhead:
      'No sick days. No complaining. No bonuses. Just a hard worker — your AI SDR clocks in for the hours you set, dials your leads, and books the meetings.',
    perUnitNote:
      'Each SDR splits weekly hours across the four dialer modes (Receptionist, Appointment Setter, Live Transfer, Workflows) via the in-dashboard shift scheduler. One active call per tenant at a time.',
    sliderLabel: { reps: 'How many SDRs (one per rep)' },
  },
  trainer: {
    productLabel: 'Trainer',
    productLabelPlural: 'Trainers',
    kicker: { individual: 'Hire your AI Trainer', team: 'Hire AI Trainers for your team' },
    headline: {
      individual: 'Pick how many hours a week you want to roleplay.',
      team: 'Pick how many trainers and how many hours each runs.',
    },
    subhead:
      "Always-on roleplay coach. Throws objections, runs full discovery scripts, gives feedback after every call. Never gets tired of practicing — your reps don't either, because they choose when.",
    perUnitNote:
      'Each Trainer hour can be a full discovery roleplay, an objection drill, or a quick warm-up. Reps schedule sessions in the dashboard or just hit the mic and go.',
    sliderLabel: { reps: 'How many Trainer seats' },
  },
}

type Props = {
  /**
   * 'individual' = single agent for one user, no rep count slider, $6/hr fixed.
   * 'team' = enterprise — second slider for # of agents to show volume pricing.
   */
  mode: Mode
  /** Which product is being priced. Defaults to 'sdr' for backward-compat. */
  product?: Product
  /** Initial values (default 40 hrs/wk, 1 rep individual / 5 reps team). */
  defaultHoursPerWeek?: number
  defaultReps?: number
  /**
   * Optional slot rendered inside the summary tile — used to drop the
   * "Try the voice" mic button right next to the price.
   */
  micSlot?: React.ReactNode
  /** Optional callback for parents that need to know the picked dollar amount. */
  onChange?: (snapshot: {
    hoursPerWeek: number
    reps: number
    pricePerHour: number
    monthlyCents: number
    perAgentMonthlyCents: number
  }) => void
}

export function pricePerHourForReps(reps: number): number {
  if (reps >= 100) return 4.15
  if (reps >= 51) return 4.5
  if (reps >= 26) return 5
  if (reps >= 6) return 5.5
  return 6
}

function bandLabel(reps: number): string {
  if (reps >= 100) return '100+ reps'
  if (reps >= 51) return '51–100 reps'
  if (reps >= 26) return '26–50 reps'
  if (reps >= 6) return '6–25 reps'
  return '1–5 reps'
}

function fmtPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function snapReps(raw: number): number {
  const r = clamp(Math.round(raw), REPS_MIN, REPS_MAX)
  for (const [maxR, step] of REPS_STEP_BAND) {
    if (r <= maxR) return Math.round(r / step) * step || step
  }
  return r
}

export default function AiSdrPricingCalculator({
  mode,
  product = 'sdr',
  defaultHoursPerWeek = 40,
  defaultReps,
  micSlot,
  onChange,
}: Props) {
  const copy = PRODUCT_COPY[product]

  const [hoursPerWeek, setHoursPerWeek] = useState(
    clamp(defaultHoursPerWeek, HOURS_MIN, HOURS_MAX),
  )
  const [reps, setReps] = useState(
    mode === 'individual' ? 1 : snapReps(defaultReps ?? 5),
  )

  const pricePerHour = mode === 'individual' ? 6 : pricePerHourForReps(reps)
  const hoursPerMonth = useMemo(() => Math.round(hoursPerWeek * WEEKS_PER_MONTH * 10) / 10, [hoursPerWeek])
  const perAgentMonthlyCents = Math.round(hoursPerMonth * pricePerHour * 100)
  const totalMonthlyCents = perAgentMonthlyCents * (mode === 'individual' ? 1 : reps)

  // Notify parent on every change.
  useMemo(() => {
    if (onChange) {
      onChange({
        hoursPerWeek,
        reps,
        pricePerHour,
        monthlyCents: totalMonthlyCents,
        perAgentMonthlyCents,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursPerWeek, reps, pricePerHour, totalMonthlyCents, perAgentMonthlyCents])

  const productSingular = copy.productLabel
  const productPlural = copy.productLabelPlural

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 16 }}>
        <p style={kickerStyle}>{copy.kicker[mode]}</p>
        <h3 style={{ margin: '4px 0 0', fontSize: 22, color: '#0f172a', fontWeight: 700 }}>
          {copy.headline[mode]}
        </h3>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>{copy.subhead}</p>
      </div>

      {/* Try-the-voice mic button (optional, parent passes it via micSlot) */}
      {micSlot && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          {micSlot}
        </div>
      )}

      {/* Hours/week slider */}
      <SliderRow
        label="Hours per week"
        value={hoursPerWeek}
        min={HOURS_MIN}
        max={HOURS_MAX}
        step={HOURS_STEP}
        onChange={setHoursPerWeek}
        valueLabel={`${hoursPerWeek} hrs/wk`}
        sub={`${hoursPerMonth} hrs/month at ${WEEKS_PER_MONTH} weeks/month`}
      />

      {/* Reps slider — team mode only */}
      {mode === 'team' && (
        <SliderRow
          label={copy.sliderLabel.reps}
          value={reps}
          min={REPS_MIN}
          max={REPS_MAX}
          step={1}
          onChange={(v) => setReps(snapReps(v))}
          valueLabel={`${reps} ${reps === 1 ? productSingular : productPlural}`}
          sub={`${bandLabel(reps)} · $${pricePerHour.toFixed(2)}/hr volume tier`}
        />
      )}

      {/* Price summary */}
      <div style={summaryStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#92400e' }}>
              {mode === 'team' ? `Total monthly · all ${productPlural}` : 'Monthly cost'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 38, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
              {fmtPrice(totalMonthlyCents)}
              <span style={{ fontSize: 16, color: '#64748b', fontWeight: 500 }}> /mo</span>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#525252' }}>
              <strong>${pricePerHour.toFixed(2)}/hr</strong> × {hoursPerMonth} hrs/mo
              {mode === 'team' && (
                <>
                  <br /><strong>{fmtPrice(perAgentMonthlyCents)}/mo</strong> per {productSingular} × {reps}
                </>
              )}
            </p>
          </div>
        </div>
        {mode === 'team' && reps >= 6 && (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#0369a1', fontWeight: 600 }}>
            ✓ Volume discount applied — you&apos;re saving{' '}
            {fmtPrice((6 - pricePerHour) * 100 * hoursPerMonth * reps)}/mo vs. starter pricing.
          </p>
        )}
      </div>

      <p style={{ margin: '14px 0 0', fontSize: 11, color: '#94a3b8' }}>
        {copy.perUnitNote} Hours reset every Monday.
      </p>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  valueLabel,
  sub,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
  valueLabel: string
  sub?: string
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#525252' }}>
          {label}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          accentColor: 'var(--red, #ff2800)',
          cursor: 'pointer',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {sub && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>{sub}</p>
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--paper, #fff)',
  border: '1px solid var(--line, #e6e1d8)',
  borderRadius: 14,
  padding: '22px 24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}

const summaryStyle: React.CSSProperties = {
  background: '#fef9c3',
  border: '1px solid #fde68a',
  borderRadius: 12,
  padding: '14px 18px',
  marginTop: 18,
}

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--red, #ff2800)',
  margin: 0,
}
