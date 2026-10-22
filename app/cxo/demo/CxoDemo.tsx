'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import ExecOverview, { type BookInput, type BreakdownMap, type ExecWords } from '@/app/components/cxo/ExecOverview'
import ConnectState from '@/app/components/cxo/ConnectState'
import MiraBar from '@/app/components/cxo/MiraBar'
import RailIcon, { type RailIconName } from '@/app/components/cxo/RailIcon'
import RailClock, { RailName } from '@/app/components/cxo/RailClock'
import type { DashboardPrefs } from '@/lib/dashboardPrefs'
import CxoIntegrations from '@/app/dashboard/integrations/CxoIntegrations'
import { RailFoot, RailSettingsNav } from '@/app/components/cxo/ExecRail'
import DemoPartners from './DemoPartners'
import AdoptionView from '@/app/components/cxo/AdoptionView'
import { demoAdoption } from '@/lib/cxoAdoptionShared'
import { DEMO_QUEUE } from '@/lib/mira/dailyQueueShared'
import DemoPeople from './DemoPeople'
import NoteTakerConnect from '@/app/components/cxo/NoteTakerConnect'
import type { BreakdownDim, BreakdownRow, DailyRow, StatusRow } from '@/lib/pinnacle/rollup'
import { timeframeWindow } from '@/lib/pinnacle/kpis'
import type { MonthToDate } from '@/lib/pinnacle/cache'
import PhoneTabBar from '@/app/components/cxo/phone/PhoneTabBar'
import type { BookTopRows } from '@/app/components/cxo/phone/PhoneBookTops'
import { PHONE_VERSIONS, demoPhoneVersion, phoneShellAttrs, phoneVersionStyle, type PhoneHomeKind, type PhoneVersionKey } from '@/lib/phoneVersions'
import { DEMO_PHONE_VIEWS, DemoPhoneApprovals, DemoPhoneHome, DemoPhoneMe, DemoPhoneStrip, DemoPhoneWork, useDemoApprovals, type DemoPhoneView } from './DemoPhone'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { DEMO_DAY, DEMO_NOW, TODAY, TODAY_IDX, WEEK, dayOffset, isoDay, longDay, monthsBack, shortDate, shortDay, weekLabel } from './demoClock'

/*
  Suite CXO — public demo of the executive suite.

  The SAME components the signed-in product renders (ExecOverview,
  ConnectState, the calendar grid markup, the meeting cards, the
  Integrations rows, the rail and its settings flip, and the Mira bar) fed invented data
  shaped exactly like the rollup rows (DailyRow / StatusRow / BreakdownRow).
  No auth, no network, nothing persisted. "Today" is the real date
  (./demoClock), so the demo never looks stuck on an old day.

  The invented company is a professional services firm (advisory, projects,
  retainers), never an insurance agency: no carriers, premium or policies,
  and no sales targets (vault Suite CXO, 2026-10-22).

  The same pages the real left rail shows for an executive seat:
  Revenue · Team · Partners · Calendar · Meetings, with Integrations under
  Settings. Mira is on every page as the same bar, canned.
*/

/** Invented company. Never a real client's name, people or figures on this page. */
const WORKSPACE = 'Northgate Group'
const ORG_SHORT = 'Northgate'

// The last five are the phone layout's own screens (./DemoPhone). They only
// draw at phone width; a wider screen on one of them shows Revenue, as before.
type View = 'overview' | 'team' | 'employees' | 'partners' | 'calendar' | 'meetings' | 'integrations' | 'adoption' | DemoPhoneView
const isPhoneView = (v: View): v is DemoPhoneView => (DEMO_PHONE_VIEWS as View[]).includes(v)

const NAV: { key: View; label: string; icon: RailIconName }[] = [
  { key: 'overview', label: 'Revenue', icon: 'revenue' },
  { key: 'team', label: 'Team', icon: 'performance' },
  { key: 'employees', label: 'Employees', icon: 'employees' },
  { key: 'partners', label: 'Partners', icon: 'partners' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'meetings', label: 'Meetings', icon: 'meetings' },
]
const ALL_VIEWS: View[] = ['overview', 'team', 'employees', 'partners', 'calendar', 'meetings', 'integrations', 'adoption', ...DEMO_PHONE_VIEWS]

/** No hash (or an unknown one) is `home`: the phone's Home at phone width, Revenue on anything wider. */
function viewFromHash(): View {
  if (typeof window === 'undefined') return 'home'
  const raw = window.location.hash.replace('#', '')
  const alias: Record<string, View> = { recordings: 'meetings', performance: 'team', reports: 'team' }
  const h = alias[raw] ?? raw
  return (ALL_VIEWS.find((v) => v === h) ?? 'home') as View
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

/** Monthly booked revenue per service line and the average engagement size. */
const LINE_BASE: Record<string, { booked: number; avg: number; growth: number; collect: number }> = {
  Advisory: { booked: 2_200_000, avg: 18_000, growth: 0.24, collect: 0.9 },
  Projects: { booked: 3_100_000, avg: 46_000, growth: 0.31, collect: 0.82 },
  Retainers: { booked: 1_400_000, avg: 7_500, growth: 0.18, collect: 0.94 },
}

/** The words the shared overview cards print for this company. */
const WORDS: Partial<ExecWords> = {
  lines: Object.keys(LINE_BASE),
  book: 'company books',
  bookOfBusiness: 'company books',
  money: 'revenue',
  submitted: 'booked',
  issued: 'collected',
  unit: 'engagement',
  units: 'engagements',
  written: 'won',
  placed: 'collected',
  placementRate: 'Collection rate',
  placement: 'Collected',
  paidStage: 'Delivered and paid',
  outStage: 'Lost or cancelled',
  mix: 'Service mix',
  lineWord: 'service-line',
  group: 'office',
  groups: 'offices',
  person: 'consultant',
  people: 'consultants',
}

const BOOKS_META = [
  { baseId: 'appNORTHGATE', label: WORKSPACE, isMaster: true, scale: 1 },
  { baseId: 'appHARBOR', label: 'Harbor Advisory', isMaster: false, scale: 0.34 },
  { baseId: 'appSUMMIT', label: 'Summit Consulting', isMaster: false, scale: 0.21 },
]

function buildDaily(): { rows: DailyRow[]; status: StatusRow[] } {
  const rand = mulberry32(20261008)
  const rows: DailyRow[] = []
  const status: StatusRow[] = []
  const today = new Date(DEMO_DAY)
  const start = Date.UTC(today.getUTCFullYear() - 2, today.getUTCMonth(), 1) // two years back
  const end = DEMO_DAY
  const span = end - start
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t)
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    const weekend = dow === 0 || dow === 6
    const month = d.getUTCMonth()
    // Seasonality: a strong autumn, soft January, summer dip.
    const season = 1 + 0.22 * Math.sin(((month - 2) / 12) * Math.PI * 2) + (month >= 9 ? 0.14 : 0)
    const progress = (t - start) / span
    for (const line of Object.keys(LINE_BASE)) {
      const base = LINE_BASE[line]
      const growth = 1 + base.growth * progress
      const noise = 0.55 + rand() * 0.9
      const dayFactor = weekend ? 0.18 : 1
      const booked = Math.round(((base.booked * season * growth) / 22) * noise * dayFactor)
      const won = Math.max(0, Math.round(booked / base.avg + rand() * 0.8))
      const collect = base.collect
      const delivered = Math.round(won * (collect + (rand() - 0.5) * 0.1))
      for (const b of BOOKS_META) {
        const amt = Math.round(booked * b.scale * (b.isMaster ? 1 : 0.8 + rand() * 0.4))
        const n = b.isMaster ? won : Math.max(0, Math.round(won * b.scale))
        // The shared rollup row's field names (DailyRow) carry the demo's booked and collected figures.
        rows.push({ d: iso, base_id: b.baseId, line, premium: amt, policies: n, funded_premium: Math.round(amt * collect), funded_policies: b.isMaster ? delivered : Math.round(n * collect) })
      }
      const lost = Math.round(won * (0.04 + rand() * 0.03))
      const cancelled = Math.round(won * (0.01 + rand() * 0.02))
      const paid = Math.min(won, delivered)
      status.push({
        d: iso,
        line,
        total: won,
        paid,
        declined: lost,
        lapsed: cancelled,
        submitted: Math.max(0, won - paid - lost - cancelled),
      })
    }
  }
  return { rows, status }
}

const DATA = buildDaily()
const MASTER_ROWS = DATA.rows.filter((r) => r.base_id === 'appNORTHGATE')
const BOOKS: BookInput[] = BOOKS_META.map((b) => ({
  baseId: b.baseId,
  label: b.label,
  isPinnacle: b.isMaster,
  rows: DATA.rows.filter((r) => r.base_id === b.baseId),
}))

/** One trailing-12-month row for the demo company (~$80M booked). `d` is the change vs the prior 12 months. */
function bd(label: string, booked: number, won: number, d: number, collect = 0.86): BreakdownRow & { d: number } {
  const paid = Math.round(won * collect)
  return { label, premium: booked, policies: won, paid, declined: Math.round(won * 0.05), lapsed: Math.round(won * 0.02), d }
}

const M = 1_000_000
// Offices, consultants, clients, states and services, each summing to the ~$80M trailing-12 book.
const BREAKDOWNS_12M: Required<Record<BreakdownDim, (BreakdownRow & { d: number })[]>> = {
  team: [bd('Southeast', 21.8 * M, 1_230, 0.12), bd('Texas', 19.5 * M, 1_100, -0.04), bd('Mountain West', 15.8 * M, 890, 0), bd('Northeast', 12.8 * M, 720, 0.07), bd('Pacific', 10.1 * M, 560, -0.09)],
  agent: [{ ...bd('Grace Whitman', 2.6 * M, 118, 0.18, 0.91), team: 'Southeast' }, { ...bd('Marcus Lee', 2.3 * M, 126, -0.06, 0.88), team: 'Texas' }, { ...bd('Priya Raman', 2.1 * M, 104, 0.03, 0.9), team: 'Southeast' }, { ...bd('Tom Alvarez', 1.9 * M, 97, 0, 0.84), team: 'Mountain West' }, { ...bd('Jenna Cole', 1.7 * M, 88, 0.11, 0.87), team: 'Northeast' }, { ...bd('Omar Haddad', 1.5 * M, 81, -0.12, 0.82), team: 'Texas' }, { ...bd('Sofia Marin', 1.3 * M, 74, 0.05, 0.86), team: 'Pacific' }, { ...bd('Chris Ng', 1.2 * M, 63, -0.02, 0.8), team: 'Mountain West' }],
  // The rollup calls this list "carrier"; for this company it is its biggest clients.
  carrier: [bd('Halvorsen Logistics', 19.2 * M, 1_010, 0.09), bd('Corbel Manufacturing', 16.8 * M, 950, -0.04), bd('Ashford Retail Group', 14.8 * M, 820, 0.14), bd('Pinecrest Utilities', 11.9 * M, 700, -0.11), bd('Meridian Foods', 9.8 * M, 580, 0), bd('Lakeshore Hotels', 7.5 * M, 440, 0.06, 0.8)],
  state: [bd('TX', 19.5 * M, 1_100, 0.12), bd('FL', 15.9 * M, 880, 0.04), bd('GA', 12 * M, 690, -0.05), bd('AZ', 9.8 * M, 540, 0), bd('NC', 8.1 * M, 470, 0.09), bd('OH', 6.6 * M, 370, -0.03)],
  product: [bd('Strategy advisory', 23.4 * M, 1_300, 0.06, 0.9), bd('Implementation projects', 26.8 * M, 580, 0.12, 0.82), bd('Managed services', 14.6 * M, 1_950, -0.04, 0.94), bd('Training', 8.9 * M, 520, 0, 0.88), bd('Audits and reviews', 6.3 * M, 150, 0.15, 0.86)],
}

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1)
}

/** Rows for a window: scaled to its month count, and a prior window (one ending before this month) is backed out by each row's delta. */
function breakdownFor(dim: BreakdownDim, line: string, start: string, end: string): BreakdownRow[] {
  const rows = BREAKDOWNS_12M[dim] ?? []
  const lineFactor = line === 'All' ? 1 : line === 'Advisory' ? 0.33 : line === 'Projects' ? 0.46 : 0.21
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

// The phone Home of a book-of-business version: the month so far from the same
// invented daily rows, and its top three lists scaled to that same total.
function sumDays(start: string, end: string) {
  let booked = 0, collected = 0, won = 0
  for (const r of MASTER_ROWS) {
    if (r.d < start || r.d > end) continue
    booked += r.premium
    collected += r.funded_premium ?? 0
    won += r.policies
  }
  return { booked, collected, won }
}
const MONTH_START = `${TODAY.slice(0, 8)}01`
const PHONE_BOOK: MonthToDate = (() => {
  const day = new Date(DEMO_DAY).getUTCDate()
  const priorStart = isoDay(monthsBack(1, Date.parse(`${MONTH_START}T00:00:00Z`)))
  const priorEnd = isoDay(Math.min(monthsBack(1), Date.parse(`${MONTH_START}T00:00:00Z`) - 86_400_000))
  const cur = sumDays(MONTH_START, TODAY)
  const prior = sumDays(priorStart, priorEnd)
  const monthName = new Date(DEMO_DAY).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' })
  const monthShort = new Date(DEMO_DAY).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' })
  const priorShort = new Date(monthsBack(1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' })
  return { premium: cur.booked, issued: cur.collected, policies: cur.won, monthName, monthShort, throughDay: day, dataThrough: TODAY, prior: { premium: prior.booked, issued: prior.collected, monthShort: priorShort } }
})()
const PHONE_TOPS: BookTopRows = (() => {
  const offices = breakdownFor('team', 'All', MONTH_START, TODAY)
  const f = PHONE_BOOK.premium / Math.max(1, offices.reduce((n, r) => n + r.premium, 0))
  const top = (dim: BreakdownDim) =>
    breakdownFor(dim, 'All', MONTH_START, TODAY)
      .map((r) => ({ label: r.label, premium: Math.round(r.premium * f), policies: Math.round(r.policies * f) }))
      .sort((a, b) => b.premium - a.premium)
      .slice(0, 3)
  return { team: top('team'), agent: top('agent'), carrier: top('carrier') }
})()

// Layout prefs as an executive's connected AI might leave them: untouched
// layout, one headline for the week, two notes for the team. The layout is
// never customised (updated_at null), so the default tile order and KPI row are
// what shows and nothing is pinned here.
const PREFS: DashboardPrefs = {
  version: 1,
  tiles: [],
  default_timeframe: 'ytd',
  pinned_kpis: [],
  pinned_breakdowns: [],
  hidden_sections: [],
  headline_note: 'Autumn is busy: Texas and Florida have two new projects starting, and the Halvorsen renewal is up next week.',
  notes: [
    { id: 'd1', text: 'Board pack goes out tomorrow night. Harbor Advisory gets its own line this month.', author: 'Andrew', created_at: new Date(dayOffset(-1) + 18 * 3_600_000).toISOString() },
    { id: 'd2', text: 'Hold the new training package until the pricing review on Monday.', author: ASSISTANT_NAME, created_at: new Date(DEMO_DAY + 13 * 3_600_000).toISOString() },
  ],
  updated_at: null,
  updated_by: null,
}

const TABLES = [
  { label: WORKSPACE, baseId: 'appNORTHGATE', names: ['Proposals', 'Engagements', 'Consultants', 'Clients'] },
  { label: 'Harbor Advisory', baseId: 'appHARBOR', names: ['Proposals', 'Engagements'] },
  { label: 'Summit Consulting', baseId: 'appSUMMIT', names: ['Proposals', 'Engagements'] },
]

// ════════════════════════════════════════════════════════════════════════
//  SHELL
// ════════════════════════════════════════════════════════════════════════

export default function CxoDemo({ version = 'today', edition = null }: {
  version?: PhoneHomeKind
  /** A client's own phone look over the sample data; set only on the local dev server (demoEdition). */
  edition?: PhoneVersionKey | null
}) {
  const [view, setView] = useState<View>('home')
  // Which phone version shows: /cxo/demo, or /cxo/demo?version=book for the
  // book-of-business one, under the demo's invented company (lib/phoneVersions).
  const pv = edition ? PHONE_VERSIONS[edition] : demoPhoneVersion(version, WORKSPACE)
  const approvals = useDemoApprovals()
  // A wider screen never draws a phone screen: it shows Revenue, as it always has.
  const desk: View = isPhoneView(view) ? 'overview' : view
  const tabOn = view === 'home' ? 'home' : view === 'calendar' ? 'calendar' : view === 'me' || view === 'integrations' || view === 'adoption' ? 'me' : 'work'
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
    <div data-app-shell className={['dash-shell', 'has-phone-bar', mobileOpen ? 'is-mobile-open' : ''].filter(Boolean).join(' ')} data-phone-version={pv.home} style={phoneVersionStyle(pv)} {...phoneShellAttrs(pv)}>
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
              { key: 'integrations', label: 'Integrations', icon: 'integrations', onClick: () => go('integrations'), active: desk === 'integrations' },
              { key: 'calendars', label: 'Calendar accounts', icon: 'calendar', onClick: () => go('calendar') },
              { key: 'adoption', label: 'Adoption', icon: 'performance', onClick: () => go('adoption'), active: desk === 'adoption' },
            ]}
          />
        ) : (
          <nav className="dash-sidebar-nav" aria-label="Sections">
            {NAV.map((t) => (
              <div key={t.key} className="dash-side-group">
                <button
                  type="button"
                  onClick={() => go(t.key)}
                  className={['dash-side-link', desk === t.key ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
                  aria-current={desk === t.key ? 'page' : undefined}
                >
                  <RailIcon name={t.icon} />
                  <span className="dash-side-label">{t.label}</span>
                </button>
              </div>
            ))}
          </nav>
        )}

        <RailFoot settingsOn={settingsOn} onSettings={() => setSettingsOn((v) => !v)} who="Andrew" role="Executive · demo" onSignOut={() => setSignOutNote(true)} />
      </aside>

      <main className="dash-main">
        {signOutNote && (
          <p className="cx-notice" style={{ margin: '12px 16px 0' }}>
            This is the demo, so there is nothing to sign out of.{' '}
            <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setSignOutNote(false)}>Dismiss</button>
          </p>
        )}
        <DemoPhoneStrip version={pv} />
        {view === 'overview' && <Overview />}
        {isPhoneView(view) && <div className="cxph-hide"><Overview /></div>}
        {view === 'home' && <DemoPhoneHome version={pv} book={PHONE_BOOK} tops={PHONE_TOPS} waiting={approvals.waiting} meetings={TODAY_MEETINGS.length} dateLabel={longDay(DEMO_DAY)} />}
        {view === 'work' && <DemoPhoneWork version={pv} waiting={approvals.waiting} />}
        {view === 'approvals' && <DemoPhoneApprovals version={pv} state={approvals} />}
        {view === 'me' && <DemoPhoneMe version={pv} bookName={WORKSPACE} />}
        {view === 'team' && <Team />}
        {view === 'calendar' && <Calendar />}
        {view === 'meetings' && <Meetings />}
        {view === 'partners' && <DemoPartners />}
        {view === 'employees' && <DemoPeople />}
        {view === 'integrations' && <Integrations />}
        {view === 'adoption' && <Adoption />}
        <MiraBar mode="demo" firstName="Andrew" canned={CANNED} answer={demoAnswer} placeholder={`Ask ${ASSISTANT_NAME} about the numbers or a meeting`} queueStarter queueDemo={DEMO_QUEUE} />
      </main>

      {/* The phone's tab bar (drawn at phone width only): same component as the signed-in product, on the demo's own links. */}
      <PhoneTabBar
        pathname=""
        inboxHref={null}
        approvalsOn
        assistantName={pv.assistantName}
        hasAssistant
        demo={{ on: tabOn, home: '#home', work: '#work', calendar: '#calendar', me: '#me', waiting: approvals.waiting }}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  1 · OVERVIEW
// ════════════════════════════════════════════════════════════════════════

function Overview() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Good morning, Andrew" title="Revenue" subtitle={PREFS.headline_note} />
      <ExecOverview
        variant="home"
        orgName={ORG_SHORT}
        pinnacleRows={MASTER_ROWS}
        statusRows={DATA.status}
        books={BOOKS}
        breakdowns={BREAKDOWNS}
        loadBreakdown={loadBreakdownDemo}
        lastSynced="12 minutes ago"
        now={TODAY}
        performanceHref="#team"
        reconciled
        words={WORDS}
        prefs={{ ...PREFS, headline_note: null, hidden_sections: ['breakdowns'] }}
      />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  2 · TEAM — offices, their consultants, where engagements stand
// ════════════════════════════════════════════════════════════════════════

function Team() {
  return (
    <main className="wrap">
      <PageHeader eyebrow="Team" title="People and offices" subtitle="Each office and its consultants, ranked on delivered work." />
      <ExecOverview
        variant="full"
        orgName={ORG_SHORT}
        pinnacleRows={MASTER_ROWS}
        statusRows={DATA.status}
        books={BOOKS}
        breakdowns={BREAKDOWNS}
        loadBreakdown={loadBreakdownDemo}
        lastSynced="12 minutes ago"
        now={TODAY}
        tables={TABLES}
        performanceHref="#team"
        reconciled
        words={WORDS}
      />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  4 · CALENDAR — two accounts, three calendars, merged week
// ════════════════════════════════════════════════════════════════════════

type DemoCal = { key: string; label: string; account: string; color: string }
const CALS: DemoCal[] = [
  { key: 'work', label: ORG_SHORT, account: 'andrew@northgate.example', color: 'var(--cx-chart-1)' },
  { key: 'board', label: 'Board', account: 'andrew@northgate.example', color: 'var(--cx-chart-ref)' },
  { key: 'personal', label: 'Personal', account: 'andrew@halloran.example', color: 'var(--cx-chart-3)' },
]
const ACCOUNTS = Array.from(new Set(CALS.map((c) => c.account)))

type DemoEvent = { id: string; day: number; start: string; end: string; summary: string; cal: string; allDay?: boolean }
// day = offset from Monday of this week (./demoClock WEEK).
const EVENTS: DemoEvent[] = [
  { id: 'e1', day: 0, start: '08:30', end: '09:00', summary: `Monday numbers with ${ASSISTANT_NAME}`, cal: 'work' },
  { id: 'e2', day: 0, start: '10:00', end: '11:00', summary: 'Southeast team lead 1:1s', cal: 'work' },
  { id: 'e3', day: 0, start: '16:00', end: '17:00', summary: 'Client review: Halvorsen Logistics', cal: 'work' },
  { id: 'e4', day: 1, start: '09:00', end: '10:30', summary: 'Autumn project staffing: planning', cal: 'work' },
  { id: 'e5', day: 1, start: '12:00', end: '13:00', summary: 'Lunch with Marcus Lee', cal: 'work' },
  { id: 'e6', day: 1, start: '18:30', end: '20:00', summary: 'Soccer: Ava', cal: 'personal' },
  { id: 'e7', day: 2, start: '08:00', end: '09:00', summary: 'Harbor Advisory weekly', cal: 'work' },
  { id: 'e8', day: 2, start: '14:00', end: '15:30', summary: 'Board prep: monthly pack', cal: 'board' },
  { id: 'e9', day: 3, start: '09:00', end: '09:30', summary: `${ASSISTANT_NAME}: what moved this week`, cal: 'work' },
  { id: 'e10', day: 3, start: '11:00', end: '12:00', summary: 'Pricing review: training package', cal: 'work' },
  { id: 'e11', day: 3, start: '15:00', end: '16:00', summary: 'Northgate Group executive sync', cal: 'work' },
  { id: 'e12', day: 3, start: '17:30', end: '18:30', summary: 'Dentist', cal: 'personal' },
  { id: 'e13', day: 4, start: '10:00', end: '12:00', summary: 'Board meeting', cal: 'board' },
  { id: 'e14', day: 4, start: '13:00', end: '13:30', summary: 'Summit Consulting check-in', cal: 'work' },
  { id: 'e15', day: 5, start: '', end: '', summary: 'Lake weekend', cal: 'personal', allDay: true },
  { id: 'e16', day: 6, start: '', end: '', summary: 'Lake weekend', cal: 'personal', allDay: true },
]
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEK_DATES = WEEK.map((t) => new Date(t).getUTCDate())

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
          sentence={`Connect your calendar and today and this week sit right here, with ${ASSISTANT_NAME} learning from every meeting.`}
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
        subtitle="Every calendar you connected, in one view."
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
          <strong style={{ fontFamily: 'var(--font-lora), serif', fontSize: 18 }}>{weekLabel()}</strong>
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
          <p className="cx-takeaway">Month view shows the same calendars across the month. Switch back to Week to see the merged week.</p>
        ) : (
          <div className={mode === 'day' ? undefined : 'cx-demo-week'} style={{ display: 'grid', gridTemplateColumns: mode === 'day' ? '1fr' : undefined, gap: 4 }}>
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
const at = (days: number, h: number, m = 0) => `${shortDay(dayOffset(days))}, ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
const NOTES: Note[] = [
  {
    id: 'n1', when: at(0, 9), dur: '28 min', title: `${ASSISTANT_NAME}: what moved this week`,
    summary: 'Collected revenue is running 9% ahead of the same weeks last year. Projects carried the week; Advisory is quiet while two proposals wait on client sign-off. The Southeast collection rate slipped two points on one late invoice from Pinecrest Utilities.',
    items: ['Ask Dana for the Pinecrest invoice status by Friday', 'Hold the training package until the pricing review', 'Move the staffing review to next Tuesday'],
  },
  {
    id: 'n2', when: at(-1, 14), dur: '1h 24m', title: 'Board prep: monthly pack',
    summary: 'Walked the board pack. Year to date is up on last year with Projects leading the mix. Agreed to show margin by office and to call out Harbor Advisory\'s growth as a separate line.',
    items: ['Add margin by office to the pack', 'Break out Harbor Advisory on page 3', 'Send the pack tomorrow night'],
  },
  {
    id: 'n3', when: at(-1, 8), dur: '41 min', title: 'Harbor Advisory weekly',
    summary: 'Harbor had its best month this year. Two new consultants started in Georgia. They want the same Monday numbers email the Northgate team gets.',
    items: ['Turn on the Monday numbers email for Harbor', 'Pair Harbor\'s new consultants with Marcus for their first client visits'],
  },
  {
    id: 'n4', when: at(-2, 9), dur: '1h 12m', title: 'Autumn project staffing: planning',
    summary: 'Staffing plan locked: Texas and Florida take the two new implementation projects, Mountain West covers the audit work. One senior hire to open in Texas.',
    items: ['Open the senior consultant role in Texas', 'Weekly staffing check on Thursdays'],
  },
  {
    id: 'n5', when: at(-3, 16), dur: '36 min', title: 'Client review: Halvorsen Logistics',
    summary: 'Still the biggest client by collected revenue. Projects are on schedule and invoices are paid within 30 days. They want a proposal for a second warehouse rollout next quarter.',
    items: ['Draft the second-warehouse proposal with the Southeast team'],
  },
]

const TODAY_MEETINGS: Array<{ time: string; title: string; who: string; status: 'recorded' | 'recording' | 'missing' }> = [
  { time: '8:00am', title: 'Monday numbers with the office leads', who: '6 people', status: 'recorded' },
  { time: '9:30am', title: 'Ridgeline Partners · referral review', who: '3 people', status: 'recording' },
  { time: '1:00pm', title: 'Harbor Advisory quarterly', who: '4 people', status: 'missing' },
  { time: '3:30pm', title: 'Project staffing budget', who: '5 people', status: 'missing' },
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
        title="Meetings"
        subtitle={`Every meeting's recording and notes, read by ${ASSISTANT_NAME}.`}
        actions={<NoteTakerConnect demo inHeader inboxReady={connected} zapierUrl="https://www.suitecxo.com/api/meetings/inbound/your-private-token" />}
      />
      {!connected ? (
        <>
          <ConnectState kind="recordings" sentence={`No meetings yet. Connect your note-taker and every call lands here for ${ASSISTANT_NAME}.`} button="Connect" href="#integrations" />
          <p className="cx-takeaway" style={{ marginTop: 14 }}>
            Demo: <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setConnected(true)}>simulate connected meetings →</button>
          </p>
        </>
      ) : (
        <div className="cx-grid">
          <section className="cx-panel">
            <div className="cx-eyebrow">Today · {longDay(DEMO_DAY)}</div>
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

// Invented people and numbers, run through the same builder as the real page.
const ADOPTION = demoAdoption(TODAY)

function Adoption() {
  return (
    <main className="wrap">
      <PageHeader title="Adoption" subtitle="Who is using the suite, and who needs a nudge." />
      <AdoptionView data={ADOPTION} />
    </main>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  MIRA — present, canned, inert
// ════════════════════════════════════════════════════════════════════════

// The report and booking answers count from today, like the live product.
const RANGE_3 = `${shortDate(monthsBack(3) + 86_400_000)} – ${shortDate(DEMO_DAY)}`
const RANGE_6 = `${shortDate(monthsBack(6) + 86_400_000)} – ${shortDate(DEMO_DAY)}`
const NEXT_MON = dayOffset(7 - TODAY_IDX)
const SLOT = (n: number) => shortDay(NEXT_MON + n * 86_400_000)
const REPORT_SUBJECT = 'Northgate Group numbers — Advisory trailing 3 months, Projects trailing 6 months'

const CANNED: Array<{ q: string; a: string }> = [
  { q: 'How is the year going?', a: 'Year to date you have collected more than at this point last year, and this month is running ahead of the same month last year. At this pace the year lands above last year\'s total. Projects are the engine; Advisory is waiting on two client sign-offs.' },
  { q: 'What moved this week?', a: 'Three things. The Southeast collection rate slipped two points on one late Pinecrest invoice. Harbor Advisory posted its best month this year. Two new implementation projects were staffed in Texas and Florida on Tuesday.' },
  { q: 'Send Dana the advisory numbers for the last 3 months and projects for the last 6', a: `Drafted for Dana Whitfield (Ridgeline Partners), subject "${REPORT_SUBJECT}". Advisory collected, the last 3 months (${RANGE_3}): $6.1M across 312 engagements, up 9%. Projects collected, the last 6 months (${RANGE_6}): $13.9M across 288 engagements, up 10%. Data through ${shortDate(DEMO_DAY)}. It is saved on her card; say "send it" and it goes from Suite CXO mail, with replies to you.` },
  { q: 'Book 30 minutes with Marcus Bell next week', a: `Open across all three calendars: ${SLOT(1)} 10:00, ${SLOT(2)} 2:00, ${SLOT(3)} 11:00 (Central). Which one? I will put it on your primary calendar with a Meet link and send Marcus the invite.` },
  { q: 'What came up on a call?', a: 'In board prep yesterday you agreed to add margin by office and break out Harbor Advisory. Halvorsen Logistics wants a proposal for a second warehouse rollout next quarter; the Southeast team is drafting it.' },
]

/** Looser demo matches after an exact starter: the Partners send/book flow. */
function demoAnswer(q: string): string | null {
  const lower = q.toLowerCase()
  if (/^send (it|that|the draft)/.test(lower)) return `Sending to Dana Whitfield, subject "${REPORT_SUBJECT}". Sent from Suite CXO mail, with replies to you, and logged on her card.`
  if (/send .*(revenue|report|numbers)/.test(lower)) return CANNED[2].a
  if (/(book|schedule|find).*(minutes|call|time|meeting)/.test(lower)) return CANNED[3].a
  if (/^(mon|tue|wed|thu|fri|the (first|second|third)|10|2|11)/.test(lower)) return `Booked. Northgate × Harbor Advisory: Andrew / Marcus — ${SLOT(1)}, 10:00–10:30 Central, on your primary calendar, Meet link added, invite sent to Marcus.`
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
