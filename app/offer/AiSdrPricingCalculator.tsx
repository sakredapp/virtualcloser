'use client'

// Hire-an-SDR pricing calculator — slider-driven.
//
// Customer picks: hours per week (and, for team mode, # of SDRs).
// We show: $/hr (volume tier from rep count), monthly hours, monthly $.
//
// Volume pricing band, single source of truth here so the offer page
// for individual ($6 flat) and the enterprise multi-rep pickers can
// both render the same component:
//
//   1 rep / individual: $6.00/hr
//   2-10 reps:          $6.00/hr
//   11-25 reps:         $5.50/hr
//   26-50 reps:         $5.00/hr
//   51-100 reps:        $4.50/hr
//   100+ reps:          $4.00/hr

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

type Props = {
  /**
   * 'individual' = single SDR for one user, no rep count slider, $6/hr fixed.
   * 'team' = enterprise — second slider for # of SDRs to show volume pricing.
   */
  mode: Mode
  /** Initial values (default 40 hrs/wk, 1 rep individual / 5 reps team). */
  defaultHoursPerWeek?: number
  defaultReps?: number
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
  if (reps >= 100) return 4
  if (reps >= 51) return 4.5
  if (reps >= 26) return 5
  if (reps >= 11) return 5.5
  return 6
}

function bandLabel(reps: number): string {
  if (reps >= 100) return '100+ reps'
  if (reps >= 51) return '51–100 reps'
  if (reps >= 26) return '26–50 reps'
  if (reps >= 11) return '11–25 reps'
  if (reps >= 2) return '2–10 reps'
  return 'Individual'
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
  defaultHoursPerWeek = 40,
  defaultReps,
  onChange,
}: Props) {
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

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 16 }}>
        <p style={kickerStyle}>
          {mode === 'individual' ? 'Hire your AI SDR' : 'Hire your team of AI SDRs'}
        </p>
        <h3 style={{ margin: '4px 0 0', fontSize: 22, color: '#0f172a', fontWeight: 700 }}>
          Pick how many hours a week your SDR{mode === 'team' ? 's' : ''} dial.
        </h3>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
          You only pay for the hours you set — billed monthly, like an actual SDR&apos;s time.
        </p>
      </div>

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
          label="How many SDRs (one per rep)"
          value={reps}
          min={REPS_MIN}
          max={REPS_MAX}
          step={1}
          onChange={(v) => setReps(snapReps(v))}
          valueLabel={`${reps} ${reps === 1 ? 'SDR' : 'SDRs'}`}
          sub={`${bandLabel(reps)} · $${pricePerHour.toFixed(2)}/hr volume tier`}
        />
      )}

      {/* Price summary */}
      <div style={summaryStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#92400e' }}>
              {mode === 'team' ? 'Total monthly · all SDRs' : 'Monthly cost'}
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
                  <br /><strong>{fmtPrice(perAgentMonthlyCents)}/mo</strong> per SDR × {reps}
                </>
              )}
            </p>
          </div>
        </div>
        {mode === 'team' && reps >= 11 && (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#0369a1', fontWeight: 600 }}>
            ✓ Volume discount applied — you&apos;re saving{' '}
            {fmtPrice((6 - pricePerHour) * 100 * hoursPerMonth * reps)}/mo vs. starter pricing.
          </p>
        )}
      </div>

      <p style={{ margin: '14px 0 0', fontSize: 11, color: '#94a3b8' }}>
        Hours per week reset every Monday. Run them across any of the four dialer modes
        (Receptionist, Appointment Setter, Live Transfer, Workflows) — distribute via the
        in-dashboard shift scheduler. One active call at a time per tenant.
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
