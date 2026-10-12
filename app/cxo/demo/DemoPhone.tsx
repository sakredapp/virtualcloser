'use client'

/**
 * The phone layout on the public demo. The SAME phone components the
 * signed-in product renders (PhoneHome, PhoneApprovals, PhoneMe, the tab bar
 * in CxoDemo), fed invented sample data and held in memory. No sign-in, no
 * request, nothing saved, no tenant read. Phone width only (.cxph-only); a
 * wider screen never sees any of it.
 *
 * Which version shows is the same lib/phoneVersions entry the product uses:
 * /cxo/demo is Suite CXO, /cxo/demo?version=pinnacle is the book-of-business
 * version. Both are sample data and say so on every screen.
 */
import { useState } from 'react'
import RailIcon, { railIconFor } from '@/app/components/cxo/RailIcon'
import PhoneHome from '@/app/components/cxo/phone/PhoneHome'
import PhoneApprovals, { type PhonePending, type PhonePlaud } from '@/app/components/cxo/phone/PhoneApprovals'
import PhoneMe from '@/app/components/cxo/phone/PhoneMe'
import PhonePane from '@/app/components/cxo/phone/PhonePane'
import PhoneApprovalsCard from '@/app/components/cxo/phone/PhoneApprovalsCard'
import type { BookTopRows } from '@/app/components/cxo/phone/PhoneBookTops'
import { orderWork, type PhoneVersion } from '@/lib/phoneVersions'
import type { MonthToDate } from '@/lib/pinnacle/cache'

export type DemoPhoneView = 'home' | 'work' | 'inbox' | 'me' | 'approvals'
export const DEMO_PHONE_VIEWS: DemoPhoneView[] = ['home', 'work', 'inbox', 'me', 'approvals']

const WHO = 'Michael'

/** Says on every phone screen that this is the demo. */
export function DemoPhoneStrip({ version }: { version: PhoneVersion }) {
  return (
    <p
      className="cxph-only"
      style={{ margin: 0, padding: '8px 16px', textAlign: 'center', font: '600 11px/1.3 var(--cx-sans)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--cx-muted)', borderBottom: '1px solid var(--cx-hairline)' }}
    >
      Demo · sample data · {version.appName} version
    </p>
  )
}

// ── Sample to-dos (the action items of the demo's own invented meetings) ──
const TODOS: Array<{ id: string; text: string; from: string; due: string; overdue?: boolean }> = [
  { id: 't1', text: 'Ask Dana for the Foresters decline reasons', from: 'What moved this week', due: 'Due yesterday', overdue: true },
  { id: 't2', text: 'Add cost per issued policy by team to the board pack', from: 'Board prep', due: 'Due Tuesday', overdue: true },
  { id: 't3', text: 'Send the board pack', from: 'Board prep', due: 'Tonight' },
  { id: 't4', text: 'Turn on the Monday numbers email for Harbor Financial', from: 'Harbor Financial weekly', due: 'Friday' },
  { id: 't5', text: 'Move the Q4 enrollment review to next Tuesday', from: 'What moved this week', due: 'Friday' },
  { id: 't6', text: 'Weekly placement check', from: 'Q4 enrollment push', due: 'Today' },
  { id: 't7', text: 'Pilot the simplified-issue product with the Southeast team', from: 'Carrier review', due: 'November' },
]

// ── Sample email ──────────────────────────────────────────────────────────
type Mail = { id: string; from: string; subject: string; line: string; when: string; box: 'reply' | 'all' | 'parked' }
const MAIL: Mail[] = [
  { id: 'e1', from: 'Dana Whitfield', subject: 'Foresters declines, September', line: 'Sending the decline reasons by team. Do you want them by product too?', when: '8:42 AM', box: 'reply' },
  { id: 'e2', from: 'Marcus Bell', subject: 'Harbor Financial quarterly at 1:00', line: 'Can we add ten minutes on the two new Georgia agents?', when: '8:05 AM', box: 'reply' },
  { id: 'e3', from: 'Nina Castell', subject: 'Board pack, page 3', line: 'Harbor is broken out as its own line. One question on the chart.', when: 'Yesterday', box: 'reply' },
  { id: 'e4', from: 'Athene', subject: 'Rate update effective Monday', line: 'The new rate sheet is attached for your annuity team.', when: 'Yesterday', box: 'all' },
  { id: 'e5', from: 'Jordan Pike', subject: 'Q4 enrollment budget', line: 'Texas and Florida are funded. Mountain West starts the referral play Monday.', when: 'Tue', box: 'all' },
  { id: 'e6', from: 'Summit Benefits', subject: 'November ride-along dates', line: 'Parked until the Athene update lands.', when: 'Mon', box: 'parked' },
]
export const DEMO_NEED_REPLY = MAIL.filter((m) => m.box === 'reply').length
export const DEMO_TODAY = { open: TODOS.length, overdue: TODOS.filter((t) => t.overdue).length }

// ── Sample approvals: the two real kinds (an outside send, a change to someone else's work) and one meeting-notes draft ──
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

export function useDemoApprovals() {
  const [pending, setPending] = useState<PhonePending[]>(() => [
    { id: 'a1', summary: 'Email Dana Whitfield at Mutual of Omaha the September decline reasons', reason: 'outside_send', status: 'pending', tool: 'send_email', requested_by: 'Jordan Pike', decided_by: null, decided_at: null, created_at: hoursAgo(2) },
    { id: 'a2', summary: 'Move Sam Okoro’s Harbor Financial follow-up to Monday', reason: 'others_work', status: 'pending', tool: 'update_task', requested_by: 'Nina Castell', decided_by: null, decided_at: null, created_at: hoursAgo(5) },
    { id: 'a3', summary: 'Send Harbor Financial the Monday numbers email', reason: 'outside_send', status: 'pending', tool: 'send_email', requested_by: 'Sam Okoro', decided_by: null, decided_at: null, created_at: hoursAgo(26) },
  ])
  const [plaud, setPlaud] = useState<PhonePlaud[]>(() => [
    { id: 'p1', kind: 'send_email', to: 'Marcus Bell', subject: 'Recap: Harbor Financial weekly', created_at: hoursAgo(3) },
  ])
  const [done, setDone] = useState<PhonePending[]>(() => [
    { id: 'a0', summary: 'Email the October board pack to the board list', reason: 'outside_send', status: 'executed', tool: 'send_email', requested_by: 'Nina Castell', decided_by: WHO, decided_at: hoursAgo(20), created_at: hoursAgo(22) },
  ])

  // Nothing is sent: the item only moves from Waiting to Done on this screen.
  const decide = (id: string, approve: boolean) => {
    const row = pending.find((p) => p.id === id)
    if (!row) return
    setPending((cur) => cur.filter((p) => p.id !== id))
    setDone((d) => [{ ...row, status: approve ? 'approved' : 'declined', decided_by: WHO, decided_at: new Date().toISOString() }, ...d.filter((x) => x.id !== id)])
  }
  const decidePlaud = (id: string, op: 'approve' | 'dismiss') => {
    const row = plaud.find((p) => p.id === id)
    if (!row) return
    setPlaud((cur) => cur.filter((p) => p.id !== id))
    setDone((d) => [{ id, summary: row.subject ?? 'Email', reason: 'outside_send', status: op === 'approve' ? 'approved' : 'declined', tool: row.kind, requested_by: 'your meeting notes', decided_by: WHO, decided_at: new Date().toISOString(), created_at: row.created_at }, ...d.filter((x) => x.id !== id)])
  }

  return { pending, plaud, done, decide, decidePlaud, waiting: pending.length + plaud.length }
}
export type DemoApprovals = ReturnType<typeof useDemoApprovals>

// ── Home ──────────────────────────────────────────────────────────────────
export function DemoPhoneHome({ version, book, tops, waiting, meetings, dateLabel }: { version: PhoneVersion; book: MonthToDate; tops: BookTopRows; waiting: number; meetings: number; dateLabel: string }) {
  return (
    <main className="wrap cxph-page cxph-only">
      <PhoneHome
        version={version}
        companyName={null}
        firstName={WHO}
        greeting="Good morning"
        dateLabel={dateLabel}
        today={{ ...DEMO_TODAY, meetings, needReply: DEMO_NEED_REPLY }}
        book={book}
        canSeeBook
        approvalsWaiting={waiting}
        inboxHref="#inbox"
        googleOn
        demo={{ approvalsHref: '#approvals', revenueHref: '#overview', tops }}
      />
      <div className="cxph cxph-only">
        <div className="cxph-card cxph-set">
          {TODOS.map((t) => (
            <div key={t.id} className="row">
              <span className="t">
                <b>{t.text}</b>
                <small>From {t.from}</small>
              </span>
              <span className={t.overdue ? 'cxph-tag due' : 'cxph-tag'}>{t.due}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

// ── Work ──────────────────────────────────────────────────────────────────
/** The demo's pages under the product's own addresses, so the version's Work order (lib/phoneVersions) applies as is. */
const WORK_PAGES: Array<{ href: string; hash: string; label: string; about: string }> = [
  { href: '/dashboard/approvals', hash: '#approvals', label: 'Approvals', about: 'What is waiting for your OK' },
  { href: '/dashboard/calendar', hash: '#calendar', label: 'Calendar', about: 'Your week and your calendar accounts' },
  { href: '/dashboard/meetings', hash: '#meetings', label: 'Meetings', about: 'Notes, recordings and follow-ups' },
  { href: '/dashboard/revenue', hash: '#overview', label: 'Revenue', about: 'The numbers, month to date' },
  { href: '/dashboard/pinnacle', hash: '#team', label: 'Team', about: 'Team performance and reports' },
  { href: '/dashboard/partners', hash: '#partners', label: 'Partners', about: 'Partners and what is open with each' },
  { href: '/dashboard/employees', hash: '#employees', label: 'Employees', about: 'People, seats and praise' },
]

export function DemoPhoneWork({ version, waiting }: { version: PhoneVersion; waiting: number }) {
  const pages = orderWork(WORK_PAGES, version)
  return (
    <main className="wrap cxph-page cxph-only">
      <div className="cxph cxph-work">
        <div className="cxph-title">
          <h2>Work</h2>
          <p>{waiting ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} your OK.` : 'Everything you run, in one list.'}</p>
        </div>
        <PhoneApprovalsCard href="#approvals" waiting={waiting} assistantName={version.assistantName} />
        <nav className="cxph-card cxph-set" aria-label="Work pages" style={{ marginTop: 4 }}>
          {pages.filter((t) => t.href !== '/dashboard/approvals').map((t) => {
            const icon = railIconFor(t.href)
            return (
              <a key={t.href} href={t.hash} className="row">
                <span className="ic" aria-hidden>
                  {icon ? <RailIcon name={icon} /> : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></svg>
                  )}
                </span>
                <span className="t">
                  <b>{t.label}</b>
                  <small>{t.about}</small>
                </span>
                <svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9.5 6 6 6-6 6" /></svg>
              </a>
            )
          })}
        </nav>
      </div>
    </main>
  )
}

// ── Approvals ─────────────────────────────────────────────────────────────
export function DemoPhoneApprovals({ version, state }: { version: PhoneVersion; state: DemoApprovals }) {
  return (
    <main className="wrap cxph-page cxph-only">
      <PhoneApprovals
        pending={state.pending}
        plaud={state.plaud}
        canApprove
        busy={null}
        err={null}
        assistantName={version.assistantName}
        onDecide={state.decide}
        onPlaud={state.decidePlaud}
        demoDone={state.done}
      />
    </main>
  )
}

// ── Inbox ─────────────────────────────────────────────────────────────────
export function DemoPhoneInbox({ version }: { version: PhoneVersion }) {
  const [box, setBox] = useState<Mail['box']>('reply')
  const rows = MAIL.filter((m) => (box === 'all' ? m.box !== 'parked' : m.box === box))
  const chip = (key: Mail['box'], label: string) => (
    <button type="button" className={box === key ? 'cxph-chip is-on' : 'cxph-chip'} aria-pressed={box === key} onClick={() => setBox(key)} style={{ border: 0, cursor: 'pointer' }}>
      {label}
    </button>
  )
  return (
    <main className="wrap cxph-page cxph-only">
      <div className="cxph">
        <div className="cxph-title">
          <h2>Inbox</h2>
          <p>{DEMO_NEED_REPLY} emails need a reply. {version.assistantName} can draft them.</p>
        </div>
        <nav className="cxph-chips" aria-label="Inbox views">
          {chip('reply', 'Needs reply')}
          {chip('all', 'All mail')}
          {chip('parked', 'Parked')}
        </nav>
        <div className="cxph-card cxph-set">
          {rows.map((m) => (
            <div key={m.id} className="row" style={{ alignItems: 'flex-start' }}>
              <span className="t">
                <b>{m.from}</b>
                <small style={{ color: 'var(--cx-ink)', fontWeight: 500 }}>{m.subject}</small>
                <small>{m.line}</small>
              </span>
              <span className="v">{m.when}</span>
            </div>
          ))}
        </div>
        <p className="cxph-conn">Sample email. Nothing here is read from a real mailbox.</p>
      </div>
    </main>
  )
}

// ── Me ────────────────────────────────────────────────────────────────────
const DEMO_PANES = [
  { id: 'reminders', title: 'Reminders', note: 'In the product, this page is where you choose when you hear about what is due. The demo has no account, so there is nothing to set here.' },
  { id: 'password', title: 'Password', note: 'In the product, this page is where you change your password. The demo has no account, so there is nothing to change here.' },
  { id: 'usage', title: 'Usage', note: 'In the product, this page shows how many questions your company has asked this month and who asked them. The demo keeps no count.' },
  { id: 'coadmins', title: 'Co-admins', note: 'In the product, this page is where you invite or remove people who can act on the account. The demo has no account to invite anyone to.' },
]
export function DemoPhoneMe({ version }: { version: PhoneVersion }) {
  const other = version.key === 'pinnacle' ? { href: '/cxo/demo#me', name: 'Suite CXO' } : { href: '/cxo/demo?version=pinnacle#me', name: 'Pinnacle Life Group' }
  return (
    <main className="wrap cxph-page cxph-only">
      <PhoneMe
        version={version}
        name={WHO}
        email="michael@example.com"
        role="executive"
        companyName={null}
        admin
        assistant={false}
        panes={{ reminders: true, password: true, usage: true, coadmins: true }}
        demo={{ integrations: '#integrations', calendar: '#calendar', adoption: '#adoption', signOut: '#me' }}
      />
      {/* The product opens its own Settings sections here. The demo has no account, so each page says so. */}
      {DEMO_PANES.map((p) => (
        <PhonePane key={p.id} id={p.id} title={p.title}>
          <div className="cxph">
            <div className="cxph-card" style={{ padding: 16 }}>
              <p style={{ font: '400 14px/1.5 var(--cx-sans)', color: 'var(--cx-muted)' }}>{p.note}</p>
            </div>
          </div>
        </PhonePane>
      ))}
      <div className="cxph cxph-me">
        <p className="cxph-sub">This demo</p>
        <div className="cxph-card cxph-set">
          <a href={other.href} className="row">
            <span className="t">
              <b>See the {other.name} version</b>
              <small>Same app, the other company&rsquo;s version</small>
            </span>
            <svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9.5 6 6 6-6 6" /></svg>
          </a>
        </div>
        <p className="cxph-conn">Sample data. There is no account here, so Sign out only asks and then does nothing.</p>
      </div>
    </main>
  )
}
