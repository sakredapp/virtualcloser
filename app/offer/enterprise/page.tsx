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

// ── Dialer (AI Concierge) tiers, org-wide minutes pool ───────────────────
// Source of truth: ADDON_CATALOG.addon_dialer_lite/pro for retail prices.
// Lite: 100 confirmed appts / mo · Pro: 300 confirmed appts / mo.
// We assume ~3 min average per confirmed-appt call (confirms + reschedule legs).
const DIALER_LITE = ADDON_CATALOG.addon_dialer_lite
const DIALER_PRO = ADDON_CATALOG.addon_dialer_pro
const DIALER_OVERAGE_CENTS_PER_APPT = 30 // ~$0.30 per appt over Pro cap

function dialerPrice(estAppts: number): {
  cents: number
  tier: 'lite' | 'pro' | 'custom'
  label: string
  detail: string
} {
  if (estAppts <= 0) return { cents: 0, tier: 'lite', label: 'Off', detail: 'No dialer pool selected' }
  if (estAppts <= (DIALER_LITE.cap_value ?? 100)) {
    return {
      cents: DIALER_LITE.monthly_price_cents,
      tier: 'lite',
      label: 'AI Concierge · Lite',
      detail: `Up to ${DIALER_LITE.cap_value} confirmed appts / mo, pooled across the org`,
    }
  }
  if (estAppts <= (DIALER_PRO.cap_value ?? 300)) {
    return {
      cents: DIALER_PRO.monthly_price_cents,
      tier: 'pro',
      label: 'AI Concierge · Pro',
      detail: `Up to ${DIALER_PRO.cap_value} confirmed appts / mo, pooled across the org`,
    }
  }
  const over = estAppts - (DIALER_PRO.cap_value ?? 300)
  return {
    cents: DIALER_PRO.monthly_price_cents + over * DIALER_OVERAGE_CENTS_PER_APPT,
    tier: 'custom',
    label: 'AI Concierge · Custom',
    detail: `Pro pool + ~$${(DIALER_OVERAGE_CENTS_PER_APPT / 100).toFixed(2)} / appt over ${DIALER_PRO.cap_value}. Quoted on the call.`,
  }
}

// ── Roleplay tiers, org-wide minutes pool ────────────────────────────────
const ROLEPLAY_LITE = ADDON_CATALOG.addon_roleplay_lite
const ROLEPLAY_PRO = ADDON_CATALOG.addon_roleplay_pro
const ROLEPLAY_OVERAGE_CENTS_PER_MIN = 25 // ~$0.25 per minute over Pro cap

function roleplayPrice(estMin: number): {
  cents: number
  tier: 'lite' | 'pro' | 'custom' | 'off'
  label: string
  detail: string
} {
  if (estMin <= 0) return { cents: 0, tier: 'off', label: 'Off', detail: 'No roleplay pool selected' }
  if (estMin <= (ROLEPLAY_LITE.cap_value ?? 300)) {
    return {
      cents: ROLEPLAY_LITE.monthly_price_cents,
      tier: 'lite',
      label: 'Roleplay · Lite',
      detail: `Up to ${ROLEPLAY_LITE.cap_value} min / mo, pooled across the org`,
    }
  }
  if (estMin <= (ROLEPLAY_PRO.cap_value ?? 1000)) {
    return {
      cents: ROLEPLAY_PRO.monthly_price_cents,
      tier: 'pro',
      label: 'Roleplay · Pro',
      detail: `Up to ${ROLEPLAY_PRO.cap_value} min / mo, pooled across the org`,
    }
  }
  const over = estMin - (ROLEPLAY_PRO.cap_value ?? 1000)
  return {
    cents: ROLEPLAY_PRO.monthly_price_cents + over * ROLEPLAY_OVERAGE_CENTS_PER_MIN,
    tier: 'custom',
    label: 'Roleplay · Custom',
    detail: `Pro pool + ~$${(ROLEPLAY_OVERAGE_CENTS_PER_MIN / 100).toFixed(2)} / min over ${ROLEPLAY_PRO.cap_value}. Quoted on the call.`,
  }
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
    key: 'addon_wavv_kpi',
    label: 'WAVV dialer KPI ingest',
    description: 'Already on WAVV? Live dispositions land on every rep dashboard.',
    cents: ADDON_CATALOG.addon_wavv_kpi.monthly_price_cents,
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
  { key: 'none', label: 'No CRM build', cents: 0 },
  { key: 'addon_ghl_crm', label: 'GoHighLevel', cents: ADDON_CATALOG.addon_ghl_crm.monthly_price_cents },
  { key: 'addon_hubspot_crm', label: 'HubSpot', cents: ADDON_CATALOG.addon_hubspot_crm.monthly_price_cents },
  { key: 'addon_pipedrive_crm', label: 'Pipedrive', cents: ADDON_CATALOG.addon_pipedrive_crm.monthly_price_cents },
  { key: 'addon_salesforce_crm', label: 'Salesforce', cents: ADDON_CATALOG.addon_salesforce_crm.monthly_price_cents },
]

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
  const [apptsPerRepPerMo, setApptsPerRepPerMo] = useState(20)
  const [repsDoingRoleplay, setRepsDoingRoleplay] = useState(5)
  const [sessionsPerWeek, setSessionsPerWeek] = useState(2)
  const [minsPerSession, setMinsPerSession] = useState(15)

  const [crm, setCrm] = useState<CrmKey>('addon_ghl_crm')
  const [flatSelected, setFlatSelected] = useState<Set<AddonKey>>(
    new Set<AddonKey>(['addon_team_leaderboard']),
  )

  // Derived: per-seat base
  const seat = useMemo(() => perSeatCents(reps), [reps])
  const baseTotalCents = seat.cents * reps

  // Derived: org-wide dialer
  const totalApptsMo = reps * apptsPerRepPerMo
  const dialer = useMemo(() => dialerPrice(totalApptsMo), [totalApptsMo])

  // Derived: org-wide roleplay
  // 4.33 weeks per month average
  const totalRpMin = Math.round(repsDoingRoleplay * sessionsPerWeek * minsPerSession * 4.33)
  const roleplay = useMemo(() => roleplayPrice(totalRpMin), [totalRpMin])

  // Derived: flat add-ons
  const flatTotalCents = useMemo(() => {
    let sum = 0
    for (const a of FLAT_ADDONS) {
      if (a.required || flatSelected.has(a.key)) sum += a.cents
    }
    return sum
  }, [flatSelected])

  // Derived: CRM
  const crmCents = CRM_OPTIONS.find((c) => c.key === crm)?.cents ?? 0

  const monthlyCents = baseTotalCents + dialer.cents + roleplay.cents + flatTotalCents + crmCents
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
    })
  }
  if (dialer.cents > 0) {
    lineItems.push({
      label: dialer.label,
      cents: dialer.cents,
      sub: `~${totalApptsMo} appts / mo across org`,
    })
  }
  if (roleplay.cents > 0) {
    lineItems.push({
      label: roleplay.label,
      cents: roleplay.cents,
      sub: `~${totalRpMin} min / mo across ${repsDoingRoleplay} ${repsDoingRoleplay === 1 ? 'rep' : 'reps'}`,
    })
  }
  for (const a of FLAT_ADDONS) {
    if (a.required || flatSelected.has(a.key)) {
      lineItems.push({ label: a.label, cents: a.cents })
    }
  }

  const bookNotes =
    `Enterprise build · ${reps} reps · ~${totalApptsMo} appts/mo · ~${totalRpMin} roleplay min/mo. ` +
    `Monthly: ${formatPriceCents(monthlyCents)} (${formatPriceCents(perSeatBlendedCents)}/seat blended).`

  const bookHref = bookingHref({
    reps,
    apptsMo: totalApptsMo,
    rpMin: totalRpMin,
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
              <BulkTierGuide reps={reps} />
            </Group>

            {/* Dialer estimator */}
            <Group title="AI Concierge dialer · org-wide pool">
              <p className="meta" style={{ margin: 0, marginBottom: 8 }}>
                Estimated by rep count × confirmed appts per rep per month. Tier auto-selects.
              </p>
              <SliderRow
                label="Confirmed appts per rep / month"
                value={apptsPerRepPerMo}
                min={0}
                max={120}
                step={5}
                onChange={setApptsPerRepPerMo}
                hint={`Total: ~${totalApptsMo} appts / mo across the org`}
              />
              <TierBadge label={dialer.label} detail={dialer.detail} cents={dialer.cents} />
            </Group>

            {/* Roleplay estimator */}
            <Group title="Roleplay · org-wide minutes pool">
              <p className="meta" style={{ margin: 0, marginBottom: 8 }}>
                Estimated by reps practicing × sessions per week × minutes per session.
                Pool is shared across the org.
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
                hint={`Total: ~${totalRpMin} min / mo across the org`}
              />
              <TierBadge
                label={roleplay.label}
                detail={roleplay.detail}
                cents={roleplay.cents}
              />
            </Group>

            {/* CRM picker */}
            <Group title="CRM build (pick one)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {CRM_OPTIONS.map((opt) => {
                  const active = crm === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setCrm(opt.key)}
                      style={{
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--line, #e6e1d8)'),
                        background: active ? '#fff5f3' : '#fff',
                        borderRadius: 9,
                        padding: '0.65rem 0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{opt.label}</span>
                      <strong style={{ color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                        {opt.cents > 0 ? `${formatPriceCents(opt.cents)}/mo` : 'free'}
                      </strong>
                    </button>
                  )
                })}
              </div>
            </Group>

            {/* Flat add-ons */}
            <Group title="Account-level add-ons">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {FLAT_ADDONS.map((a) => {
                  const active = a.required || flatSelected.has(a.key)
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggleFlat(a.key)}
                      aria-pressed={active}
                      disabled={a.required}
                      style={{
                        textAlign: 'left',
                        cursor: a.required ? 'default' : 'pointer',
                        border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--line, #e6e1d8)'),
                        background: active ? '#fff5f3' : '#fff',
                        borderRadius: 9,
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
                        }}
                      />
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{a.label}</span>
                          {a.required && (
                            <span
                              style={{
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--red)',
                                color: '#fff',
                              }}
                            >
                              Required
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '0.83rem',
                            color: 'var(--muted)',
                            marginTop: 3,
                            lineHeight: 1.45,
                          }}
                        >
                          {a.description}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                          {formatPriceCents(a.cents)}
                          <span
                            style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--muted)' }}
                          >
                            /mo
                          </span>
                        </div>
                      </div>
                    </button>
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

            {(dialer.tier === 'custom' || roleplay.tier === 'custom' || reps >= 50) && (
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

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details className="collapse" open>
          <summary>How Enterprise differs from Individual</summary>
          <ul className="list" style={{ maxHeight: 'none', marginTop: '0.5rem' }}>
            <li className="row">
              <div>
                <p className="name">Per-seat base, bulk-discounted</p>
                <p className="meta">
                  Each rep gets the full Virtual Closer brain. Per-seat pricing drops as the
                  team grows — see the tier guide above.
                </p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">Pooled minutes, not per-seat</p>
                <p className="meta">
                  Dialer minutes and roleplay minutes are org-wide pools. Heavy users don&apos;t
                  get penalized; light users don&apos;t pay for what they don&apos;t use.
                </p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">Role-scoped visibility</p>
                <p className="meta">
                  Reps see themselves. Managers see their team. Owners see everything. Private
                  rooms keep the right conversations in the right circle.
                </p>
              </div>
            </li>
            <li className="row">
              <div>
                <p className="name">One-time build fee, quoted on the call</p>
                <p className="meta">
                  Depends on integration scope, custom playbooks, voice training, white-label
                  setup. Covered in the kickoff.
                </p>
              </div>
            </li>
          </ul>
        </details>
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1.5px solid var(--ink)',
        borderRadius: 10,
        padding: '0.95rem 1rem',
        background: '#fff',
      }}
    >
      <h3
        style={{
          margin: '0 0 0.55rem',
          fontSize: '0.74rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          fontWeight: 700,
          borderBottom: '1px solid var(--ink)',
          paddingBottom: '0.35rem',
        }}
      >
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '0.5rem' }}>
        {children}
      </div>
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

function BulkTierGuide({ reps }: { reps: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
        gap: 4,
        marginTop: 6,
      }}
    >
      {BASE_PER_SEAT_TIERS.map((t) => {
        const active = reps >= t.min && reps <= t.max
        return (
          <div
            key={t.label}
            style={{
              padding: '0.45rem 0.4rem',
              borderRadius: 6,
              border: '1px solid ' + (active ? 'var(--red)' : 'var(--line, #e6e1d8)'),
              background: active ? '#fff5f3' : '#fff',
              textAlign: 'center',
              fontSize: '0.68rem',
              color: active ? 'var(--red)' : 'var(--muted)',
              fontWeight: active ? 700 : 500,
            }}
          >
            <div>{t.label}</div>
            <div style={{ fontSize: '0.78rem', color: active ? 'var(--ink)' : 'var(--ink)' }}>
              {formatPriceCents(t.cents)}
            </div>
          </div>
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
