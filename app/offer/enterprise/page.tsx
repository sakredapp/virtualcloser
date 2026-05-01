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
  ROLEPLAY_CENTS_PER_MIN,
  roleplayMonthlyCents,
} from '@/lib/minutePricing'
import { pricePerHourForReps } from '@/app/offer/AiSdrPricingCalculator'
import TryVoiceButton from '@/app/demo/TryVoiceButton'
import { renderAgreementHtml } from '@/lib/liabilityAgreementCopy'

const ENT_AGREEMENT_HTML = renderAgreementHtml({ workspaceLabel: 'Live demo from /offer/enterprise' })

// Org-wide pool ceilings (used for the slider max + the "past our standard
// pool" banner). Above these we still let them slide — it just suggests we
// scope it on the call instead of pure auto-pricing.
const ROLEPLAY_POOL_MAX_MIN = 10000
const ROLEPLAY_POOL_STEP_MIN = 60

// AI SDR hour package — replaces the old per-minute dialer pool. Sold like
// hiring a human SDR: $/hr (volume tier from rep count) × hrs/wk × ~4.3
// weeks/month × # of SDRs (one per rep). Range 10-80 hrs/wk so a buyer can
// scope from "part-time SDR" to "two-shift SDR who never sleeps".
const SDR_HOURS_MIN = 10
const SDR_HOURS_MAX = 80
const SDR_HOURS_STEP = 1
const WEEKS_PER_MONTH = 4.3

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
  // AI SDR hours-per-week pool. Replaces the old minute-pool model — we now
  // bill the dialer like an actual SDR's working hours.
  const [dialerHoursPerWeek, setDialerHoursPerWeek] = useState(40)
  // AI Trainer — same hours-per-week / volume-tier model as SDR, separate
  // seat count since trainer adoption ≠ rep count.
  const [trainerSeats, setTrainerSeats] = useState(5)
  const [trainerHoursPerWeek, setTrainerHoursPerWeek] = useState(10)
  // Cart membership for the two hero products — start NOT included so the
  // prospect explicitly opts in before the SDR / Trainer monthly is added
  // to the org rollup.
  const [sdrIncluded, setSdrIncluded] = useState(false)
  const [trainerIncluded, setTrainerIncluded] = useState(false)
  // Legacy roleplay minute pool — kept at 0 default. The pool slider UI is
  // gone; the Trainer card replaces it. Variable retained so cart math
  // doesn't break for any stale ?roleplay_min= shared links.
  const [roleplayPoolMin] = useState(0)
  const [crm, setCrm] = useState<CrmKey>('addon_ghl_crm')
  const [wavvSelected, setWavvSelected] = useState(false)
  const [flatSelected, setFlatSelected] = useState<Set<AddonKey>>(
    new Set<AddonKey>(['addon_team_leaderboard']),
  )

  // Derived: AI SDR — hours/wk × $/hr × weeks/mo × # of reps
  const dialerPricePerHour = useMemo(() => pricePerHourForReps(reps), [reps])
  const dialerHoursPerMonth = useMemo(
    () => Math.round(dialerHoursPerWeek * WEEKS_PER_MONTH * 10) / 10,
    [dialerHoursPerWeek],
  )
  const dialerPerAgentMonthlyCents = useMemo(
    () => Math.round(dialerHoursPerMonth * dialerPricePerHour * 100),
    [dialerHoursPerMonth, dialerPricePerHour],
  )
  const dialerCentsRaw = dialerPerAgentMonthlyCents * reps
  const dialerCents = sdrIncluded ? dialerCentsRaw : 0

  // Derived: AI Trainer — same model as SDR but tier driven by trainerSeats
  const trainerPricePerHour = useMemo(() => pricePerHourForReps(trainerSeats), [trainerSeats])
  const trainerHoursPerMonth = useMemo(
    () => Math.round(trainerHoursPerWeek * WEEKS_PER_MONTH * 10) / 10,
    [trainerHoursPerWeek],
  )
  const trainerPerSeatMonthlyCents = useMemo(
    () => Math.round(trainerHoursPerMonth * trainerPricePerHour * 100),
    [trainerHoursPerMonth, trainerPricePerHour],
  )
  const trainerCentsRaw = trainerPerSeatMonthlyCents * trainerSeats
  const trainerCents = trainerIncluded ? trainerCentsRaw : 0

  // Derived: org-wide roleplay (linear)
  const roleplayCents = useMemo(
    () => roleplayMonthlyCents(roleplayPoolMin),
    [roleplayPoolMin],
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
    dialerCents + trainerCents + roleplayCents + flatTotalCents + crmCents + wavvCents
  const perSeatBlendedCents = reps > 0 ? Math.round(monthlyCents / reps) : 0

  // Build line items for summary
  const lineItems: { label: string; cents: number; sub?: string }[] = []
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
      label: `AI SDR · ${dialerHoursPerWeek} hrs/wk × ${reps} ${reps === 1 ? 'SDR' : 'SDRs'}`,
      cents: dialerCents,
      sub: `${formatPriceCents(dialerPerAgentMonthlyCents)}/SDR/mo at $${dialerPricePerHour.toFixed(2)}/hr volume tier`,
    })
  }
  if (trainerCents > 0) {
    lineItems.push({
      label: `AI Trainer · ${trainerHoursPerWeek} hrs/wk × ${trainerSeats} ${trainerSeats === 1 ? 'seat' : 'seats'}`,
      cents: trainerCents,
      sub: `${formatPriceCents(trainerPerSeatMonthlyCents)}/seat/mo at $${trainerPricePerHour.toFixed(2)}/hr volume tier`,
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
    `AI SDR ${dialerHoursPerWeek} hrs/wk × ${reps} = ${(dialerHoursPerMonth * reps).toFixed(0)} hrs/mo at $${dialerPricePerHour.toFixed(2)}/hr · ` +
    `Roleplay pool ${roleplayPoolMin} min/mo. ` +
    `Monthly: ${formatPriceCents(monthlyCents)} (${formatPriceCents(perSeatBlendedCents)}/seat blended).`

  const bookHref = bookingHref({
    reps,
    apptsMo: Math.round(dialerHoursPerMonth * reps),
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
          Per-seat base build with bulk pricing. Hire one AI SDR per rep at our
          volume rate, plus an org-wide roleplay minute pool. Slide your numbers,
          see your monthly, book the kickoff.
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
            {/* AI SDR — hero. Sits at the top because this is the main upsell. */}
            <div
              style={{
                border: sdrIncluded ? '2px solid #16a34a' : '2px dashed #cbd5e1',
                borderRadius: 14,
                padding: '1.2rem 1.3rem',
                background: sdrIncluded
                  ? 'linear-gradient(120deg, #fff 0%, #f0fdf4 100%)'
                  : 'linear-gradient(120deg, #fff 0%, #fffaf5 100%)',
                boxShadow: sdrIncluded
                  ? '0 0 0 4px rgba(22,163,74,0.10), 0 8px 28px rgba(22,163,74,0.10)'
                  : '0 8px 30px rgba(255,40,0,0.10)',
                transition: 'border-color 160ms ease, box-shadow 160ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 16, minHeight: 96 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.14em',
                      color: 'var(--red)',
                      margin: 0,
                    }}
                  >
                    Hire AI SDRs for your team
                  </p>
                  <h2 style={{ margin: '4px 0 6px', fontSize: 22, color: 'var(--ink)' }}>
                    Hire {reps} {reps === 1 ? 'SDR' : 'SDRs'} for {dialerHoursPerWeek} hrs/wk
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                    No sick days. No complaining. No bonuses. Just hard workers — your
                    AI SDRs clock in for the hours you set, dial your leads, and book
                    the meetings.
                  </p>
                </div>
                <div style={{ flexShrink: 0, alignSelf: 'center' }}>
                  <TryVoiceButton
                    tier="enterprise"
                    product="sdr"
                    variant="circular"
                    agreementHtml={ENT_AGREEMENT_HTML}
                  />
                </div>
              </div>

              <SliderRow
                label="How many SDRs (one per rep)"
                value={reps}
                min={1}
                max={250}
                step={1}
                onChange={setReps}
                hint={`${reps} ${reps === 1 ? 'SDR' : 'SDRs'} · $${dialerPricePerHour.toFixed(2)}/hr volume tier${reps >= 100 ? ' (100+ pricing)' : reps >= 6 ? ' (base $6/hr)' : ''}`}
              />
              <SliderRow
                label="Hours per week (per SDR)"
                value={dialerHoursPerWeek}
                min={SDR_HOURS_MIN}
                max={SDR_HOURS_MAX}
                step={SDR_HOURS_STEP}
                onChange={setDialerHoursPerWeek}
                hint={`${dialerHoursPerWeek} hrs/wk × ${dialerHoursPerMonth} hrs/mo each`}
              />

              <div
                style={{
                  marginTop: 14,
                  padding: '14px 18px',
                  background: 'linear-gradient(135deg, #2a2a2a 0%, #161616 100%)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ff2800' }}>
                    SDR monthly · all {reps} {reps === 1 ? 'SDR' : 'SDRs'}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                    {formatPriceCents(dialerCentsRaw)}<span style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}> /mo</span>
                  </p>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.78)' }}>
                  <strong style={{ color: '#ff2800' }}>${dialerPricePerHour.toFixed(2)}/hr</strong> × {dialerHoursPerMonth} hrs/mo<br />
                  <strong style={{ color: '#ff2800' }}>{formatPriceCents(dialerPerAgentMonthlyCents)}/SDR/mo</strong> × {reps}
                </p>
              </div>
              {reps >= 6 && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: '#16a34a', fontWeight: 700 }}>
                  ✓ Volume discount applied — saving{' '}
                  {formatPriceCents((6 - dialerPricePerHour) * 100 * dialerHoursPerMonth * reps)}/mo vs. starter pricing.
                </p>
              )}
              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                Each SDR splits weekly hours across the four dialer modes
                (Receptionist, Appointment Setter, Live Transfer, Workflows)
                via the in-dashboard shift scheduler. One active call per
                tenant at a time.
              </p>
              <CartToggleBtn
                inCart={sdrIncluded}
                onToggle={() => setSdrIncluded((v) => !v)}
                cents={dialerCentsRaw}
              />
            </div>

            {/* AI Trainer hero — placed directly under the SDR hero (used to
                sit below the base build, but base build was removed since the
                SDR pricing already covers what enterprise orgs pay for). */}
            <div
              style={{
                border: trainerIncluded ? '2px solid #16a34a' : '2px dashed #cbd5e1',
                borderRadius: 14,
                padding: '1.2rem 1.3rem',
                background: trainerIncluded
                  ? 'linear-gradient(120deg, #fff 0%, #f0fdf4 100%)'
                  : 'linear-gradient(120deg, #fff 0%, #fffaf5 100%)',
                boxShadow: trainerIncluded
                  ? '0 0 0 4px rgba(22,163,74,0.10), 0 8px 28px rgba(22,163,74,0.10)'
                  : '0 8px 30px rgba(255,40,0,0.10)',
                transition: 'border-color 160ms ease, box-shadow 160ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 16, minHeight: 96 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.14em',
                      color: 'var(--red)',
                      margin: 0,
                    }}
                  >
                    Hire AI Trainers for your team
                  </p>
                  <h2 style={{ margin: '4px 0 6px', fontSize: 22, color: 'var(--ink)' }}>
                    Hire {trainerSeats} {trainerSeats === 1 ? 'Trainer' : 'Trainers'} for {trainerHoursPerWeek} hrs/wk
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                    Always-on roleplay coach. Throws objections, runs full
                    discovery scripts, gives feedback after every call. Reps drill
                    between dials so they don&apos;t lose reps.
                  </p>
                </div>
                <div style={{ flexShrink: 0, alignSelf: 'center' }}>
                  <TryVoiceButton
                    tier="enterprise"
                    product="trainer"
                    variant="circular"
                    agreementHtml={ENT_AGREEMENT_HTML}
                  />
                </div>
              </div>

              <SliderRow
                label="How many Trainer seats"
                value={trainerSeats}
                min={1}
                max={250}
                step={1}
                onChange={setTrainerSeats}
                hint={`${trainerSeats} ${trainerSeats === 1 ? 'seat' : 'seats'} · $${trainerPricePerHour.toFixed(2)}/hr volume tier${trainerSeats >= 100 ? ' (100+ pricing)' : trainerSeats >= 6 ? ' (base $6/hr)' : ''}`}
              />
              <SliderRow
                label="Hours per week (per Trainer seat)"
                value={trainerHoursPerWeek}
                min={5}
                max={30}
                step={1}
                onChange={setTrainerHoursPerWeek}
                hint={`${trainerHoursPerWeek} hrs/wk × ${trainerHoursPerMonth} hrs/mo each`}
              />

              <div
                style={{
                  marginTop: 14,
                  padding: '14px 18px',
                  background: 'linear-gradient(135deg, #2a2a2a 0%, #161616 100%)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ff2800' }}>
                    Trainer monthly · all {trainerSeats} {trainerSeats === 1 ? 'seat' : 'seats'}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                    {formatPriceCents(trainerCentsRaw)}<span style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}> /mo</span>
                  </p>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.78)' }}>
                  <strong style={{ color: '#ff2800' }}>${trainerPricePerHour.toFixed(2)}/hr</strong> × {trainerHoursPerMonth} hrs/mo<br />
                  <strong style={{ color: '#ff2800' }}>{formatPriceCents(trainerPerSeatMonthlyCents)}/seat/mo</strong> × {trainerSeats}
                </p>
              </div>
              {trainerSeats >= 6 && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: '#16a34a', fontWeight: 700 }}>
                  ✓ Volume discount applied — saving{' '}
                  {formatPriceCents((6 - trainerPricePerHour) * 100 * trainerHoursPerMonth * trainerSeats)}/mo vs. starter pricing.
                </p>
              )}
              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                Each Trainer hour can be a discovery roleplay, an objection
                drill, or a quick warm-up. Reps schedule sessions in the
                dashboard or just hit the mic and go.
              </p>
              <CartToggleBtn
                inCart={trainerIncluded}
                onToggle={() => setTrainerIncluded((v) => !v)}
                cents={trainerCentsRaw}
              />
            </div>

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
                        background: active ? '#fff5f3' : 'var(--paper, #fff)',
                        borderRadius: 10,
                        overflow: 'hidden',
                        boxShadow: active ? '0 2px 8px rgba(255,40,0,0.12)' : 'none',
                        transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
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
                          padding: '0.95rem 1rem',
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
                        <details style={{ borderTop: '1px solid var(--border-soft)' }}>
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
                            <svg aria-hidden className="whats-included-arrow" width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, transition: 'transform 160ms ease' }}><path d="M3 1.5 L3 8.5 L8 5 Z" fill="#ff2800" /></svg>
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
                  background: wavvSelected ? '#fff5f3' : 'var(--paper, #fff)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  boxShadow: wavvSelected ? '0 2px 8px rgba(255,40,0,0.12)' : 'none',
                  transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
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
                    padding: '0.95rem 1rem',
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
                <details style={{ borderTop: '1px solid var(--border-soft)' }}>
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
                    <svg aria-hidden className="whats-included-arrow" width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, transition: 'transform 160ms ease' }}><path d="M3 1.5 L3 8.5 L8 5 Z" fill="#ff2800" /></svg>
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
                        background: active ? '#fff5f3' : 'var(--paper, #fff)',
                        borderRadius: 10,
                        overflow: 'hidden',
                        boxShadow: active ? '0 2px 8px rgba(255,40,0,0.12)' : 'none',
                        transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
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
                          padding: '0.95rem 1rem',
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
                        <details style={{ borderTop: '1px solid var(--border-soft)' }}>
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
                            <svg aria-hidden className="whats-included-arrow" width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, transition: 'transform 160ms ease' }}><path d="M3 1.5 L3 8.5 L8 5 Z" fill="#ff2800" /></svg>
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

            {(roleplayOverPool || reps >= 50) && (
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
            gap: 4rem; /* 64px PRD gutter */
            margin-top: 2rem;
            align-items: start;
          }
          @media (max-width: 1080px) {
            .ent-grid { gap: 2.5rem; }
          }
          @media (max-width: 760px) {
            .ent-grid {
              grid-template-columns: 1fr;
              gap: 1.5rem;
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

      {/* Mobile sticky cart bar — shown below 860px (CSS in globals).
          The desktop sticky aside in the .ent-grid is hidden at the
          same breakpoint so we don't double-render the total. */}
      <div className="mobile-cart-bar" role="region" aria-label="Cart summary">
        <div className="mcb-total">
          <span className="mcb-label">Org monthly</span>
          <span className="mcb-amount">
            {formatPriceCents(monthlyCents)}
            <span className="mcb-amount-mo">/mo</span>
          </span>
        </div>
        <Link href={bookHref} className="mcb-btn">Book a call</Link>
      </div>
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
        border: '1px solid var(--border-soft)',
        borderRadius: 10,
        padding: '0.75rem 0.95rem',
        background: 'var(--paper, #fff)',
        marginBottom: '0.7rem',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          margin: 0,
          fontSize: '0.74rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          fontWeight: 700,
          paddingBottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span>{title}</span>
        <span aria-hidden style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '0.7rem', paddingTop: '0.7rem', borderTop: '1px solid var(--border-soft)' }}>
        {children}
      </div>
    </details>
  )
}

function CartToggleBtn({
  inCart,
  onToggle,
  cents,
}: {
  inCart: boolean
  onToggle: () => void
  cents: number
}) {
  const base: React.CSSProperties = {
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
  const out: React.CSSProperties = {
    ...base,
    background: '#ff2800',
    color: '#fff',
    border: '2px solid #ff2800',
    boxShadow: '0 6px 18px rgba(255,40,0,0.30)',
  }
  const on: React.CSSProperties = {
    ...base,
    background: '#fff',
    color: '#15803d',
    border: '2px solid #16a34a',
    boxShadow: '0 2px 6px rgba(22,163,74,0.18)',
  }
  return (
    <button type="button" onClick={onToggle} style={inCart ? on : out} aria-pressed={inCart}>
      {inCart
        ? `✓ In cart · ${formatPriceCents(cents)}/mo · Remove`
        : `＋ Add to cart · ${formatPriceCents(cents)}/mo`}
    </button>
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

