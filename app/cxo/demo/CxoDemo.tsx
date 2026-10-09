'use client'

import { useEffect, useRef, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import ExecOverview, { type BookInput, type BreakdownMap } from '@/app/components/cxo/ExecOverview'
import ConnectState from '@/app/components/cxo/ConnectState'
import { MiraOrb } from '@/app/components/mira/MiraOrb'
import CxoReports from '@/app/dashboard/analytics/CxoReports'
import { IntegrationAccordion } from '@/app/dashboard/integrations/IntegrationAccordion'
import type { BreakdownDim, BreakdownRow, DailyRow, StatusRow } from '@/lib/pinnacle/rollup'

/*
  CXO Suite — public demo of the executive suite.

  The SAME components the signed-in product renders (ExecOverview, CxoReports,
  ConnectState, the calendar grid markup, the recordings cards, the
  Integrations accordions) fed invented data shaped exactly like the rollup
  rows (DailyRow / StatusRow / BreakdownRow). No auth, no network, nothing
  persisted. "Today" is pinned so the numbers never drift.

  Six pages, the same six the real left rail shows for an executive seat:
  Overview · Performance · Reports · Calendar · Recordings · Integrations.
  Mira is present on every page but canned and inert.
*/

const CXO_LOGO =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png'

const TODAY = '2026-10-08'
const WORKSPACE = 'Pinnacle Life Group'

type View = 'overview' | 'performance' | 'reports' | 'calendar' | 'recordings' | 'integrations'

const NAV: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'performance', label: 'Performance' },
  { key: 'reports', label: 'Reports' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'integrations', label: 'Integrations' },
]

function viewFromHash(): View {
  if (typeof window === 'undefined') return 'overview'
  const h = window.location.hash.replace('#', '')
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
  Health: { premium: 61_000, avg: 2_900, growth: 0.31 },
  Life: { premium: 44_000, avg: 4_100, growth: 0.22 },
  Annuity: { premium: 27_000, avg: 38_000, growth: 0.48 },
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
        <span className="dash-mobilebar-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CXO_LOGO} alt="CXO Suite" />
        </span>
      </div>
      <div className="dash-scrim" onClick={() => setMobileOpen(false)} aria-hidden />

      <aside className="dash-sidebar" aria-label="Dashboard navigation">
        <div className="dash-sidebar-head">
          <span className="dash-sidebar-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CXO_LOGO} alt="CXO Suite" />
          </span>
          <span
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--red, #FF2800)', border: '1px solid var(--red, #FF2800)', borderRadius: 999, padding: '3px 8px',
            }}
          >
            Demo
          </span>
        </div>
        <div className="dash-workspace"><small>Executive suite</small>{WORKSPACE}</div>

        <nav className="dash-sidebar-nav" aria-label="Sections">
          {NAV.map((t) => (
            <div key={t.key} className="dash-side-group">
              <button
                type="button"
                onClick={() => go(t.key)}
                className={['dash-side-link', view === t.key ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
                aria-current={view === t.key ? 'page' : undefined}
              >
                <span className="dash-side-label">{t.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot">
          <a href="/cxo" className="dash-side-link dash-side-muted">
            <span className="dash-side-label">← Back to site</span>
          </a>
          <a href="/cxo#contact" className="dash-side-link dash-side-upgrade">
            <span className="dash-side-label">Get your seat →</span>
          </a>
        </div>
      </aside>

      <main className="dash-main">
        {view === 'overview' && <Overview />}
        {view === 'performance' && <Performance />}
        {view === 'reports' && <Reports />}
        {view === 'calendar' && <Calendar />}
        {view === 'recordings' && <Recordings />}
        {view === 'integrations' && <Integrations />}
      </main>

      <DemoMira view={view} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  1 · OVERVIEW
// ════════════════════════════════════════════════════════════════════════

function Overview() {
  return (
    <main className="wrap">
      <PageHeader eyebrow={WORKSPACE} title="Good morning, Spencer" subtitle="Where the book stands today, and which way it is moving." />
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
      <PageHeader eyebrow="Performance" title="The book of business" subtitle="Three months, six months, the year. Every line, every book, who is driving it." />
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
      <PageHeader eyebrow="Reports" title="The numbers, period by period" subtitle="Each period against the same period last year." />
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
            <button type="button" className="cx-btn cx-btn-ghost" onClick={() => setNotice('In the live product this opens Google with "choose an account". Microsoft 365 is on the way.')}>
              + Add another calendar
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

function Recordings() {
  const [connected, setConnected] = useState(true)
  return (
    <main className="wrap">
      <PageHeader eyebrow="Recordings" title="Meetings" subtitle={connected ? 'Every transcript and note Mira has learned from, newest first.' : undefined} />
      {!connected ? (
        <>
          <ConnectState kind="recordings" sentence="Put Wispr Flow on every executive's computer and Mira learns from every meeting." button="Connect" href="#integrations" />
          <p className="cx-takeaway" style={{ marginTop: 14 }}>
            Demo: <button type="button" className="cx-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setConnected(true)}>simulate connected recordings →</button>
          </p>
        </>
      ) : (
        <div className="cx-grid">
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
//  6 · INTEGRATIONS
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
          <button type="button" className="cx-btn cx-btn-ghost">+ Add another calendar</button>
        </IntegrationAccordion>

        <IntegrationAccordion title="Recordings" status="Wispr Flow on 4 computers" statusOk>
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>Meeting notes and transcripts land on Recordings and Mira learns from each one.</p>
          <a href="#recordings" className="cx-link">Open Recordings →</a>
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

type Msg = { role: 'user' | 'assistant'; text: string }

const CANNED: Array<{ q: string; a: string }> = [
  { q: 'How is the book pacing?', a: 'Year to date you have issued more than this point last year, and October is running ahead of last October. At this pace the year lands above last year\'s total. Health is the engine; Life is the mix shift; Annuity is waiting on the Athene update.' },
  { q: 'What moved this week?', a: 'Three things. Southeast placement slipped two points on Foresters declines. Harbor Financial posted its best September. The Q4 enrollment budget moved to Texas and Florida on Tuesday.' },
  { q: 'What came up on a call?', a: 'In board prep yesterday you agreed to add cost per issued policy by team and break out Harbor Financial. Mutual of Omaha is opening a simplified-issue product in November; the Southeast team is the pilot.' },
]

function DemoMira({ view }: { view: View }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const thread = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight })
  }, [msgs, busy])

  function send(q: string) {
    const hit = CANNED.find((c) => c.q === q)
    const answer = hit?.a ?? `In the live product I answer that from ${view === 'calendar' || view === 'recordings' ? 'your meetings' : 'your numbers'}. In the demo, try one of the questions above.`
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    setDraft('')
    window.setTimeout(() => {
      setMsgs((m) => [...m, { role: 'assistant', text: answer }])
      setBusy(false)
    }, 700)
  }

  return (
    <div className="mira-dock" data-open={open || undefined}>
      {open ? (
        <section className="mira-dock__panel" role="dialog" aria-label="Mira" aria-modal={false}>
          <header className="mira-dock__head">
            <MiraOrb state={busy ? 'thinking' : 'idle'} size={36} decorative />
            <div className="mira-dock__title">
              <span className="mira-dock__name">Mira</span>
              <span className="mira-dock__sub">Your numbers and your meetings</span>
            </div>
            <button type="button" className="mira-dock__close" onClick={() => setOpen(false)} aria-label="Close Mira">×</button>
          </header>
          <div className="mira-dock__thread" ref={thread} aria-live="polite">
            {msgs.length === 0 && (
              <div className="mira-dock__greet">
                <p>Morning, Spencer. I answer from your numbers and your meetings. Ask me how the book is pacing, what moved, or what came up on a call.</p>
                <div className="mira-chips" style={{ justifyContent: 'center', marginTop: 12 }}>
                  {CANNED.map((c) => (
                    <button key={c.q} type="button" className="mira-chip" onClick={() => send(c.q)} disabled={busy}>{c.q}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`mira-msg mira-msg--${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="mira-msg mira-msg--assistant mira-msg--thinking">Reading the book…</div>}
            {msgs.length > 0 && !busy && (
              <div className="mira-chips" style={{ marginTop: 8 }}>
                {CANNED.filter((c) => !msgs.some((m) => m.text === c.q)).map((c) => (
                  <button key={c.q} type="button" className="mira-chip" onClick={() => send(c.q)}>{c.q}</button>
                ))}
              </div>
            )}
          </div>
          <form
            className="mira-dock__compose"
            onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send(draft.trim()) }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Mira" aria-label="Ask Mira" disabled={busy} />
            <button type="submit" className="cx-btn" disabled={busy || !draft.trim()}>Ask</button>
          </form>
        </section>
      ) : (
        <button type="button" className="mira-dock__fab" onClick={() => setOpen(true)} aria-label="Ask Mira" title="Ask Mira">
          <span className="mira-dock__fab-label" aria-hidden>Ask Mira</span>
          <span className="mira-dock__fab-orb"><MiraOrb state="idle" size={44} decorative /></span>
        </button>
      )}
    </div>
  )
}
