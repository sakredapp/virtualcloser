/**
 * Product pictures for the Suite CXO marketing site.
 *
 * Owner rule: mockups match the real product. Every piece below is the real
 * app's markup and class names (MiraBar's open panel, Today's To do and
 * Messages cards, a Boards column, the Settings usage line and table),
 * filled with sample data. The real CSS styles them: mira-bar.css plus the
 * --cx-* token block in globals.css (body:has(.cx-site) opts in). Static:
 * nothing here fetches, saves or sends.
 */
import { MiraOrb } from '@/app/components/mira/MiraOrb'
import { KindIcon, type AnyKind } from '@/app/dashboard/today/kinds'
import '@/app/components/cxo/mira-bar.css'
import '@/app/dashboard/cxo-alerts.css'

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="cxs-frame">
      <figcaption className="cxs-frame-cap">
        <span>{label}</span>
        <span className="cxs-frame-sample">Sample data</span>
      </figcaption>
      <div className="cxs-frame-body">{children}</div>
    </figure>
  )
}

/** MiraBar, open: header, the question (muted), the answer, choice chips, the bar. */
export function AskMock({ name }: { name: string }) {
  return (
    <Frame label={`Ask ${name}`}>
      <div className="cx-dock cxs-dock" aria-label={`${name}, sample conversation`}>
        <section className="cx-dock__ans">
          <header>
            <span>{name}</span>
            <span className="cx-dock__close" aria-hidden="true">×</span>
          </header>
          <div className="cx-dock__body">
            <p className="cx-dock__q">What&rsquo;s on my calendar tomorrow, and who is waiting on me?</p>
            <div className="cx-dock__a">
              <p>Tomorrow you have 3 meetings:</p>
              <ul>
                <li>9:00am Leadership sync</li>
                <li>11:30am Budget review with Dana</li>
                <li>2:00pm Interview, operations lead</li>
              </ul>
              <p>2 emails need a reply: Dana asked for the Q4 plan, and Marcus asked to move Thursday&rsquo;s call.</p>
              <p>Want me to draft both replies?</p>
            </div>
            <div className="cx-dock__chips" role="group" aria-label="Choices">
              <span className="cx-dock__chip">Draft both replies</span>
              <span className="cx-dock__chip">Just Dana</span>
              <span className="cx-dock__chip">Not now</span>
            </div>
          </div>
        </section>
        <div className="cx-dock__bar">
          <MiraOrb className="cx-dock__orb" size={26} decorative title={name} />
          <span className="cx-dock__input cxs-placeholder">Ask {name}</span>
          <span className="cx-dock__mic" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
              <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
            </svg>
          </span>
        </div>
      </div>
    </Frame>
  )
}

type TodoRow = { kind: AnyKind; title: string; src: string; byAssistant?: boolean; due?: string; late?: boolean; act?: string; high?: boolean }

const TODOS: TodoRow[] = [
  { kind: 'email', title: 'Send Dana the Q4 plan', src: 'from: Leadership sync, Oct 6', byAssistant: true, due: 'Overdue', late: true, act: 'Draft email', high: true },
  { kind: 'call', title: 'Call Marcus about Thursday', src: 'from: Marcus Lee', act: 'Call' },
  { kind: 'prep', title: 'Prep for the budget review', src: 'from: Calendar · 11:30am', act: 'Open event' },
  { kind: 'task', title: 'Sign off on the hiring plan', src: 'from: Priya Shah · asked in Messages', due: 'Fri' },
]

/** Today: the To do card and the Messages card with the morning brief. */
export function TodayMock({ name }: { name: string }) {
  return (
    <Frame label="Today">
      <div className="cx-today-pair cxs-today">
        <section className="cx-todo" aria-label="To do, sample">
          <header className="cx-todo-head">
            <h2>
              To do <span>{TODOS.length}</span>
            </h2>
            <div className="cx-todo-head-actions">
              <span className="cx-btn cx-btn-ghost cx-btn-sm">Ask {name}</span>
            </div>
          </header>
          <ul className="cx-todo-rows">
            {TODOS.map((t) => (
              <li key={t.title} className="cx-todo-row">
                <input type="checkbox" readOnly checked={false} tabIndex={-1} aria-label={`Done: ${t.title}`} />
                <span className="cx-todo-kind is-static">
                  <KindIcon kind={t.kind} />
                </span>
                <div className="cx-todo-main">
                  <p className="cx-todo-title">
                    {t.high && <i className="cx-dot" aria-label="High priority" />}
                    {t.title}
                  </p>
                  <p className="cx-todo-src">{t.byAssistant ? `${t.src} · ${name}` : t.src}</p>
                </div>
                <div className="cx-todo-side">
                  {t.due && <span className={`cx-todo-due cx-todo-tag${t.late ? ' is-late' : ''}`}>{t.due}</span>}
                  {t.act && <span className="cx-todo-act">{t.act}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="cx-todo cx-msgs" aria-label="Messages, sample">
          <header className="cx-todo-head">
            <h2>
              Messages<span>2</span>
            </h2>
          </header>
          <div className="cx-brief" role="note">
            <p className="cx-brief-head">{name} · morning brief</p>
            <p className="cx-brief-line">3 meetings today, 2 emails need a reply.</p>
            <p className="cx-brief-line">1 to-do is overdue: Send Dana the Q4 plan.</p>
          </div>
          <ul className="cx-todo-rows">
            <li className="cx-msg">
              <p className="cx-msg-meta">
                <strong>Priya Shah</strong>
                <span className="cx-msg-tag">Request</span>
                <span className="cx-msg-time">8:42am</span>
              </p>
              <p className="cx-msg-body">Can you sign off on the hiring plan by Friday?</p>
              <p className="cx-msg-note">On your to-do list</p>
            </li>
            <li className="cx-msg">
              <p className="cx-msg-meta">
                <strong>Jordan Ruiz</strong>
                <span className="cx-msg-tag">Question</span>
                <span className="cx-msg-time">9:05am</span>
              </p>
              <p className="cx-msg-body">Is the vendor review still on for Monday?</p>
            </li>
          </ul>
        </section>
      </div>
    </Frame>
  )
}

type Card = { title: string; who: string[]; due?: string; late?: boolean; tags?: string[] }
const LISTS: Array<{ title: string; cards: Card[] }> = [
  {
    title: 'To do',
    cards: [
      { title: 'Draft the onboarding checklist', who: ['PS'], due: 'Oct 14', tags: ['People'] },
      { title: 'Collect vendor quotes', who: ['JR', 'DK'], due: 'Oct 9', late: true },
    ],
  },
  {
    title: 'Doing',
    cards: [
      { title: 'Q4 plan for the leadership team', who: ['DK'], due: 'Oct 12', tags: ['Plan'] },
      { title: 'Hire an operations lead', who: ['PS', 'ML'] },
    ],
  },
  { title: 'Done', cards: [{ title: 'Move payroll to the new calendar', who: ['ML'] }] },
]

/** A board: lists of cards with due dates and the people on them. */
export function BoardMock() {
  return (
    <Frame label="Boards · Operations">
      <div className="cx-board-cols cxs-board">
        {LISTS.map((l) => (
          <section key={l.title} className="cx-board-col">
            <header className="cx-board-col-head">
              <h3 className="cx-board-col-name">{l.title}</h3>
              <span className="cx-board-count">{l.cards.length}</span>
            </header>
            <div className="cx-board-cards">
              {l.cards.map((c) => (
                <article key={c.title} className={`cx-board-card${l.title === 'Done' ? ' is-done' : ''}`}>
                  <p className="cx-board-card-title">{c.title}</p>
                  {c.tags && (
                    <p className="cx-board-tags">
                      {c.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </p>
                  )}
                  <div className="cx-board-card-meta">
                    {c.due && <span className={`cx-board-due${c.late ? ' is-late' : ''}`}>{c.late ? 'Overdue · ' : 'Due '}{c.due}</span>}
                    <span className="cx-board-people">
                      {c.who.map((w) => (
                        <span key={w}>
                          <b className="cx-board-av" style={{ width: 22, height: 22, fontSize: 10 }} aria-hidden="true">
                            {w}
                          </b>
                        </span>
                      ))}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Frame>
  )
}

const USAGE = [
  { name: 'Dana Kim', role: 'Owner', mira: 412 },
  { name: 'Priya Shah', role: 'Manager', mira: 655 },
  { name: 'Jordan Ruiz', role: 'Employee', mira: 138 },
  { name: 'Marcus Lee', role: 'Employee', mira: 0 },
]

/** Settings › Usage: the one pool line and the per-person column, as the app words it. */
export function UsageMock({ name }: { name: string }) {
  const used = USAGE.reduce((s, r) => s + r.mira, 0)
  const people = USAGE.length
  return (
    <Frame label="Settings · Usage">
      <div className="cx-todo cxs-usage">
        <p className="cxs-usage-line">
          <strong>
            {name} this month: {used.toLocaleString('en-US')} of {(people * 500).toLocaleString('en-US')} questions
          </strong>{' '}
          · one shared pool ({people} people × 500). Anyone can use it, nobody is capped.
        </p>
        <div className="cx-usage-scroll">
          <table className="cx-table cx-usage">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th className="num">{name} this month</th>
              </tr>
            </thead>
            <tbody>
              {USAGE.map((r) => (
                <tr key={r.name}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.role}</td>
                  <td className="num">{r.mira}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Frame>
  )
}
