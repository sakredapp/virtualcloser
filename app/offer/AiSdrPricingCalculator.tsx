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
  /**
   * If defined, the card renders an "Add to cart" / "Remove" toggle and
   * dims the summary tile when not included. When undefined, behavior is
   * unchanged — price always rolls into the parent total (legacy mode).
   */
  included?: boolean
  /** Required when `included` is defined. Toggles cart membership. */
  onToggleIncluded?: () => void
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

/**
 * Individual usage-tier ladder (AWS-style blended pricing). Applies to
 * solo accounts where rep-count tiers don't make sense — instead the
 * customer earns volume discounts as they ramp monthly hours.
 *
 *   0-160 hrs/mo:     $6.00/hr
 *   160-200 hrs/mo:   $5.50/hr
 *   200-280 hrs/mo:   $5.00/hr
 *   280-340 hrs/mo:   $4.50/hr
 *   340+ hrs/mo:      $4.15/hr
 *
 * 160 hrs ≈ 40 hrs/wk · 200 ≈ 50 · 280 ≈ 70 · 340 ≈ 85.
 *
 * Blended (graduated) — first 160 always bills at $6, next slice at
 * $5.50, etc. Stripe supports this natively via tiers_mode='graduated'
 * when we wire billing.
 */
export const INDIVIDUAL_USAGE_TIERS: Array<{ upTo: number; ratePerHour: number }> = [
  { upTo: 160, ratePerHour: 6 },
  { upTo: 200, ratePerHour: 5.5 },
  { upTo: 280, ratePerHour: 5 },
  { upTo: 340, ratePerHour: 4.5 },
  { upTo: Number.POSITIVE_INFINITY, ratePerHour: 4.15 },
]

export type TierBreakdownSlice = {
  hoursInTier: number
  ratePerHour: number
  cents: number
  label: string
}

export type BlendedSnapshot = {
  totalHours: number
  totalCents: number
  blendedRate: number
  slices: TierBreakdownSlice[]
}

export function blendedIndividualMonthly(totalHours: number): BlendedSnapshot {
  const slices: TierBreakdownSlice[] = []
  let consumed = 0
  let totalCents = 0
  for (const tier of INDIVIDUAL_USAGE_TIERS) {
    if (consumed >= totalHours) break
    const ceiling = tier.upTo
    const sliceHours = Math.min(totalHours, ceiling) - consumed
    if (sliceHours <= 0) {
      consumed = ceiling
      continue
    }
    const cents = Math.round(sliceHours * tier.ratePerHour * 100)
    const startLabel = consumed === 0 ? '0' : consumed.toFixed(0)
    const endLabel =
      ceiling === Number.POSITIVE_INFINITY ? `${(consumed + sliceHours).toFixed(0)}` : ceiling.toFixed(0)
    slices.push({
      hoursInTier: sliceHours,
      ratePerHour: tier.ratePerHour,
      cents,
      label: `${startLabel}–${endLabel} hrs`,
    })
    totalCents += cents
    consumed = Math.min(totalHours, ceiling)
  }
  const blendedRate = totalHours > 0 ? totalCents / 100 / totalHours : 0
  return { totalHours, totalCents, blendedRate, slices }
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
  defaultHoursPerWeek = HOURS_MIN,
  defaultReps,
  micSlot,
  onChange,
  included,
  onToggleIncluded,
}: Props) {
  const cartEnabled = included !== undefined
  const isIn = cartEnabled && included === true
  const copy = PRODUCT_COPY[product]

  const [hoursPerWeek, setHoursPerWeek] = useState(
    clamp(defaultHoursPerWeek, HOURS_MIN, HOURS_MAX),
  )
  const [reps, setReps] = useState(
    mode === 'individual' ? 1 : snapReps(defaultReps ?? 5),
  )

  const hoursPerMonth = useMemo(() => Math.round(hoursPerWeek * WEEKS_PER_MONTH * 10) / 10, [hoursPerWeek])

  // Individual = blended/graduated tier ladder (AWS-style).
  // Team = flat rate × hours × seats, tier driven by rep count.
  const blended = useMemo(
    () => (mode === 'individual' ? blendedIndividualMonthly(hoursPerMonth) : null),
    [mode, hoursPerMonth],
  )

  const teamPricePerHour = mode === 'team' ? pricePerHourForReps(reps) : 6
  const teamPerAgentMonthlyCents = Math.round(hoursPerMonth * teamPricePerHour * 100)

  const pricePerHour = mode === 'individual' ? blended?.blendedRate ?? 6 : teamPricePerHour
  const perAgentMonthlyCents =
    mode === 'individual' ? blended?.totalCents ?? 0 : teamPerAgentMonthlyCents
  const totalMonthlyCents =
    mode === 'individual' ? blended?.totalCents ?? 0 : teamPerAgentMonthlyCents * reps

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

  const cardOuterStyle: React.CSSProperties = {
    ...cardStyle,
    position: 'relative',  // anchor for the absolutely-positioned mic
    border: cartEnabled
      ? isIn
        ? '2px solid #16a34a'
        : '2px dashed #cbd5e1'
      : cardStyle.border,
    boxShadow: cartEnabled && isIn
      ? '0 0 0 4px rgba(22,163,74,0.10), 0 8px 28px rgba(22,163,74,0.10)'
      : cardStyle.boxShadow,
    transition: 'border-color 160ms ease, box-shadow 160ms ease',
  }

  return (
    <details className="calc-details" style={cardOuterStyle}>
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'block',
          userSelect: 'none',
        }}
      >
        <div className="calc-card-header-row">
          <div className="calc-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <p style={kickerStyle}>{copy.kicker[mode]}</p>
              {cartEnabled && (
                <span style={isIn ? cartBadgeInStyle : cartBadgeOutStyle}>
                  {isIn ? '✓ In cart' : 'Not in cart'}
                </span>
              )}
            </div>
            <h3 style={{ margin: '10px 0 0', fontSize: 28, color: 'var(--ink)', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.2 }}>
              {copy.headline[mode]}
              <span
                aria-hidden
                className="calc-chevron"
                style={{
                  display: 'inline-block',
                  marginLeft: 10,
                  fontSize: 18,
                  color: 'var(--red)',
                  transition: 'transform 160ms',
                }}
              >
                ▾
              </span>
            </h3>
            <p style={{ margin: '12px 0 0', fontSize: 15, color: 'var(--text-meta)', lineHeight: 1.65, fontWeight: 400 }}>{copy.subhead}</p>
            <p className="calc-expand-hint" aria-hidden>
              <span className="calc-expand-hint-label-closed">Tap to see pricing</span>
              <span className="calc-expand-hint-label-open">Tap to collapse</span>
              <span className="calc-expand-hint-arrow">▾</span>
            </p>
          </div>
          {micSlot && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="calc-card-mic"
            >
              {micSlot}
            </div>
          )}
        </div>
      </summary>

      <div style={{ paddingTop: 28, marginTop: 28, borderTop: '1px solid var(--border-soft)' }}>

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

      {/* Price summary — dark slate tile, white text, red accent. Always
          full-color so the prospect can clearly read the preview price even
          when the card isn't in their cart yet. The Add-to-cart button +
          dashed border + "Not in cart" badge above carry the cart state. */}
      <div style={summaryStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={summaryKickerStyle}>
              {mode === 'team' ? `Total monthly · all ${productPlural}` : 'Monthly cost'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 40, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {fmtPrice(totalMonthlyCents)}
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}> /mo</span>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.78)' }}>
              {mode === 'individual' && blended ? (
                <>
                  <strong style={{ color: '#ff2800' }}>${blended.blendedRate.toFixed(2)}/hr blended</strong> × {hoursPerMonth} hrs/mo
                </>
              ) : (
                <>
                  <strong style={{ color: '#ff2800' }}>${pricePerHour.toFixed(2)}/hr</strong> × {hoursPerMonth} hrs/mo
                  {mode === 'team' && (
                    <>
                      <br /><strong style={{ color: '#ff2800' }}>{fmtPrice(perAgentMonthlyCents)}/mo</strong> per {productSingular} × {reps}
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        {mode === 'team' && reps >= 6 && (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#86efac', fontWeight: 700 }}>
            ✓ Volume discount applied — saving{' '}
            {fmtPrice((6 - pricePerHour) * 100 * hoursPerMonth * reps)}/mo vs. starter pricing.
          </p>
        )}

        {/* Blended-tier breakdown — show when at least 2 tiers were hit so
            the customer sees how their bill is composed and why volume
            discounts kick in. */}
        {mode === 'individual' && blended && blended.slices.length > 1 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.18)' }}>
            <p style={summaryKickerStyle}>
              Tier breakdown · blended rate ${blended.blendedRate.toFixed(2)}/hr
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
              <tbody>
                {blended.slices.map((s, i) => (
                  <tr key={i} style={{ borderBottom: i < blended.slices.length - 1 ? '1px dotted rgba(255,255,255,0.12)' : 'none' }}>
                    <td style={{ padding: '5px 0', color: 'rgba(255,255,255,0.78)' }}>{s.label}</td>
                    <td style={{ padding: '5px 0', color: 'rgba(255,255,255,0.78)', textAlign: 'center' }}>{s.hoursInTier.toFixed(1)} hrs</td>
                    <td style={{ padding: '5px 0', color: '#ff2800', textAlign: 'center', fontWeight: 600 }}>${s.ratePerHour.toFixed(2)}/hr</td>
                    <td style={{ padding: '5px 0', color: '#fff', textAlign: 'right', fontWeight: 700 }}>{fmtPrice(s.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
              First 160 hrs bill at $6/hr. Every slice above earns a discount —
              same model AWS uses, same model Stripe bills from. No mid-month
              price jumps.
            </p>
          </div>
        )}
      </div>

      <p style={{ margin: '14px 0 0', fontSize: 11, color: '#94a3b8' }}>
        {copy.perUnitNote} Hours reset every Monday.
      </p>

      {cartEnabled && (
        <button
          type="button"
          onClick={onToggleIncluded}
          style={isIn ? toggleInBtnStyle : toggleOutBtnStyle}
          aria-pressed={isIn}
        >
          {isIn ? (
            <>✓ In cart · {fmtPrice(totalMonthlyCents)}/mo · Remove</>
          ) : (
            <>＋ Add to cart · {fmtPrice(totalMonthlyCents)}/mo</>
          )}
        </button>
      )}
      </div>
    </details>
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
  border: '1px solid var(--border-soft)',
  borderRadius: 14,
  padding: '32px',
  boxShadow: 'var(--shadow-card)',
}

const summaryStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #2a2a2a 0%, #161616 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '16px 20px',
  marginTop: 18,
  boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
}

const summaryKickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#ff2800',
  margin: 0,
}

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--red, #ff2800)',
  margin: 0,
}

const cartBadgeBaseStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  padding: '3px 8px',
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
}

const cartBadgeInStyle: React.CSSProperties = {
  ...cartBadgeBaseStyle,
  background: '#dcfce7',
  color: '#15803d',
  border: '1px solid #86efac',
}

const cartBadgeOutStyle: React.CSSProperties = {
  ...cartBadgeBaseStyle,
  background: '#f1f5f9',
  color: '#64748b',
  border: '1px solid var(--border-soft)',
}

const toggleBaseBtnStyle: React.CSSProperties = {
  marginTop: 14,
  width: '100%',
  padding: '12px 18px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background 120ms ease, color 120ms ease, box-shadow 120ms ease',
}

const toggleOutBtnStyle: React.CSSProperties = {
  ...toggleBaseBtnStyle,
  background: '#ff2800',
  color: '#fff',
  border: '2px solid #ff2800',
  boxShadow: '0 6px 18px rgba(255,40,0,0.30)',
}

const toggleInBtnStyle: React.CSSProperties = {
  ...toggleBaseBtnStyle,
  background: '#fff',
  color: '#15803d',
  border: '2px solid #16a34a',
  boxShadow: '0 2px 6px rgba(22,163,74,0.18)',
}
