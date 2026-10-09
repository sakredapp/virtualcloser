'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import ExecOverview, { type BookInput, type BreakdownMap } from '@/app/components/cxo/ExecOverview'
import ConnectState from '@/app/components/cxo/ConnectState'
import MiraBar from '@/app/components/cxo/MiraBar'
import RailIcon, { type RailIconName } from '@/app/components/cxo/RailIcon'
import RailClock, { RailName } from '@/app/components/cxo/RailClock'
import type { DashboardPrefs } from '@/lib/dashboardPrefs'
import CxoIntegrations from '@/app/dashboard/integrations/CxoIntegrations'
import { RailFoot, RailSettingsNav } from '@/app/components/cxo/ExecRail'
import DemoPartners from './DemoPartners'
import NoteTakerConnect from '@/app/components/cxo/NoteTakerConnect'
import type { BreakdownDim, BreakdownRow, DailyRow, StatusRow } from '@/lib/pinnacle/rollup'
import { timeframeWindow } from '@/lib/pinnacle/kpis'

/*
  CXO Suite — public demo of the executive suite.

  The SAME components the signed-in product renders (ExecOverview,
  ConnectState, the calendar grid markup, the meeting cards, the
  Integrations rows, the rail and its settings flip, and the Mira bar) fed invented data
  shaped exactly like the rollup rows (DailyRow / StatusRow / BreakdownRow).
  No auth, no network, nothing persisted. "Today" is pinned so the numbers
  never drift. The book is scaled to roughly $250M submitted year to date.

  The same pages the real left rail shows for an executive seat:
  Revenue · Team · Partners · Calendar · Meetings, with Integrations under
  Settings. Mira is on every page as the same bar, canned.
*/

const TODAY = '2026-10-08'
/** The rail clock is pinned too: Thursday, October 8 · 9:14am CT. */
const DEMO_NOW = new Date('2026-10-08T14:14:00Z')
const WORKSPACE = 'Pinnacle Life Group'

type View = 'overview' | 'team' | 'partners' | 'calendar' | 'meetings' | 'integrations'

const NAV: { key: View; label: string; icon: RailIconName }[] = [
  { key: 'overview', label: 'Revenue', icon: 'revenue' },
  { key: 'team', label: 'Team', icon: 'performance' },
  { key: 'partners', label: 'Partners', icon: 'partners' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'meetings', label: 'Meetings', icon: 'meetings' },
]
const ALL_VIEWS: View[] = ['overview', 'team', 'partners', 'calendar', 'meetings', 'integrations']

function viewFromHash(): View {
  if (typeof window === 'undefined') return 'overview'
  const raw = window.location.hash.replace('#', '')
  const alias: Record<string, View> = { recordings: 'meetings', performance: 'team', reports: 'team' }
  const h = alias[raw] ?? raw
  return (ALL_VIEWS.find((v) => v === h) ?? 'overview') as View
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

/** One trailing-12-month row for the demo book (~$294M submitted). `d` is the change vs the prior 12 months. */
function bd(label: string, premium: number, policies: number, d: number, place = 0.72): BreakdownRow & { d: number } {
  const paid = Math.round(policies * place)
  return { label, premium, policies, paid, declined: Math.round(policies * 0.07), lapsed: Math.round(policies * 0.04), d }
}

const M = 1_000_000
const BREAKDOWNS_12M: Required<Record<BreakdownDim, (BreakdownRow & { d: number })[]>> = {
  // Five teams sum to the $294M trailing-12 book.
  team: [bd('Southeast', 80.2 * M, 28_640, 0.12), bd('Texas', 71.6 * M, 25_570, -0.04), bd('Mountain West', 58.1 * M, 20_750, 0), bd('Northeast', 46.9 * M, 16_750, 0.07), bd('Pacific', 37.2 * M, 13_290, -0.09)],
  agent: [{ ...bd('Grace Whitman', 9.1 * M, 2_890, 0.18, 0.81), team: 'Southeast' }, { ...bd('Marcus Lee', 8.4 * M, 3_140, -0.06, 0.77), team: 'Texas' }, { ...bd('Priya Raman', 7.6 * M, 2_530, 0.03, 0.8), team: 'Southeast' }, { ...bd('Tom Alvarez', 6.9 * M, 2_370, 0, 0.69), team: 'Mountain West' }, { ...bd('Jenna Cole', 6.1 * M, 2_140, 0.11, 0.74), team: 'Northeast' }, { ...bd('Omar Haddad', 5.4 * M, 1_960, -0.12, 0.66), team: 'Texas' }, { ...bd('Sofia Marin', 4.8 * M, 1_820, 0.05, 0.71), team: 'Pacific' }, { ...bd('Chris Ng', 4.2 * M, 1_550, -0.02, 0.63), team: 'Mountain West' }],
  // Six carriers sum to the book.
  carrier: [bd('Mutual of Omaha', 70.4 * M, 24_760, 0.09), bd('Americo', 61.8 * M, 23_350, -0.04), bd('Transamerica', 54.3 * M, 19_780, 0.14), bd('Foresters', 43.7 * M, 16_440, -0.11), bd('Aetna', 36.1 * M, 14_480, 0), bd('Athene', 27.7 * M, 3_380, 0.06, 0.64)],
  state: [bd('TX', 71.6 * M, 25_570, 0.12), bd('FL', 58.3 * M, 21_540, 0.04), bd('GA', 43.9 * M, 16_310, -0.05), bd('AZ', 35.8 * M, 12_720, 0), bd('NC', 29.6 * M, 10_640, 0.09), bd('OH', 24.1 * M, 8_760, -0.03)],
  product: [bd('Final expense', 86.2 * M, 36_400, 0.06, 0.78), bd('Mortgage protection', 74.1 * M, 19_060, 0.12, 0.7), bd('Indexed universal life', 54.4 * M, 8_660, -0.04, 0.66), bd('Fixed indexed annuity', 49.6 * M, 2_680, 0, 0.62), bd('Term', 29.7 * M, 11_200, 0.15, 0.74)],
}

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1)
}

/** Rows for a window: scaled to its month count, and a prior window (one ending before this month) is backed out by each row's delta. */
function breakdownFor(dim: BreakdownDim, line: string, start: string, end: string): BreakdownRow[] {
  const rows = BREAKDOWNS_12M[dim] ?? []
  const lineFactor = line === 'All' ? 1 : line === 'Health' ? 0.46 : line === 'Life' ? 0.34 : 0.2
  const months = monthsBetween(start, end)
  const prior = end < DEMO_NOW.toISOString().slice(0, 7)
  return rows.map((r) => {
    const f = (lineFactor * months) / 12 / (prior ? 1 + r.d : 1)
    const { d: _d, ...rest } = r
    void _d
    return {
      ...rest,
      premium: Math.round(r.premium * f),
      policies: Math.round(r.policies * f),
      paid: Math.round(r.paid * f),
      declined: Math.round(r.declined * f),
      lapsed: Math.round(r.lapsed * f),
    }
  })
}

const BREAKDOWNS: Required<BreakdownMap> = Object.fromEntries(
  (Object.keys(BREAKDOWNS_12M) as BreakdownDim[]).map((dim) => {
    const w = timeframeWindow('12m', DEMO_NOW)
    return [dim, breakdownFor(dim, 'All', w.start, w.end)]
  }),
) as Required<BreakdownMap>

async function loadBreakdownDemo(dim: BreakdownDim, line: string, start: string, end: string): Promise<BreakdownRow[]> {
  return breakdownFor(dim, line, start, end)
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
    { id: 'd1', text: 'Board pack goes out Thursday night. Harbor Financial gets its own line this month.', author: 'Michael', created_at: '2026-10-07T18:20:00Z' },
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
  const [settingsOn, setSettingsOn] = useState(false)
  const [signOutNote, setSignOutNote] = useState(false)

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
            <RailName name={WORKSPACE} />
          </a>
          <RailClock fixed={DEMO_NOW} />
        </div>

        {settingsOn ? (
          <RailSettingsNav
            demo
            onBack={() => setSettingsOn(false)}
            items={[
              { key: 'profile', label: 'Profile', icon: 'profile', onClick: () => go('integrations') },
              { key: 'integrations', label: 'Integrations', icon: 'integrations', onClick: () => go('integrations'), active: view === 'integrations' },
              { key: 'calendars', label: 'Calendar accounts', icon: 'calendar', onClick: () => go('calendar') },
            ]}
          />
        ) : (
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
        )}

        <RailFoot settingsOn={settingsOn} onSettings={() => setSettingsOn((v) => !v)} who="Michael" role="Executive · demo" onSignOut={() => setSignOutNote(true)} />
      </aside>

      <main className="dash-main">
        {signOutNote && (
          <p className="cx-notice" style={{ margin: '12px 16px 0' }}>
            This is the demo, so there is nothing to sign out of.{' '}
            <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setSignOutNote(false)}>Dismiss</button>
          </p>
        )}
        {view === 'overview' && <Overview />}
        {view === 'team' && <Team />}
        {view === 'calendar' && <Calendar />}
        {view === 'meetings' && <Meetings />}
        {view === 'partners' && <DemoPartners />}
        {view === 'integrations' && <Integrations />}
        <MiraBar mode="demo" firstName="Michael" canned={CANNED} answer={demoAnswer} placeholder="Ask Mira about the book or a meeting" />
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
      <PageHeader eyebrow="Good morning, Michael" title="Revenue" subtitle={PREFS.headline_note} />
      <ExecOverview
        variant="home"
        pinnacleRows={PINNACLE_ROWS}
        statusRows={DATA.status}
        books={BOOKS}
        breakdowns={BREAKDOWNS}
        loadBreakdown={loadBreakdownDemo}
        lastSynced="12 minutes ago"
        now={TODAY}
        performanceHref="#team"
        reconciled
        prefs={{ ...PREFS, headline_note: null }}
      />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  2 · TEAM — named agencies, their agents, where policies stand
// ════════════════════════════════════════════════════════════════════════

function Team() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Team" title="Agencies and agents" subtitle="Who is writing the book, ranked, with placement and trend." />
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
        performanceHref="#team"
        reconciled
      />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  4 · CALENDAR — two accounts, three calendars, merged week
// ════════════════════════════════════════════════════════════════════════

type DemoCal = { key: string; label: string; account: string; color: string }
const CALS: DemoCal[] = [
  { key: 'work', label: 'Pinnacle', account: 'michael@pinnaclelifegroup.com', color: 'var(--cx-chart-1)' },
  { key: 'board', label: 'Board', account: 'michael@pinnaclelifegroup.com', color: 'var(--cx-chart-ref)' },
  { key: 'personal', label: 'Personal', account: 'michael.c@gmail.com', color: 'var(--cx-chart-3)' },
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
            <details className="cx-menu">
              <summary className="cx-chip" title="Connected calendars">Manage</summary>
              <div className="cx-menu-body">
                {ACCOUNTS.map((a) => (
                  <div key={a}>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{a}</span>
                    <button type="button" className="cx-link" onClick={() => setConnected(false)}>Disconnect this calendar</button>
                  </div>
                ))}
              </div>
            </details>
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
  if (status === 'recorded') return <span className="cx-chip"><i style={{ background: 'var(--cx-ink)' }} />Recorded</span>
  if (status === 'recording') return <span className="cx-chip"><i style={{ background: 'var(--cx-accent)' }} />Recording</span>
  return <span className="cx-chip"><i style={{ background: 'rgba(28,27,26,0.25)' }} />Not yet</span>
}

function Meetings() {
  const [connected, setConnected] = useState(true)
  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Meetings"
        title="Meetings"
        subtitle={connected ? 'Today on the calendar with its recording, then every transcript Mira has read, newest first.' : 'Connect your note-taker and every meeting lands here for Mira.'}
        actions={<NoteTakerConnect demo inHeader inboxReady={connected} zapierUrl="https://www.suitecxo.com/api/meetings/inbound/your-private-token" />}
      />
      {!connected ? (
        <>
          <ConnectState kind="recordings" sentence="No meetings yet. Connect your note-taker and every call lands here for Mira." button="Connect" href="#integrations" />
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
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 64, color: 'var(--cx-muted)', fontSize: 14 }}>{m.time}</span>
                  <span style={{ flex: 1, minWidth: 200, fontSize: 15 }}>{m.title} <span style={{ color: 'var(--cx-muted)', fontSize: 13 }}>· {m.who}</span></span>
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
//  7 · INTEGRATIONS
// ════════════════════════════════════════════════════════════════════════

function Integrations() {
  return (
    <CxoIntegrations
      demo
      googleAccounts={ACCOUNTS.map((a) => ({ accountId: a, email: a, label: a }))}
      inboxUrl="https://www.suitecxo.com/api/webhooks/plaud/demo"
      makeInbox={async () => {}}
      logoUrl={null}
      saveLogo={async () => {}}
    />
  )
}

// ════════════════════════════════════════════════════════════════════════
//  MIRA — present, canned, inert
// ════════════════════════════════════════════════════════════════════════

const CANNED: Array<{ q: string; a: string }> = [
  { q: 'How is the book pacing?', a: 'Year to date you have issued more than this point last year, and October is running ahead of last October. At this pace the year lands above last year\'s total. Health is the engine; Life is the mix shift; Annuity is waiting on the Athene update.' },
  { q: 'What moved this week?', a: 'Three things. Southeast placement slipped two points on Foresters declines. Harbor Financial posted its best September. The Q4 enrollment budget moved to Texas and Florida on Tuesday.' },
  { q: 'Send Dana the health premium for the last 3 months and life for the last 6', a: 'Drafted for Dana Whitfield (Mutual of Omaha), subject "Pinnacle Life Group production — Health trailing 3 months, Life trailing 6 months". Health issued premium, the last 3 months (Jul 9 – Oct 8, 2026): $2.41M across 1,884 policies, up 9%. Life issued premium, the last 6 months (Apr 9 – Oct 8, 2026): $2.02M across 1,170 policies, up 10%. Data through October 8, 2026. It is saved on her card; say "send it" and it goes from your Gmail.' },
  { q: 'Book 30 minutes with Marcus Bell next week', a: 'Open across all three calendars: Tue Oct 13 10:00, Wed Oct 14 2:00, Thu Oct 15 11:00 (Central). Which one? I will put it on your primary calendar with a Meet link and send Marcus the invite.' },
  { q: 'What came up on a call?', a: 'In board prep yesterday you agreed to add cost per issued policy by team and break out Harbor Financial. Mutual of Omaha is opening a simplified-issue product in November; the Southeast team is the pilot.' },
]

/** Looser demo matches after an exact starter: the Partners send/book flow. */
function demoAnswer(q: string): string | null {
  const lower = q.toLowerCase()
  if (/^send (it|that|the draft)/.test(lower)) return 'Sending to Dana Whitfield, subject "Pinnacle Life Group production — Health trailing 3 months, Life trailing 6 months". Sent from your Gmail and logged on her card.'
  if (/send .*(premium|report|numbers)/.test(lower)) return CANNED[2].a
  if (/(book|schedule|find).*(minutes|call|time|meeting)/.test(lower)) return CANNED[3].a
  if (/^(tue|wed|thu|the (first|second|third)|10|2|11)/.test(lower)) return 'Booked. Pinnacle × Harbor Financial: Michael / Marcus — Tue Oct 13, 10:00–10:30 Central, on your primary calendar, Meet link added, invite sent to Marcus.'
  return null
}

function DemoBadge() {
  return (
    <span
      style={{
        display: 'inline-block', marginLeft: 6, verticalAlign: 'middle',
        fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--cx-accent)', border: '1px solid var(--cx-accent)', borderRadius: 999, padding: '1px 6px',
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
