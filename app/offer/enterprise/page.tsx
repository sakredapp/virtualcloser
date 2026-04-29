'use client'

// ─────────────────────────────────────────────────────────────────────────
// /offer/enterprise — Enterprise pricing page
//
// Different math from individual:
//   • Base build is PER SEAT with bulk discount tiers.
//   • Team + leaderboard is required (pre-checked, non-removable).
//   • AI Concierge / dialer minutes are pooled across the org; we slide
//     rep-count × appts/mo to estimate total minutes and recommend the
//     right tier (Lite / Pro / Custom).
//   • Roleplay minutes are pooled across the org; we slide reps-doing-
//     roleplay × sessions/week × mins/session to estimate total minutes
//     and recommend the right tier.
//   • CRM, white-label, WAVV, BlueBubbles, Fathom remain flat add-ons.
//
// All prices in cents. Source of truth for individual add-on prices is
// ADDON_CATALOG; we compose those for enterprise here.
// ─────────────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { useMemo, useState } from 'react'
import OfferTabs from '@/app/components/OfferTabs'
import {
  ADDON_CATALOG,
  formatPriceCents,
  type AddonKey,
} from '@/lib/addons'
import {
  AI_DIALER_CENTS_PER_MIN,
  ROLEPLAY_CENTS_PER_MIN,
  approxAppts,
  dialerMonthlyCents,
  roleplayMonthlyCents,
} from '@/lib/minutePricing'

// Org-wide pool ceilings (used for the slider max + the "past our standard
// pool" banner). Above these we still let them slide — it just suggests we
// scope it on the call instead of pure auto-pricing.
const DIALER_POOL_MAX_MIN = 10000
const DIALER_POOL_STEP_MIN = 60
const ROLEPLAY_POOL_MAX_MIN = 10000
const ROLEPLAY_POOL_STEP_MIN = 60

// ── Per-seat base build with bulk tiers ──────────────────────────────────
const BASE_PER_SEAT_TIERS: { min: number; max: number; cents: number; label: string }[] = [
  { min: 1, max: 4, cents: 9900, label: '1–4 reps' },
  { min: 5, max: 9, cents: 8900, label: '5–9 reps' },
  { min: 10, max: 19, cents: 7900, label: '10–19 reps' },
  { min: 20, max: 49, cents: 6900, label: '20–49 reps' },
  { min: 50, max: 9999, cents: 5900, label: '50+ reps' },
]

function perSeatCents(reps: number): { cents: number; label: string } {
  for (const t of BASE_PER_SEAT_TIERS) {
    if (reps >= t.min && reps <= t.max) return { cents: t.cents, label: t.label }
  }
  return { cents: BASE_PER_SEAT_TIERS[0].cents, label: BASE_PER_SEAT_TIERS[0].label }
}

// ── Account-level flat add-ons (NOT multiplied by rep count) ─────────────
type FlatAddon = { key: AddonKey; label: string; description: string; cents: number; required?: boolean }

const FLAT_ADDONS: FlatAddon[] = [
  {
    key: 'addon_team_leaderboard',
    label: 'Team + leaderboard',
    description: 'Multi-rep account, manager rollups, leaderboards, role-based visibility. Required for Enterprise.',
    cents: ADDON_CATALOG.addon_team_leaderboard.monthly_price_cents,
    required: true,
  },
  {
    key: 'addon_white_label',
    label: 'White label',
    description: 'Your domain, your brand, your team never sees ours.',
    cents: ADDON_CATALOG.addon_white_label.monthly_price_cents,
  },
  {
    key: 'addon_bluebubbles',
    label: 'iMessage relay (BlueBubbles)',
    description: 'Send/receive iMessage from inside Virtual Closer.',
    cents: ADDON_CATALOG.addon_bluebubbles.monthly_price_cents,
  },
  {
    key: 'addon_fathom',
    label: 'Fathom call intelligence',
    description: 'Auto-import recordings + transcripts, action items extracted to brain dump.',
    cents: ADDON_CATALOG.addon_fathom.monthly_price_cents,
  },
]

// ── CRM (pick at most one) ───────────────────────────────────────────────
type CrmKey = 'addon_ghl_crm' | 'addon_hubspot_crm' | 'addon_pipedrive_crm' | 'addon_salesforce_crm' | 'none'

const CRM_OPTIONS: { key: CrmKey; label: string; cents: number }[] = [
  { key: 'none', label: 'Use VC built-in CRM pipeline', cents: 0 },
  { key: 'addon_ghl_crm', label: 'GoHighLevel', cents: ADDON_CATALOG.addon_ghl_crm.monthly_price_cents },
  { key: 'addon_hubspot_crm', label: 'HubSpot', cents: ADDON_CATALOG.addon_hubspot_crm.monthly_price_cents },
  { key: 'addon_pipedrive_crm', label: 'Pipedrive', cents: ADDON_CATALOG.addon_pipedrive_crm.monthly_price_cents },
  { key: 'addon_salesforce_crm', label: 'Salesforce', cents: ADDON_CATALOG.addon_salesforce_crm.monthly_price_cents },
]

// ── Enterprise per-rep add-on pricing ────────────────────────────────────
// CRM integrations and WAVV scale with headcount — each additional rep we
// integrate means more pipeline records, more data routing, and ongoing
// support overhead. These are NOT vendor pass-throughs; they reflect our
// backend IT work per rep. We pass volume savings along.
//
// Fixed vendor add-ons (white label, BlueBubbles, Fathom) stay flat because
// we pay one infrastructure/licence fee regardless of how many reps use them.
//
// All tiers are cheaper per-rep than the $40 individual flat rate at volume.
type PerRepTier = { min: number; max: number; perRepCents: number }

// GHL / HubSpot / Pipedrive — individual flat = $40
const ENT_STANDARD_CRM_TIERS: PerRepTier[] = [
  { min: 1,  max: 4,    perRepCents: 1000 }, // $10/rep  (4 reps = $40 ≈ individual)
  { min: 5,  max: 9,    perRepCents: 800  }, // $8/rep
  { min: 10, max: 24,   perRepCents: 600  }, // $6/rep
  { min: 25, max: 49,   perRepCents: 500  }, // $5/rep
  { min: 50, max: 9999, perRepCents: 400  }, // $4/rep
]

// Salesforce — individual flat = $80
const ENT_SALESFORCE_TIERS: PerRepTier[] = [
  { min: 1,  max: 4,    perRepCents: 2000 }, // $20/rep  (4 reps = $80 ≈ individual)
  { min: 5,  max: 9,    perRepCents: 1600 }, // $16/rep
  { min: 10, max: 24,   perRepCents: 1200 }, // $12/rep
  { min: 25, max: 49,   perRepCents: 1000 }, // $10/rep
  { min: 50, max: 9999, perRepCents: 800  }, // $8/rep
]

// WAVV — individual flat = $20
const ENT_WAVV_TIERS: PerRepTier[] = [
  { min: 1,  max: 4,    perRepCents: 500 }, // $5/rep  (4 reps = $20 ≈ individual)
  { min: 5,  max: 9,    perRepCents: 400 }, // $4/rep
  { min: 10, max: 24,   perRepCents: 300 }, // $3/rep
  { min: 25, max: 49,   perRepCents: 200 }, // $2/rep
  { min: 50, max: 9999, perRepCents: 200 }, // $2/rep
]

function perRepRate(tiers: PerRepTier[], reps: number): number {
  for (const t of tiers) {
    if (reps >= t.min && reps <= t.max) return t.perRepCents
  }
  return tiers[0].perRepCents
}

function entCrmPerRepCents(key: CrmKey, reps: number): number {
  if (key === 'none') return 0
  if (key === 'addon_salesforce_crm') return perRepRate(ENT_SALESFORCE_TIERS, reps)
  return perRepRate(ENT_STANDARD_CRM_TIERS, reps)
}

// ── Booking helper ───────────────────────────────────────────────────────
const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

function bookingHref(opts: {
  reps: number
  apptsMo: number
  rpMin: number
  mrrCents: number
  notes: string
}): string {
  try {
    const url = new URL(CAL_BOOKING_URL)
    url.searchParams.set('metadata[mode]', 'enterprise')
    url.searchParams.set('metadata[reps]', String(opts.reps))
    url.searchParams.set('metadata[appts_mo]', String(opts.apptsMo))
    url.searchParams.set('metadata[rp_min]', String(opts.rpMin))
    url.searchParams.set('metadata[mrr_cents]', String(opts.mrrCents))
    url.searchParams.set('notes', opts.notes)
    return url.toString()
  } catch {
    return CAL_BOOKING_URL
  }
}

// ── Component ────────────────────────────────────────────────────────────
export default function EnterpriseOfferPage() {
  // Inputs
  const [reps, setReps] = useState(5)
  // Direct minute-pool sliders — the customer picks the cap, price is linear.
  const [dialerPoolMin, setDialerPoolMin] = useState(900)
  const [roleplayPoolMin, setRoleplayPoolMin] = useState(600)
  // Tangible-example state for roleplay (reps × sessions/wk × min/session).
  // Kept as a calculator that nudges (does not lock) the pool slider.
  const [repsDoingRoleplay, setRepsDoingRoleplay] = useState(5)
  const [sessionsPerWeek, setSessionsPerWeek] = useState(2)
  const [minsPerSession, setMinsPerSession] = useState(15)

  const [crm, setCrm] = useState<CrmKey>('addon_ghl_crm')
  const [wavvSelected, setWavvSelected] = useState(false)
  const [flatSelected, setFlatSelected] = useState<Set<AddonKey>>(
    new Set<AddonKey>(['addon_team_leaderboard']),
  )

  // Derived: per-seat base
  const seat = useMemo(() => perSeatCents(reps), [reps])
  const baseTotalCents = seat.cents * reps

  // Derived: org-wide dialer (linear)
  const dialerCents = useMemo(
    () => dialerMonthlyCents(dialerPoolMin),
    [dialerPoolMin],
  )
  const dialerApprox = approxAppts(dialerPoolMin)
  const dialerOverPool = dialerPoolMin > 3000

  // Derived: org-wide roleplay (linear)
  const roleplayCents = useMemo(
    () => roleplayMonthlyCents(roleplayPoolMin),
    [roleplayPoolMin],
  )
  // Suggestion math (4.33 weeks/mo) — NOT auto-applied. Shown alongside slider.
  const suggestedRpMin = Math.round(
    repsDoingRoleplay * sessionsPerWeek * minsPerSession * 4.33,
  )
  const roleplayOverPool = roleplayPoolMin > 3000

  // Derived: flat add-ons
  const flatTotalCents = useMemo(() => {
    let sum = 0
    for (const a of FLAT_ADDONS) {
      if (a.required || flatSelected.has(a.key)) sum += a.cents
    }
    return sum
  }, [flatSelected])

  // Derived: CRM (per-rep enterprise tiers)
  const crmPerRepCents = entCrmPerRepCents(crm, reps)
  const crmCents = crmPerRepCents * reps

  // Derived: WAVV (per-rep enterprise tiers)
  const wavvPerRepCents = perRepRate(ENT_WAVV_TIERS, reps)
  const wavvCents = wavvSelected ? wavvPerRepCents * reps : 0

  const monthlyCents =
    baseTotalCents + dialerCents + roleplayCents + flatTotalCents + crmCents + wavvCents
  const perSeatBlendedCents = reps > 0 ? Math.round(monthlyCents / reps) : 0

  // Build line items for summary
  const lineItems: { label: string; cents: number; sub?: string }[] = [
    {
      label: `Base build × ${reps} ${reps === 1 ? 'seat' : 'seats'}`,
      cents: baseTotalCents,
      sub: `${formatPriceCents(seat.cents)}/seat (${seat.label} tier)`,
    },
  ]
  if (crmCents > 0) {
    lineItems.push({
      label: CRM_OPTIONS.find((c) => c.key === crm)?.label ?? 'CRM',
      cents: crmCents,
      sub: `${formatPriceCents(crmPerRepCents)}/rep × ${reps} reps (enterprise rate)`,
    })
  }
  if (wavvCents > 0) {
    lineItems.push({
      label: 'WAVV dialer KPI ingest',
      cents: wavvCents,
      sub: `${formatPriceCents(wavvPerRepCents)}/rep × ${reps} reps (enterprise rate)`,
    })
  }
  if (dialerCents > 0) {
    lineItems.push({
      label: `AI Concierge · ${dialerPoolMin.toLocaleString()} min/mo cap`,
      cents: dialerCents,
      sub: `≈ ${dialerApprox.toLocaleString()} confirmed appts / mo across the org`,
    })
  }
  if (roleplayCents > 0) {
    lineItems.push({
      label: `Roleplay · ${roleplayPoolMin.toLocaleString()} min/mo cap`,
      cents: roleplayCents,
      sub: 'Pooled across the org',
    })
  }
  for (const a of FLAT_ADDONS) {
    if (a.required || flatSelected.has(a.key)) {
      lineItems.push({ label: a.label, cents: a.cents })
    }
  }

  const bookNotes =
    `Enterprise build · ${reps} reps · ` +
    `Dialer pool ${dialerPoolMin} min/mo (≈ ${dialerApprox} appts) · ` +
    `Roleplay pool ${roleplayPoolMin} min/mo. ` +
    `Monthly: ${formatPriceCents(monthlyCents)} (${formatPriceCents(perSeatBlendedCents)}/seat blended).`

  const bookHref = bookingHref({
    reps,
    apptsMo: dialerApprox,
    rpMin: roleplayPoolMin,
    mrrCents: monthlyCents,
    notes: bookNotes,
  })

  const toggleFlat = (key: AddonKey) => {
    const def = FLAT_ADDONS.find((a) => a.key === key)
    if (def?.required) return
    setFlatSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p
          className="eyebrow"
          style={{ fontStyle: 'italic', letterSpacing: '0.14em', opacity: 0.9 }}
        >
          One nucleus, every rep, every manager.
        </p>
        <h1>Build the AI employee for the whole sales org.</h1>
        <p className="sub">
          Per-seat base build with bulk pricing. Org-wide minute pools for the AI dialer
          and roleplay so seats share what the team actually uses. Slide your numbers, see
          your monthly, book the kickoff.
        </p>
      </header>

      <OfferTabs side="enterprise" view="pricing" />

      <section
        className="card"
        style={{
          marginTop: '0.8rem',
          background: '#fff',
          borderColor: 'var(--brand-red, var(--red))',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.72rem',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--brand-red, var(--red))',
          }}
        >
          Enterprise quote builder
        </p>
        <h2 style={{ margin: '0.3rem 0 0.4rem', color: 'var(--ink)' }}>
          Slide your numbers, see your monthly
        </h2>
        <p className="meta" style={{ margin: 0 }}>
          We quote the one-time build fee on the kickoff call (it depends on integration
          scope). The monthly is what you see right here.
        </p>

        <div className="ent-grid">
          {/* ── Inputs column ───────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Rep count */}
            <Group title="Team size">
              <SliderRow
                label="Reps on the build"
                value={reps}
                min={1}
                max={75}
                step={1}
                onChange={setReps}
                hint={`${seat.label} tier · ${formatPriceCents(seat.cents)}/seat/mo`}
              />
              <BulkTierGuide reps={reps} onPick={setReps} />
            </Group>

            {/* Dialer minute pool */}
            <Group title="AI Concierge dialer · org-wide minute pool">
              <p className="meta" style={{ margin: 0, marginBottom: 8 }}>
                You buy a pool of minutes per month at <strong>${(AI_DIALER_CENTS_PER_MIN / 100).toFixed(2)}/min</strong>.
                That pool is the hard cap — pause + email when it's hit, everything
                else keeps running. Hover or use the slider to pick.
              </p>
              <SliderRow
                label="Dialer minutes / month"
                value={dialerPoolMin}
                min={0}
                max={DIALER_POOL_MAX_MIN}
                step={DIALER_POOL_STEP_MIN}
                onChange={setDialerPoolMin}
                hint={
                  dialerPoolMin === 0
                    ? 'Skip dialer — you can add it later.'
                    : `≈ ${dialerApprox.toLocaleString()} confirmed appts / mo (assuming ~3 min each) · ${formatPriceCents(dialerCents)}/mo`
                }
              />
              {dialerOverPool && (
                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--red)', fontWeight: 700 }}>
                  Past our standard 3,000-min/mo pool — let&apos;s scope volume on the call.
                </p>
              )}
            </Group>

            {/* Roleplay minute pool */}
            <Group title="Roleplay · org-wide minute pool">
              <p className="meta" style={{ margin: 0, marginBottom: 8 }}>
                Same model as dialer: pick a monthly minute pool at{' '}
                <strong>${(ROLEPLAY_CENTS_PER_MIN / 100).toFixed(2)}/min</strong>. The
                tangible-example sliders below just SUGGEST a starting number — the
                pool slider is what you actually buy.
              </p>
              <SliderRow
                label="Roleplay minutes / month"
                value={roleplayPoolMin}
                min={0}
                max={ROLEPLAY_POOL_MAX_MIN}
                step={ROLEPLAY_POOL_STEP_MIN}
                onChange={setRoleplayPoolMin}
                hint={
                  roleplayPoolMin === 0
                    ? 'Skip roleplay — you can add it later.'
                    : `${formatPriceCents(roleplayCents)}/mo · pooled across the org`
                }
              />
              {roleplayOverPool && (
                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--red)', fontWeight: 700 }}>
                  Past our standard 3,000-min/mo pool — let&apos;s scope volume on the call.
                </p>
              )}
              <div style={{ height: 8 }} />
              <p
                style={{
                  margin: 0,
                  fontSize: '0.7rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                Tangible example · suggest a starting pool
              </p>
              <SliderRow
                label="Reps doing roleplay"
                value={repsDoingRoleplay}
                min={0}
                max={Math.max(reps, 1)}
                step={1}
                onChange={setRepsDoingRoleplay}
              />
              <SliderRow
                label="Sessions per week / rep"
                value={sessionsPerWeek}
                min={0}
                max={10}
                step={1}
                onChange={setSessionsPerWeek}
              />
              <SliderRow
                label="Minutes per session"
                value={minsPerSession}
                min={5}
                max={45}
                step={5}
                onChange={setMinsPerSession}
              />
              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  fontSize: '0.78rem',
                  color: 'var(--ink)',
                }}
              >
                <span>
                  Suggested pool: <strong>{suggestedRpMin.toLocaleString()} min / mo</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setRoleplayPoolMin(Math.min(ROLEPLAY_POOL_MAX_MIN, suggestedRpMin))}
                  style={{
                    cursor: 'pointer',
                    background: 'var(--paper, #fff)',
                    color: 'var(--ink)',
                    border: '1.5px solid var(--ink)',
                    borderRadius: 7,
                    padding: '0.4rem 0.7rem',
                    fontWeight: 700,
                    fontSize: '0.74rem',
                    letterSpacing: '0.04em',
                  }}
                >
                  Use this pool
                </button>
              </div>
            </Group>

            {/* CRM picker */}
            <Group title="CRM build (pick one)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {CRM_OPTIONS.map((opt) => {
                  const active = crm === opt.key
                  const perRep = entCrmPerRepCents(opt.key, reps)
                  const total = perRep * reps
                  const included = opt.key !== 'none' ? ADDON_CATALOG[opt.key as Exclude<CrmKey, 'none'>]?.whats_included : undefined
                  return (
                    <div
                      key={opt.key}
                      style={{
                        border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--line, #e6e1d8)'),
                        background: active ? '#fff5f3' : '#fff',
                        borderRadius: 9,
                        overflow: 'hidden',
                        transition: 'border-color 120ms ease, background 120ms ease',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setCrm(opt.key)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          cursor: 'pointer',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: 0,
                          padding: '0.65rem 0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{opt.label}</span>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {opt.key === 'none' ? (
                            <strong style={{ color: 'var(--ink)' }}>free</strong>
                          ) : (
                            <>
                              <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                                {formatPriceCents(perRep)}
                                <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--muted)' }}>/rep</span>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 1 }}>
                                = {formatPriceCents(total)}/mo for {reps} rep{reps !== 1 ? 's' : ''}
                              </div>
                            </>
                          )}
                        </div>
                      </button>
                      {included && included.length > 0 && (
                        <details style={{ borderTop: '1px solid var(--line, #e6e1d8)' }}>
                          <summary style={{
                            cursor: 'pointer',
                            padding: '0.42rem 1rem',
                            fontSize: '0.71rem',
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--ink)',
                            listStyle: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            userSelect: 'none',
                          }}>
                            <span aria-hidden style={{ display: 'inline-block', fontSize: '0.55rem', color: 'var(--red)' }}>▶</span>
                            What&rsquo;s included
                          </summary>
                          <ul style={{
                            margin: 0,
                            padding: '0.35rem 1rem 0.9rem 1rem',
                            listStyle: 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.32rem',
                          }}>
                            {included.map((item, i) => (
                              <li key={i} style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5, display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                                <span aria-hidden style={{ color: 'var(--red)', flexShrink: 0, fontSize: '0.65rem', lineHeight: 1.5 }}>✓</span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            </Group>

            {/* Per-rep add-ons */}
            <Group title="Per-rep add-ons · scales with headcount">
              <p className="meta" style={{ margin: 0, marginBottom: 8 }}>
                These require backend wiring per rep — more headcount means more data routing and support overhead.
                Enterprise rate is cheaper per rep than our individual flat price at volume.
              </p>
              <div
                style={{
                  border: '1.5px solid ' + (wavvSelected ? 'var(--red)' : 'var(--line, #e6e1d8)'),
                  background: wavvSelected ? '#fff5f3' : '#fff',
                  borderRadius: 9,
                  overflow: 'hidden',
                  transition: 'border-color 120ms ease, background 120ms ease',
                }}
              >
                <button
                  type="button"
                  onClick={() => setWavvSelected((v) => !v)}
                  aria-pressed={wavvSelected}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    padding: '0.7rem 0.85rem',
                    display: 'grid',
                    gridTemplateColumns: '22px 1fr auto',
                    gap: '0.7rem',
                    alignItems: 'start',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      border: '1.5px solid ' + (wavvSelected ? 'var(--red)' : 'var(--ink)'),
                      background: wavvSelected ? 'var(--red)' : 'transparent',
                      marginTop: 2,
                      flexShrink: 0,
                      display: 'block',
                    }}
                  />
                  <div>
                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>WAVV dialer KPI ingest</span>
                    <div style={{ fontSize: '0.83rem', color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>
                      Already on WAVV? Live dispositions land on every rep dashboard.
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                      {formatPriceCents(wavvPerRepCents)}
                      <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--muted)' }}>/rep</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 1 }}>
                      = {formatPriceCents(wavvPerRepCents * reps)}/mo
                    </div>
                  </div>
                </button>
                <details style={{ borderTop: '1px solid var(--line, #e6e1d8)' }}>
                  <summary style={{
                    cursor: 'pointer',
                    padding: '0.42rem 1rem',
                    fontSize: '0.71rem',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink)',
                    listStyle: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    userSelect: 'none',
                  }}>
                    <span aria-hidden style={{ display: 'inline-block', fontSize: '0.55rem', color: 'var(--red)' }}>▶</span>
                    What&rsquo;s included
                  </summary>
                  <ul style={{
                    margin: 0,
                    padding: '0.35rem 1rem 0.9rem 1rem',
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.32rem',
                  }}>
                    {ADDON_CATALOG.addon_wavv_kpi.whats_included.map((item, i) => (
                      <li key={i} style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5, display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                        <span aria-hidden style={{ color: 'var(--red)', flexShrink: 0, fontSize: '0.65rem', lineHeight: 1.5 }}>✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </Group>

            {/* Fixed vendor add-ons */}
            <Group title="Account-level add-ons · fixed fee">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {FLAT_ADDONS.map((a) => {
                  const active = a.required || flatSelected.has(a.key)
                  const included = ADDON_CATALOG[a.key]?.whats_included
                  return (
                    <div
                      key={a.key}
                      style={{
                        border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--line, #e6e1d8)'),
                        background: active ? '#fff5f3' : '#fff',
                        borderRadius: 9,
                        overflow: 'hidden',
                        transition: 'border-color 120ms ease, background 120ms ease',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFlat(a.key)}
                        aria-pressed={active}
                        disabled={a.required}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          cursor: a.required ? 'default' : 'pointer',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: 0,
                          padding: '0.7rem 0.85rem',
                          display: 'grid',
                          gridTemplateColumns: '22px 1fr auto',
                          gap: '0.7rem',
                          alignItems: 'start',
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 5,
                            border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--ink)'),
                            background: active ? 'var(--red)' : 'transparent',
                            marginTop: 2,
                            flexShrink: 0,
                            display: 'block',
                          }}
                        />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{a.label}</span>
                            {a.required && (
                              <span style={{
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--red)',
                                color: '#fff',
                              }}>
                                Required
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.83rem', color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>
                            {a.description}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                            {formatPriceCents(a.cents)}
                            <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--muted)' }}>/mo</span>
                          </div>
                        </div>
                      </button>
                      {included && included.length > 0 && (
                        <details style={{ borderTop: '1px solid var(--line, #e6e1d8)' }}>
                          <summary style={{
                            cursor: 'pointer',
                            padding: '0.42rem 1rem',
                            fontSize: '0.71rem',
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--ink)',
                            listStyle: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            userSelect: 'none',
                          }}>
                            <span aria-hidden style={{ display: 'inline-block', fontSize: '0.55rem', color: 'var(--red)' }}>▶</span>
                            What&rsquo;s included
                          </summary>
                          <ul style={{
                            margin: 0,
                            padding: '0.35rem 1rem 0.9rem 1rem',
                            listStyle: 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.32rem',
                          }}>
                            {included.map((item, i) => (
                              <li key={i} style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5, display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                                <span aria-hidden style={{ color: 'var(--red)', flexShrink: 0, fontSize: '0.65rem', lineHeight: 1.5 }}>✓</span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            </Group>
          </div>

          {/* ── Summary rail ───────────────────────────────────── */}
          <aside
            style={{
              padding: '1.05rem 1.1rem',
              borderRadius: 12,
              border: '1.5px solid var(--brand-red, var(--red))',
              background: 'linear-gradient(180deg, #fff 0%, #fff5f3 100%)',
              position: 'sticky',
              top: '1rem',
              alignSelf: 'start',
            }}
          >
            <div
              style={{
                fontSize: '0.7rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'var(--brand-red, var(--red))',
              }}
            >
              Org monthly
            </div>
            <div
              style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.25rem' }}
            >
              <span
                style={{
                  fontSize: '2.4rem',
                  fontWeight: 800,
                  color: 'var(--ink)',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
              >
                {formatPriceCents(monthlyCents)}
              </span>
              <span style={{ color: 'var(--muted)' }}>/ mo</span>
            </div>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
              {formatPriceCents(perSeatBlendedCents)} / seat blended · {reps}{' '}
              {reps === 1 ? 'seat' : 'seats'}
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: 'var(--muted)' }}>
              + custom one-time build fee, quoted on the call
            </p>

            <ul
              style={{ listStyle: 'none', padding: 0, margin: '0.85rem 0 0', fontSize: '0.85rem' }}
            >
              {lineItems.map((li, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    padding: '0.5rem 0',
                    borderBottom: '1px dashed var(--line, #e6e1d8)',
                    color: 'var(--ink)',
                    gap: 8,
                  }}
                >
                  <span style={{ flex: 1, paddingRight: 8 }}>
                    {li.label}
                    {li.sub && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: '0.72rem',
                          color: 'var(--muted)',
                          marginTop: 2,
                        }}
                      >
                        {li.sub}
                      </span>
                    )}
                  </span>
                  <strong>{formatPriceCents(li.cents)}</strong>
                </li>
              ))}
            </ul>

            {(dialerOverPool || roleplayOverPool || reps >= 50) && (
              <div
                style={{
                  marginTop: '0.7rem',
                  padding: '0.55rem 0.7rem',
                  background: '#fff5f3',
                  border: '1px solid var(--red)',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  color: 'var(--ink)',
                }}
              >
                Volume past our published tiers — let&apos;s tighten this on a call. Estimate
                shown is a fair starting point.
              </div>
            )}

            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
              }}
            >
              <Link
                className="btn approve"
                href={bookHref}
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                Book a call with this quote
              </Link>
              <Link
                href="/demo/enterprise"
                style={{
                  cursor: 'pointer',
                  background: 'var(--paper, #fff)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--ink)',
                  borderRadius: 8,
                  padding: '0.55rem 0.8rem',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  letterSpacing: '0.04em',
                  textAlign: 'center',
                  textDecoration: 'none',
                }}
              >
                See the dashboard preview
              </Link>
            </div>

            <p style={{ margin: '0.85rem 0 0', fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.45 }}>
              Minute pools reset on the 1st of each month. Hit a pool mid-month and we pause
              that pool only (everything else keeps running) and email you to top up.
            </p>
          </aside>
        </div>

        <style jsx>{`
          .ent-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
            gap: 1.2rem;
            margin-top: 1rem;
            align-items: start;
          }
          @media (max-width: 760px) {
            .ent-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </section>

      <footer
        style={{
          color: 'var(--muted-inv)',
          textAlign: 'center',
          marginTop: '1.2rem',
          fontSize: '0.85rem',
        }}
      >
        © Virtual Closer · An AI assistant that pays for itself.
        {' · '}
        <Link href="/privacy" style={{ color: 'inherit' }}>
          Privacy
        </Link>
        {' · '}
        <Link href="/terms" style={{ color: 'inherit' }}>
          Terms
        </Link>
      </footer>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function Group({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      style={{
        border: '1.5px solid var(--ink)',
        borderRadius: 10,
        padding: '0.95rem 1rem',
        background: '#fff',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          margin: '0 0 0.55rem',
          fontSize: '0.74rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          fontWeight: 700,
          borderBottom: '1px solid var(--ink)',
          paddingBottom: '0.35rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span>{title}</span>
        <span aria-hidden style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '0.5rem' }}>
        {children}
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
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
  hint?: string
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: '0.82rem',
          color: 'var(--ink)',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ color: 'var(--red)', fontWeight: 700 }}>{value.toLocaleString()}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--red, #ff2800)', margin: 0 }}
      />
      {hint && (
        <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>{hint}</p>
      )}
    </div>
  )
}

function BulkTierGuide({
  reps,
  onPick,
}: {
  reps: number
  onPick: (n: number) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
        gap: 6,
        marginTop: 8,
      }}
    >
      {BASE_PER_SEAT_TIERS.map((t) => {
        const active = reps >= t.min && reps <= t.max
        // Click snaps reps to the bottom of that tier so price reflects the
        // bucket immediately. If they're already in the tier, jump them to
        // the bottom anyway — that's the cheapest option for that bucket and
        // is the most useful "what does N reps cost" answer.
        const target = t.min
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onPick(target)}
            style={{
              padding: '0.55rem 0.45rem',
              borderRadius: 8,
              border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--line, #e6e1d8)'),
              background: active ? 'rgba(255,40,0,0.06)' : '#fff',
              textAlign: 'center',
              fontSize: '0.7rem',
              color: active ? 'var(--red)' : 'var(--muted)',
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 120ms ease, border-color 120ms ease',
            }}
            title={`Click to set ${target} rep${target === 1 ? '' : 's'}`}
          >
            <div style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.label}
            </div>
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--ink)',
                fontWeight: 700,
                marginTop: 2,
              }}
            >
              {formatPriceCents(t.cents)}
              <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '0.7rem' }}>
                {' '}/rep/mo
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function TierBadge({
  label,
  detail,
  cents,
}: {
  label: string
  detail: string
  cents: number
}) {
  // Retained for any future per-tier badge needs; not used in current layout
  // (we moved to direct minute-pool sliders).
  return (
    <div
      style={{
        marginTop: 4,
        padding: '0.55rem 0.7rem',
        borderRadius: 8,
        background: '#fff5f3',
        border: '1px solid var(--red)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <strong style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>{label}</strong>
        <strong style={{ color: 'var(--ink)' }}>
          {cents > 0 ? `${formatPriceCents(cents)}/mo` : 'free'}
        </strong>
      </div>
      <p style={{ margin: '3px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>{detail}</p>
    </div>
  )
}
