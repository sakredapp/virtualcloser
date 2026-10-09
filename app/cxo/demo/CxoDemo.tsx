'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import ExecOverview, { type BookInput, type BreakdownMap } from '@/app/components/cxo/ExecOverview'
import ConnectState from '@/app/components/cxo/ConnectState'
import MiraBar from '@/app/components/cxo/MiraBar'
import RailIcon, { type RailIconName } from '@/app/components/cxo/RailIcon'
import RailClock from '@/app/components/cxo/RailClock'
import type { DashboardPrefs } from '@/lib/dashboardPrefs'
import CxoReports from '@/app/dashboard/analytics/CxoReports'
import { IntegrationAccordion } from '@/app/dashboard/integrations/IntegrationAccordion'
import type { BreakdownDim, BreakdownRow, DailyRow, StatusRow } from '@/lib/pinnacle/rollup'

/*
  CXO Suite — public demo of the executive suite.

  The SAME components the signed-in product renders (ExecOverview, CxoReports,
  ConnectState, the calendar grid markup, the meeting cards, the
  Integrations accordions, the rail and the Mira bar) fed invented data
  shaped exactly like the rollup rows (DailyRow / StatusRow / BreakdownRow).
  No auth, no network, nothing persisted. "Today" is pinned so the numbers
  never drift. The book is scaled to roughly $250M submitted year to date.

  Seven pages, the same seven the real left rail shows for an executive seat:
  Overview · Performance · Reports · Calendar · Meetings · Partners ·
  Integrations. Mira is on every page as the same floating bar, canned.
*/

const CXO_LOGO =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png'

const TODAY = '2026-10-08'
/** The rail clock is pinned too: Thursday, October 8 · 9:14am CT. */
const DEMO_NOW = new Date('2026-10-08T14:14:00Z')
const WORKSPACE = 'Pinnacle Life Group'

type View = 'overview' | 'performance' | 'reports' | 'calendar' | 'meetings' | 'partners' | 'integrations'

const NAV: { key: View; label: string; icon: RailIconName }[] = [
  { key: 'overview', label: 'Overview', icon: 'overview' },
  { key: 'performance', label: 'Performance', icon: 'performance' },
  { key: 'reports', label: 'Reports', icon: 'reports' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'meetings', label: 'Meetings', icon: 'meetings' },
  { key: 'partners', label: 'Partners', icon: 'partners' },
  { key: 'integrations', label: 'Integrations', icon: 'integrations' },
]

function viewFromHash(): View {
  if (typeof window === 'undefined') return 'overview'
  const raw = window.location.hash.replace('#', '')
  const h = raw === 'recordings' ? 'meetings' : raw
  return (NAV.find((n) => n.key === h)?.key ?? 'overview') as View
}

// ════════════════════════════════════════════════════════════════════════
//  FAKE DATA — deterministic, shaped like the rollup rows
// ════════════════════════════════════════════════════════════════════════

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LINE_BASE: Record<string, { premium: number; avg: number; growth: number }> = {
  // Monthly submitted premium per line, sized so the master book lands
  // near $250M submitted year to date (the scale of the executive demo).
  Health: { premium: 8_800_000, avg: 2_900, growth: 0.31 },
  Life: { premium: 6_400_000, avg: 4_100, growth: 0.22 },
  Annuity: { premium: 3_900_000, avg: 38_000, growth: 0.48 },
}

const BOOKS_META = [
  { baseId: 'appPINNACLE', label: 'Pinnacle Life Group', isPinnacle: true, scale: 1 },
  { baseId: 'appHARBOR', label: 'Harbor Financial', isPinnacle: false, scale: 0.34 },
  { baseId: 'appSUMMIT', label: 'Summit Benefits', isPinnacle: false, scale: 0.21 },
]

function buildDaily(): { rows: DailyRow[]; status: StatusRow[] } {
  const rand = mulberry32(20261008)
  const rows: DailyRow[] = []
  const status: StatusRow[] = []
  const start = Date.UTC(2024, 9, 1) // 2024-10-01
  const end = Date.UTC(2026, 9, 8) // today
  const span = end - start
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t)
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    const weekend = dow === 0 || dow === 6
    const month = d.getUTCMonth()
    // Seasonality: Q4 enrollment lift, soft January, summer dip.
    const season = 1 + 0.22 * Math.sin(((month - 2) / 12) * Math.PI * 2) + (month >= 9 ? 0.14 : 0)
    const progress = (t - start) / span
    for (const line of Object.keys(LINE_BASE)) {
      const base = LINE_BASE[line]
      const growth = 1 + base.growth * progress
      const noise = 0.55 + rand() * 0.9
      const dayFactor = weekend ? 0.18 : 1
      const monthlyPremium = base.premium * season * growth
      const premium = Math.round((monthlyPremium / 22) * noise * dayFactor)
      const policies = Math.max(weekend ? 0 : 1, Math.round(premium / base.avg + rand() * 1.5))
      const fundedRate = line === 'Annuity' ? 0.62 : 0.74
      const fundedPolicies = Math.round(policies * (fundedRate + (rand() - 0.5) * 0.1))
      for (const b of BOOKS_META) {
        const p = Math.round(premium * b.scale * (b.isPinnacle ? 1 : 0.8 + rand() * 0.4))
        const pol = b.isPinnacle ? policies : Math.max(0, Math.round(policies * b.scale))
        rows.push({
          d: iso,
          base_id: b.baseId,
          line,
          premium: p,
          policies: pol,
          funded_premium: Math.round(p * fundedRate),
          funded_policies: b.isPinnacle ? fundedPolicies : Math.round(pol * fundedRate),
        })
      }
      const declined = Math.round(policies * (0.06 + rand() * 0.04))
      const lapsed = Math.round(policies * (0.03 + rand() * 0.03))
      const paid = Math.min(policies, fundedPolicies)
      status.push({
        d: iso,
        line,
        total: policies,
        paid,
        declined,
        lapsed,
        submitted: Math.max(0, policies - paid - declined - lapsed),
      })
    }
  }
  return { rows, status }
}

const DATA = buildDaily()
const PINNACLE_ROWS = DATA.rows.filter((r) => r.base_id === 'appPINNACLE')
const BOOKS: BookInput[] = BOOKS_META.map((b) => ({
  baseId: b.baseId,
  label: b.label,
  isPinnacle: b.isPinnacle,
  rows: DATA.rows.filter((r) => r.base_id === b.baseId),
}))

function bd(label: string, premium: number, policies: number, place = 0.72): BreakdownRow {
  const paid = Math.round(policies * place)
  return { label, premium, policies, paid, declined: Math.round(policies * 0.07), lapsed: Math.round(policies * 0.04) }
}

const BREAKDOWNS: Required<BreakdownMap> = {
  team: [bd('Southeast', 612_400, 221), bd('Texas', 548_900, 198), bd('Mountain West', 402_300, 141), bd('Northeast', 337_800, 119), bd('Pacific', 288_100, 96)],
  agent: [bd('Dana Whitfield', 214_600, 68, 0.81), bd('Marcus Lee', 198_300, 74, 0.77), bd('Priya Raman', 176_900, 59, 0.8), bd('Tom Alvarez', 151_200, 52, 0.69), bd('Jenna Cole', 139_800, 49, 0.74), bd('Omar Haddad', 121_500, 44, 0.66), bd('Sofia Marin', 108_200, 41, 0.71), bd('Chris Ng', 97_400, 36, 0.63)],
  carrier: [bd('Mutual of Omaha', 486_200, 171), bd('Americo', 391_700, 148), bd('Transamerica', 334_900, 122), bd('Foresters', 268_400, 101), bd('Aetna', 219_300, 88), bd('Athene', 188_600, 23, 0.64)],
  state: [bd('TX', 548_900, 198), bd('FL', 433_200, 160), bd('GA', 301_400, 112), bd('AZ', 244_800, 87), bd('NC', 197_600, 71), bd('OH', 162_300, 59)],
  product: [bd('Final expense', 622_800, 263, 0.78), bd('Mortgage protection', 548_100, 141, 0.7), bd('Indexed universal life', 401_900, 64, 0.66), bd('Fixed indexed annuity', 388_600, 21, 0.62), bd('Term', 228_100, 86, 0.74)],
}

async function loadBreakdownDemo(dim: BreakdownDim, line: string): Promise<BreakdownRow[]> {
  const rows = BREAKDOWNS[dim] ?? []
  const factor = line === 'All' ? 1 : line === 'Health' ? 0.46 : line === 'Life' ? 0.34 : 0.2
  return rows.map((r) => ({
    ...r,
    premium: Math.round(r.premium * factor),
    policies: Math.round(r.policies * factor),
    paid: Math.round(r.paid * factor),
    declined: Math.round(r.declined * factor),
    lapsed: Math.round(r.lapsed * factor),
  }))
}

// Layout prefs as an executive's connected AI might leave them: untouched
// layout, one headline for the week, two notes for the team.
const PREFS: DashboardPrefs = {
  version: 1,
  tiles: ['headline', 'kpis', 'premium_trend', 'product_mix', 'status_funnel', 'breakdowns', 'agency_books', 'meetings', 'notes'],
  default_timeframe: 'ytd',
  pinned_kpis: ['ytd_premium', 'trailing_12m_premium', 'placement_pct', 'policies_issued'],
  pinned_breakdowns: ['agent', 'carrier'],
  hidden_sections: [],
  headline_note: 'Q4 enrollment is on: Texas and Florida carry the extra budget, placement target 74%.',
  notes: [
    { id: 'd1', text: 'Board pack goes out Thursday night. Harbor Financial gets its own line this month.', author: 'Spencer', created_at: '2026-10-07T18:20:00Z' },
    { id: 'd2', text: 'Hold the Annuity push until the Athene rate update lands Monday.', author: 'Mira', created_at: '2026-10-08T13:05:00Z' },
  ],
  updated_at: null,
  updated_by: null,
}

const TABLES = [
  { label: 'Pinnacle Life Group', baseId: 'appPINNACLE', names: ['Applications', 'Policies', 'Agents', 'Carriers'] },
  { label: 'Harbor Financial', baseId: 'appHARBOR', names: ['Applications', 'Policies'] },
  { label: 'Summit Benefits', baseId: 'appSUMMIT', names: ['Applications', 'Policies'] },
]

// ════════════════════════════════════════════════════════════════════════
//  SHELL
// ════════════════════════════════════════════════════════════════════════

export default function CxoDemo() {
  const [view, setView] = useState<View>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Force CXO theming regardless of host, restore on unmount.
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-brand')
    el.setAttribute('data-brand', 'cxo')
    return () => {
      if (prev) el.setAttribute('data-brand', prev)
      else el.removeAttribute('data-brand')
    }
  }, [])

  // Views are hash-addressed (#performance) so in-page links such as
  // "See everything" on the Overview switch pages without a router.
  useEffect(() => {
    const sync = () => setView(viewFromHash())
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
    window.scrollTo({ top: 0 })
  }, [view])

  function go(v: View) {
    if (window.location.hash !== `#${v}`) window.location.hash = v
    else setView(v)
  }

  return (
    <div data-app-shell className={['dash-shell', mobileOpen ? 'is-mobile-open' : ''].filter(Boolean).join(' ')}>
      <div className="dash-mobilebar">
        <button type="button" className="dash-mobilebar-btn" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
          <span aria-hidden className="dash-burger"><span /><span /><span /></span>
        </button>
        <a href="#overview" className="dash-mobilebar-logo" aria-label={`${WORKSPACE} home`}>
          <span className="dash-rail-client-name">{WORKSPACE}</span>
        </a>
      </div>
      <div className="dash-scrim" onClick={() => setMobileOpen(false)} aria-hidden />

      <aside className="dash-sidebar" aria-label="Dashboard navigation">
        {/* Same head as the signed-in rail: the client's name (no invented logo), the live clock. */}
        <div className="dash-rail-head">
          <a href="#overview" className="dash-rail-client" aria-label={`${WORKSPACE} home`}>
            <small>Executive suite <DemoBadge /></small>
            <span className="dash-rail-client-name">{WORKSPACE}</span>
          </a>
          <RailClock timezone="America/Chicago" fixed={DEMO_NOW} />
        </div>

        <nav className="dash-sidebar-nav" aria-label="Sections">
          {NAV.map((t) => (
            <div key={t.key} className="dash-side-group">
              <button
                type="button"
                onClick={() => go(t.key)}
                className={['dash-side-link', view === t.key ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
                aria-current={view === t.key ? 'page' : undefined}
              >
                <RailIcon name={t.icon} />
                <span className="dash-side-label">{t.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot dash-rail-foot">
          <button
            type="button"
            className={['dash-side-link', settingsOpen ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <RailIcon name="settings" />
            <span className="dash-side-label">Settings</span>
          </button>
          {settingsOpen && (
            <div className="dash-rail-sub">
              <button type="button" className="dash-side-link dash-side-link-sub" onClick={() => go('integrations')}>
                <span className="dash-side-label">Integrations</span>
              </button>
              <a href="/cxo#contact" className="dash-side-link dash-side-link-sub">
                <span className="dash-side-label">Seats and billing</span>
              </a>
            </div>
          )}
          <div className="dash-rail-account">
            <span className="dash-rail-who" title="Spencer Hale · Pinnacle Life Group">Spencer Hale · Pinnacle Life Group</span>
            <a href="/cxo" className="dash-rail-out">Back to site</a>
          </div>
          <a href="/cxo#contact" className="dash-side-link dash-side-upgrade" style={{ marginTop: 6 }}>
            <span className="dash-side-label">Get your seat →</span>
          </a>
          <a href="/cxo" className="dash-rail-powered" aria-label="Powered by Suite CXO">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CXO_LOGO} alt="" />
            <span>Powered by Suite CXO</span>
          </a>
        </div>
      </aside>

      <main className="dash-main">
        {view === 'overview' && <Overview />}
        {view === 'performance' && <Performance />}
        {view === 'reports' && <Reports />}
        {view === 'calendar' && <Calendar />}
        {view === 'meetings' && <Meetings />}
        {view === 'partners' && <Partners />}
        {view === 'integrations' && <Integrations />}
        <MiraBar mode="demo" firstName="Spencer" canned={CANNED} placeholder="Ask Mira about the book or a meeting" />
      </main>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  1 · OVERVIEW
// ════════════════════════════════════════════════════════════════════════

function Overview() {
  return (
    <main className="wrap">
      <PageHeader eyebrow={WORKSPACE} title="Good morning, Spencer" subtitle={PREFS.headline_note} />
      <ExecOverview
        variant="home"
        pinnacleRows={PINNACLE_ROWS}
        statusRows={DATA.status}
        books={BOOKS}
        breakdowns={BREAKDOWNS}
        loadBreakdown={loadBreakdownDemo}
        lastSynced="12 minutes ago"
        now={TODAY}
        performanceHref="#performance"
        prefs={{ ...PREFS, headline_note: null }}
      />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  2 · PERFORMANCE
// ════════════════════════════════════════════════════════════════════════

function Performance() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Performance" title="Book of business" subtitle="Submitted and issued premium, placement, policies and who is driving it." />
      <ExecOverview
        variant="full"
        pinnacleRows={PINNACLE_ROWS}
        statusRows={DATA.status}
        books={BOOKS}
        breakdowns={BREAKDOWNS}
        loadBreakdown={loadBreakdownDemo}
        lastSynced="12 minutes ago"
        now={TODAY}
        tables={TABLES}
        performanceHref="#performance"
      />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  3 · REPORTS
// ════════════════════════════════════════════════════════════════════════

function Reports() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Reports" title="The numbers, period by period" subtitle="This month, the quarter, the half, the year: submitted, issued and placement, each against the same stretch last year." />
      <CxoReports pinnacleRows={PINNACLE_ROWS} statusRows={DATA.status} lastSynced="12 minutes ago" now={new Date(`${TODAY}T15:00:00Z`)} />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  4 · CALENDAR — two accounts, three calendars, merged week
// ════════════════════════════════════════════════════════════════════════

type DemoCal = { key: string; label: string; account: string; color: string }
const CALS: DemoCal[] = [
  { key: 'work', label: 'Pinnacle', account: 'spencer@pinnaclelifegroup.com', color: '#1C1B1A' },
  { key: 'board', label: 'Board', account: 'spencer@pinnaclelifegroup.com', color: '#7A7673' },
  { key: 'personal', label: 'Personal', account: 'spencer.k@gmail.com', color: '#B9B3AB' },
]
const ACCOUNTS = Array.from(new Set(CALS.map((c) => c.account)))

type DemoEvent = { id: string; day: number; start: string; end: string; summary: string; cal: string; allDay?: boolean }
// day = offset from Monday of the pinned week (2026-10-05 … 2026-10-11). Today is Thursday.
const EVENTS: DemoEvent[] = [
  { id: 'e1', day: 0, start: '08:30', end: '09:00', summary: 'Monday numbers with Mira', cal: 'work' },
  { id: 'e2', day: 0, start: '10:00', end: '11:00', summary: 'Southeast team lead 1:1s', cal: 'work' },
  { id: 'e3', day: 0, start: '16:00', end: '17:00', summary: 'Carrier review: Mutual of Omaha', cal: 'work' },
  { id: 'e4', day: 1, start: '09:00', end: '10:30', summary: 'Q4 enrollment push: planning', cal: 'work' },
  { id: 'e5', day: 1, start: '12:00', end: '13:00', summary: 'Lunch with Marcus Lee', cal: 'work' },
  { id: 'e6', day: 1, start: '18:30', end: '20:00', summary: 'Soccer: Ava', cal: 'personal' },
  { id: 'e7', day: 2, start: '08:00', end: '09:00', summary: 'Harbor Financial weekly', cal: 'work' },
  { id: 'e8', day: 2, start: '14:00', end: '15:30', summary: 'Board prep: October pack', cal: 'board' },
  { id: 'e9', day: 3, start: '09:00', end: '09:30', summary: 'Mira: what moved this week', cal: 'work' },
  { id: 'e10', day: 3, start: '11:00', end: '12:00', summary: 'Athene annuity product update', cal: 'work' },
  { id: 'e11', day: 3, start: '15:00', end: '16:00', summary: 'Pinnacle Life Group executive sync', cal: 'work' },
  { id: 'e12', day: 3, start: '17:30', end: '18:30', summary: 'Dentist', cal: 'personal' },
  { id: 'e13', day: 4, start: '10:00', end: '12:00', summary: 'Board meeting', cal: 'board' },
  { id: 'e14', day: 4, start: '13:00', end: '13:30', summary: 'Summit Benefits check-in', cal: 'work' },
  { id: 'e15', day: 5, start: '', end: '', summary: 'Lake weekend', cal: 'personal', allDay: true },
  { id: 'e16', day: 6, start: '', end: '', summary: 'Lake weekend', cal: 'personal', allDay: true },
]
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEK_DATES = [5, 6, 7, 8, 9, 10, 11]
const TODAY_IDX = 3

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hh = h % 12 === 0 ? 12 : h % 12
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`
}

function Calendar() {
  const [connected, setConnected] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('week')

  const calByKey = new Map(CALS.map((c) => [c.key, c]))
  const visible = EVENTS.filter((e) => !hidden.has(e.cal))

  if (!connected) {
    return (
      <main className="wrap">
        <PageHeader eyebrow="Calendar" title="Meetings" />
        <ConnectState
          kind="calendar"
          sentence="Connect your calendar and today and this week sit right here, with Mira learning from every meeting."
          button="Connect Google Calendar"
          href="#calendar"
          external
        />
        <p className="cx-takeaway" style={{ marginTop: 14 }}>
          Demo: <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setConnected(true)}>simulate a connected calendar →</button>
        </p>
      </main>
    )
  }

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Calendar"
        title="This week"
        subtitle="Thursday, October 8 · every calendar in one view."
        actions={
          <div className="cx-cal-accounts">
            {ACCOUNTS.map((a) => (
              <details key={a} className="cx-menu">
                <summary className="cx-chip"><i style={{ background: 'var(--ink, #1C1B1A)' }} />connected as {a}</summary>
                <div className="cx-menu-body">
                  <button type="button" className="cx-btn cx-btn-ghost" onClick={() => setConnected(false)}>Disconnect</button>
                </div>
              </details>
            ))}
            <button type="button" className="cx-btn cx-btn-sm cx-btn-red-text" onClick={() => setNotice('In the live product this opens Google with "choose an account". Microsoft 365 is on the way.')}>
              <PlusIcon /> Add another calendar
            </button>
          </div>
        }
      />
      {notice && <p className="cx-notice">{notice}</p>}

      <section className="cx-panel">
        <div className="cx-cal-toolbar">
          <button type="button" className="cx-btn cx-btn-ghost">Today</button>
          <button type="button" className="cx-btn cx-btn-ghost" aria-label="Previous week">‹</button>
          <button type="button" className="cx-btn cx-btn-ghost" aria-label="Next week">›</button>
          <strong style={{ fontFamily: 'var(--font-lora), serif', fontSize: 18 }}>October 5 – 11, 2026</strong>
          <div className="cx-seg" role="tablist" aria-label="View" style={{ marginLeft: 'auto' }}>
            {(['day', 'week', 'month'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="cx-cal-chips" role="group" aria-label="Calendars">
          {CALS.map((c) => {
            const off = hidden.has(c.key)
            return (
              <button
                key={c.key}
                type="button"
                className={['cx-chip', off ? 'is-off' : ''].filter(Boolean).join(' ')}
                aria-pressed={!off}
                onClick={() => setHidden((prev) => { const n = new Set(prev); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n })}
                title={c.account}
                style={{ cursor: 'pointer' }}
              >
                <i style={{ background: c.color }} />
                {c.label} <span style={{ color: 'var(--muted)' }}>· {c.account.split('@')[0]}</span>
              </button>
            )
          })}
        </div>

        {mode === 'month' ? (
          <p className="cx-takeaway">Month view shows the same calendars across October. Switch back to Week to see the merged week.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: mode === 'day' ? '1fr' : 'repeat(7, 1fr)', gap: 4 }}>
            {(mode === 'day' ? [TODAY_IDX] : [0, 1, 2, 3, 4, 5, 6]).map((i) => {
              const isToday = i === TODAY_IDX
              const dayEvents = visible.filter((e) => e.day === i).sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1))
              return (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${isToday ? 'var(--red)' : 'var(--ink-soft)'}`,
                    borderRadius: 10,
                    padding: '0.5rem 0.55rem',
                    background: 'var(--paper)',
                    minHeight: 200,
                    minWidth: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>{WEEK_DAYS[i]}</span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: isToday ? 'var(--red)' : 'var(--ink)' }}>{WEEK_DATES[i]}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {dayEvents.length === 0 && <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>—</span>}
                    {dayEvents.map((e) => {
                      const c = calByKey.get(e.cal)!
                      const label = e.allDay ? e.summary : `${fmtTime(e.start)} · ${e.summary}`
                      return (
                        <span
                          key={e.id}
                          title={`${e.summary} · ${c.label}`}
                          style={{
                            display: 'block',
                            fontSize: '0.78rem',
                            lineHeight: 1.3,
                            padding: '3px 6px 3px 8px',
                            borderRadius: 4,
                            borderLeft: `3px solid ${c.color}`,
                            background: 'var(--paper-alt)',
                            color: 'var(--ink)',
                            whiteSpace: mode === 'day' ? 'normal' : 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {label}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  5 · RECORDINGS
// ════════════════════════════════════════════════════════════════════════

type Note = { id: string; when: string; dur: string; title: string; summary: string; items: string[] }
const NOTES: Note[] = [
  {
    id: 'n1', when: 'Thu, Oct 8, 9:00 AM', dur: '28 min', title: 'Mira: what moved this week',
    summary: 'Issued premium is pacing 9% ahead of last October. Health carried the week; Annuity is quiet because Athene\'s rate change lands Monday. Southeast placement slipped two points on Foresters declines.',
    items: ['Ask Dana for the Foresters decline reasons by Friday', 'Hold the Annuity push until the Athene update', 'Move the Q4 enrollment review to next Tuesday'],
  },
  {
    id: 'n2', when: 'Wed, Oct 7, 2:00 PM', dur: '1h 24m', title: 'Board prep: October pack',
    summary: 'Walked the board pack. Year to date is up on last year with Life leading the mix shift. Agreed to show cost per issued policy by team and to call out Harbor Financial\'s growth as a separate line.',
    items: ['Add cost per issued policy by team to the pack', 'Break out Harbor Financial on page 3', 'Send the pack Thursday night'],
  },
  {
    id: 'n3', when: 'Wed, Oct 7, 8:00 AM', dur: '41 min', title: 'Harbor Financial weekly',
    summary: 'Harbor wrote its best September. Two new agents licensed in Georgia. They want the same Monday numbers email the Pinnacle team gets.',
    items: ['Turn on the Monday numbers email for Harbor', 'Introduce Harbor\'s new agents to Marcus for ride-alongs'],
  },
  {
    id: 'n4', when: 'Tue, Oct 6, 9:00 AM', dur: '1h 12m', title: 'Q4 enrollment push: planning',
    summary: 'Enrollment season plan locked: Texas and Florida get the extra lead budget, Mountain West runs the referral play. Target is placement above 74% for the quarter.',
    items: ['Shift $18k of October lead budget to TX and FL', 'Weekly placement check on Thursdays'],
  },
  {
    id: 'n5', when: 'Mon, Oct 5, 4:00 PM', dur: '36 min', title: 'Carrier review: Mutual of Omaha',
    summary: 'Still the top carrier by issued premium. Underwriting turnaround improved to six days. They are opening a simplified-issue product in November worth testing with the final expense team.',
    items: ['Pilot the simplified-issue product with the Southeast team in November'],
  },
]

const TODAY_MEETINGS: Array<{ time: string; title: string; who: string; status: 'recorded' | 'recording' | 'missing' }> = [
  { time: '8:00am', title: 'Monday numbers with the team leads', who: '6 people', status: 'recorded' },
  { time: '9:30am', title: 'Mutual of Omaha · simplified-issue pilot', who: '3 people', status: 'recording' },
  { time: '1:00pm', title: 'Harbor Financial quarterly', who: '4 people', status: 'missing' },
  { time: '3:30pm', title: 'Q4 enrollment budget', who: '5 people', status: 'missing' },
]

function MeetingStatus({ status }: { status: 'recorded' | 'recording' | 'missing' }) {
  if (status === 'recorded') return <span className="cx-chip"><i style={{ background: 'var(--ink, #1C1B1A)' }} />Recorded</span>
  if (status === 'recording') return <span className="cx-chip"><i style={{ background: 'var(--red, #FF2800)' }} />Recording</span>
  return <span className="cx-chip"><i style={{ background: 'rgba(28,27,26,0.25)' }} />Not yet</span>
}

function Meetings() {
  const [connected, setConnected] = useState(true)
  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Meetings"
        title="Meetings"
        subtitle={connected ? 'Today on the calendar with its recording, then every transcript Mira has read, newest first.' : "Put Wispr Flow on every executive's computer and every meeting lands here for Mira."}
      />
      {!connected ? (
        <>
          <ConnectState kind="recordings" sentence="No meetings yet. Once Wispr Flow is on, every call lands here and Mira reads it." button="Connect Wispr Flow" href="#integrations" />
          <p className="cx-takeaway" style={{ marginTop: 14 }}>
            Demo: <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setConnected(true)}>simulate connected meetings →</button>
          </p>
        </>
      ) : (
        <div className="cx-grid">
          <section className="cx-panel">
            <div className="cx-eyebrow">Today · Thursday, October 8</div>
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {TODAY_MEETINGS.map((m) => (
                <li key={m.time} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 64, color: 'var(--cx-muted, #6b6966)', fontSize: 14 }}>{m.time}</span>
                  <span style={{ flex: 1, minWidth: 200, fontSize: 15 }}>{m.title} <span style={{ color: 'var(--cx-muted, #6b6966)', fontSize: 13 }}>· {m.who}</span></span>
                  <MeetingStatus status={m.status} />
                </li>
              ))}
            </ul>
          </section>
          <div className="cx-eyebrow" style={{ marginTop: 6 }}>Past meetings</div>
          {NOTES.map((n) => (
            <article key={n.id} className="cx-panel">
              <div className="cx-eyebrow">{n.when} · {n.dur}</div>
              <h2 className="cx-title" style={{ fontSize: 20, margin: '4px 0 8px' }}>{n.title}</h2>
              <p className="cx-takeaway">{n.summary}</p>
              <details className="cx-details">
                <summary>{n.items.length} action item{n.items.length === 1 ? '' : 's'}</summary>
                <ul className="cx-details-body" style={{ paddingLeft: 18 }}>
                  {n.items.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </details>
              <details className="cx-details">
                <summary>Transcript</summary>
                <div className="cx-details-body">Full transcript available in the live product.</div>
              </details>
            </article>
          ))}
          <p className="cx-takeaway">
            <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setConnected(false)}>See the empty state →</button>
          </p>
        </div>
      )}
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  6 · PARTNERS (placeholder, same as the signed-in page)
// ════════════════════════════════════════════════════════════════════════

function Partners() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Partners" title="Partners is on its way" subtitle="Carriers, IMOs and the people you work with, in one place. Mira will keep it current." />
      <section className="cx-panel" style={{ marginTop: 16 }}>
        <p className="cx-takeaway" style={{ marginTop: 0 }}>
          Nothing to set up yet. When Partners opens, it appears here and in the rail without a change on your side.
        </p>
      </section>
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  7 · INTEGRATIONS
// ════════════════════════════════════════════════════════════════════════

function Integrations() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Integrations" title="Connected" subtitle="Everything Mira reads from. Each one can also be connected from the page it belongs to." />
      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <IntegrationAccordion title="Book of business" status="Synced 12 minutes ago" statusOk defaultOpen>
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>Three books feed Performance and Reports: Pinnacle Life Group, Harbor Financial, Summit Benefits. Synced every 15 minutes.</p>
          <a href="#performance" className="cx-link">Open Performance →</a>
        </IntegrationAccordion>

        <IntegrationAccordion title="Connect your AI" status="1 key" statusOk>
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>Your own Claude or ChatGPT can read the same numbers Mira does. Paste this server address into your assistant and sign in with a key.</p>
          <code style={{ display: 'inline-block', padding: '6px 10px', borderRadius: 8, background: 'var(--paper-alt)', fontSize: 13 }}>https://www.suitecxo.com/api/mcp</code>
          <div style={{ marginTop: 12 }}><button type="button" className="cx-btn">Make a key</button></div>
        </IntegrationAccordion>

        <IntegrationAccordion title="Google Calendar" status="2 accounts" statusOk>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', display: 'grid', gap: 6, fontSize: 14 }}>
            {ACCOUNTS.map((a) => (
              <li key={a} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{a}</span>
                <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>Disconnect</button>
              </li>
            ))}
          </ul>
          <button type="button" className="cx-btn cx-btn-sm cx-btn-red-text"><PlusIcon /> Add another calendar</button>
        </IntegrationAccordion>

        <IntegrationAccordion title="Recordings" status="Wispr Flow on 4 computers" statusOk>
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>Meeting notes and transcripts land on Meetings and Mira learns from each one.</p>
          <a href="#meetings" className="cx-link">Open Meetings →</a>
        </IntegrationAccordion>

        <IntegrationAccordion title="Email" status="Not connected">
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>Connect Google Workspace or Microsoft 365 and Mira answers from what came in.</p>
          <button type="button" className="cx-btn">Connect email</button>
        </IntegrationAccordion>

        <IntegrationAccordion title="Account" status="Spencer K · owner">
          <p style={{ margin: 0, fontSize: 14 }}>Workspace: {WORKSPACE}. Time zone: Eastern. Seats: 4 executives, 2 assistants.</p>
        </IntegrationAccordion>
      </div>
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  MIRA — present, canned, inert
// ════════════════════════════════════════════════════════════════════════

const CANNED: Array<{ q: string; a: string }> = [
  { q: 'How is the book pacing?', a: 'Year to date you have issued more than this point last year, and October is running ahead of last October. At this pace the year lands above last year\'s total. Health is the engine; Life is the mix shift; Annuity is waiting on the Athene update.' },
  { q: 'What moved this week?', a: 'Three things. Southeast placement slipped two points on Foresters declines. Harbor Financial posted its best September. The Q4 enrollment budget moved to Texas and Florida on Tuesday.' },
  { q: 'What came up on a call?', a: 'In board prep yesterday you agreed to add cost per issued policy by team and break out Harbor Financial. Mutual of Omaha is opening a simplified-issue product in November; the Southeast team is the pilot.' },
]

function DemoBadge() {
  return (
    <span
      style={{
        display: 'inline-block', marginLeft: 6, verticalAlign: 'middle',
        fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--red, #FF2800)', border: '1px solid var(--red, #FF2800)', borderRadius: 999, padding: '1px 6px',
      }}
    >
      Demo
    </span>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}
