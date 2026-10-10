import type { Metadata } from 'next'
import Link from 'next/link'
import { getBrand } from '@/lib/brand'
import {
  CXO_BOOK_CALL_HREF,
  CXO_OVERAGE_BLOCK,
  CXO_OVERAGE_PRICE,
  CXO_PRICE_PER_PERSON,
  CXO_QUESTIONS_PER_PERSON,
  cxoCheckoutUrl,
} from '@/lib/cxoSite'
import { AskMock, BoardMock, TodayMock, UsageMock } from './SiteMocks'
import SeatCalculator from './SeatCalculator'
import './site.css'

// Middleware rewrites `/` on suitecxo.com to this route: the public page
// people see before signing in. Rules (owner 10-10): claim only what is
// built or being built, mockups are the real app components, the app's
// own black/silver look, plain short copy, phone first.
export const dynamic = 'force-dynamic'

const SITE_NAME = 'Suite CXO'

export const metadata: Metadata = {
  title: `${SITE_NAME} · Your CAIO, a Chief AI Officer for everyone`,
  description:
    'One AI assistant for your whole company, connected to your email, calendar, boards, meetings and numbers. Each person sees only what their role allows.',
}

function Check() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 9.5l3.5 3.5 7.5-8" />
    </svg>
  )
}

export default function CxoMarketingPage() {
  const brand = getBrand('cxo')
  const name = brand.assistantName
  const checkout = cxoCheckoutUrl()
  const primary = checkout
    ? { href: checkout, label: 'Get started', external: true }
    : { href: CXO_BOOK_CALL_HREF, label: 'Book a call', external: false }

  const PrimaryCta = ({ big = false }: { big?: boolean }) =>
    primary.external ? (
      <a className={`cx-btn cxs-btn${big ? ' cxs-btn-lg' : ''}`} href={primary.href} rel="noopener">
        {primary.label}
      </a>
    ) : (
      <Link className={`cx-btn cxs-btn${big ? ' cxs-btn-lg' : ''}`} href={primary.href}>
        {primary.label}
      </Link>
    )

  return (
    <main className="cx-site">
      <header className="cxs-nav">
        <div className="cxs-wrap cxs-nav-in">
          <Link className="cxs-logo" href="/" aria-label={`${SITE_NAME} home`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo.markSrc} alt="" />
            <span>{SITE_NAME}</span>
          </Link>
          <nav className="cxs-nav-links" aria-label="Site">
            <a className="cxs-nav-hide" href="#how">How it works</a>
            <a className="cxs-nav-hide-sm" href="#pricing">Pricing</a>
            <a className="cxs-nav-hide" href="#faq">FAQ</a>
            <Link href="/login">Sign in</Link>
            <PrimaryCta />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="cxs-hero">
        <div className="cxs-wrap cxs-hero-grid">
          <div className="cxs-hero-copy">
            <p className="cxs-eyebrow">Your CAIO</p>
            <h1 className="cxs-h">A Chief AI Officer for everyone in your company.</h1>
            <p className="cxs-lede">
              {name} is one assistant for your whole team, connected to your company&rsquo;s own email,
              calendar, boards, meetings and numbers. Ask a question, get the answer, and let {name} do the work.
            </p>
            <ul className="cxs-hero-points">
              <li>Execs and every employee, one price each</li>
              <li>Each person sees only what their role allows</li>
              <li>We connect everything for you</li>
            </ul>
            <div className="cxs-actions">
              <PrimaryCta big />
              <a className="cx-btn cx-btn-ghost cxs-btn cxs-btn-lg" href="#pricing">
                See pricing
              </a>
            </div>
          </div>
          <AskMock name={name} />
        </div>
      </section>

      {/* Connected */}
      <section className="cxs-section" id="how">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Connected to your company</p>
            <h2 className="cxs-h">It already knows your work.</h2>
            <p className="cxs-lede">
              No copying and pasting into a chat box. {name} reads the tools your team already uses, so the answer comes from your real data.
            </p>
          </div>
          <div className="cxs-cards">
            <div className="cxs-card">
              <h3 className="cxs-h">Email and calendar</h3>
              <p>Each person connects their own Google inbox and calendar. {name} reads, drafts replies and checks the schedule.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Boards and to-dos</h3>
              <p>Projects, cards, due dates and who owns what. Your to-do list fills itself from meetings and requests.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Meetings</h3>
              <p>Notes from Plaud, Wispr Flow or Zapier come in, and the action items land on the right to-do list.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Team messages</h3>
              <p>Message a teammate in the app. A request lands straight on their to-do list.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Finance and the books</h3>
              <p>QuickBooks and your revenue plan, read only. Execs only.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Your own AI</h3>
              <p>Use Claude or another AI app? Connect it and ask about your company from there.</p>
            </div>
          </div>
          <p className="cxs-note">
            Microsoft 365, Slack and Teams <span className="cxs-soon">Coming soon</span>
          </p>
        </div>
      </section>

      {/* Does the work */}
      <section className="cxs-section">
        <div className="cxs-wrap cxs-split">
          <div>
            <p className="cxs-eyebrow">Answers, then does the work</p>
            <h2 className="cxs-h">Every morning, the day is already sorted.</h2>
            <ul className="cxs-list">
              <li>
                <strong>A morning brief.</strong> <span>Meetings, replies owed and anything overdue, at the top of the page.</span>
              </li>
              <li>
                <strong>A to-do list that writes itself.</strong> <span>From meetings, emails and teammates&rsquo; requests, each with the next step ready: draft the email, make the call, open the event.</span>
              </li>
              <li>
                <strong>Replies drafted for you.</strong> <span>{name} writes the email. You read it and send it.</span>
              </li>
              <li>
                <strong>Reminders before things slip.</strong> <span>A heads-up when a to-do is due soon.</span>
              </li>
              <li>
                <strong>Follow-ups across people.</strong> <span>Requests between teammates are tracked on both lists. Automatic chasing on a schedule is <span className="cxs-soon">Coming soon</span></span>
              </li>
            </ul>
          </div>
          <TodayMock name={name} />
        </div>
      </section>

      {/* Roles */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Everyone gets it</p>
            <h2 className="cxs-h">Each person sees their part. Nothing more.</h2>
            <p className="cxs-lede">
              One assistant across the company, with the same walls your team already has. Nobody reads anyone else&rsquo;s inbox.
            </p>
          </div>
          <table className="cxs-roles">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">What {name} can see</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Exec</th>
                <td data-label={`What ${name} can see`}>Their own email and calendar, the boards they are on, meetings, team messages, plus finance and book data.</td>
                <td data-label="Price">${CXO_PRICE_PER_PERSON} a month</td>
              </tr>
              <tr>
                <th scope="row">Employee</th>
                <td data-label={`What ${name} can see`}>Their own email and calendar, their to-dos, the boards they are on and their messages. No finance.</td>
                <td data-label="Price">${CXO_PRICE_PER_PERSON} a month</td>
              </tr>
              <tr>
                <th scope="row">Exec assistant</th>
                <td data-label={`What ${name} can see`}>Works inside the exec&rsquo;s account to keep their day on track.</td>
                <td data-label="Price">Free</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 24 }}>
            <BoardMock />
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Private by design</p>
            <h2 className="cxs-h">Your data stays yours.</h2>
          </div>
          <div className="cxs-cards is-4">
            <div className="cxs-card">
              <h3 className="cxs-h">Zero data retention</h3>
              <p>Every AI request runs with zero data retention. The AI provider keeps nothing.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Never used for training</h3>
              <p>Your company&rsquo;s data is never used to train any AI model.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Walled off</h3>
              <p>Each company has its own space. No company can see another&rsquo;s data.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Role limits</h3>
              <p>Each person only gets their own inbox and what their role allows.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Offer */}
      <section className="cxs-section" id="pricing">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">The offer</p>
            <h2 className="cxs-h">One price per person. No credits to guess at.</h2>
            <p className="cxs-lede">
              Your data is already connected, so the price is simple. You know the bill before the month starts.
            </p>
          </div>
          <div className="cxs-offer">
            <div className="cxs-price-card">
              <p className="cxs-eyebrow" style={{ marginBottom: 6 }}>Execs and employees</p>
              <div className="cxs-price">
                <b>${CXO_PRICE_PER_PERSON}</b>
                <span>per person, per month</span>
              </div>
              <p className="cxs-price-sub">Exec assistants are free.</p>
              <ul className="cxs-includes">
                <li>
                  <Check />
                  <span>
                    <strong>{CXO_QUESTIONS_PER_PERSON} questions a month per person,</strong> added to one shared pool. Anyone can use it, nobody is capped.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Over the pool?</strong> ${CXO_OVERAGE_PRICE} per {CXO_OVERAGE_BLOCK} more questions. Nothing stops working.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Done for you setup.</strong> We connect email, calendar, boards, meetings and your numbers.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Your own address</strong> at yourcompany.suitecxo.com, on phone and desktop.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Cancel any time.</strong> It ends at the end of the billing period.
                  </span>
                </li>
              </ul>
              <SeatCalculator />
              <div className="cxs-actions">
                <PrimaryCta big />
              </div>
              {!checkout && <p className="cxs-note">A short call to set up your company, then your team signs in.</p>}
            </div>
            <UsageMock name={name} />
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">How setup works</p>
            <h2 className="cxs-h">Three steps, and we do the work.</h2>
          </div>
          <ol className="cxs-steps">
            <li>
              <h3 className="cxs-h">Book a call</h3>
              <p>Tell us who is on the team and what tools you use.</p>
            </li>
            <li>
              <h3 className="cxs-h">We connect it</h3>
              <p>Email, calendar, boards, meetings and your numbers. You don&rsquo;t touch a setting.</p>
            </li>
            <li>
              <h3 className="cxs-h">Your team signs in</h3>
              <p>At yourcompany.suitecxo.com. Each person connects their own inbox and starts asking.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section className="cxs-section" id="faq">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">FAQ</p>
            <h2 className="cxs-h">Good questions.</h2>
          </div>
          <div className="cxs-faq">
            <details>
              <summary>What happens to our data?</summary>
              <div>
                <p>Every AI request runs with zero data retention, and your data is never used to train a model. Each company is walled off from every other.</p>
              </div>
            </details>
            <details>
              <summary>Who sees what?</summary>
              <div>
                <p>Each person sees their own email and calendar, their to-dos, the boards they are on and their messages. Finance and book data are for execs only. Nobody can read another person&rsquo;s inbox.</p>
              </div>
            </details>
            <details>
              <summary>What counts as a question?</summary>
              <div>
                <p>One message you send to {name} is one question. The morning brief and due-soon reminders don&rsquo;t count.</p>
              </div>
            </details>
            <details>
              <summary>What if we go over the pool?</summary>
              <div>
                <p>Nobody gets cut off. Questions above the pool are ${CXO_OVERAGE_PRICE} per {CXO_OVERAGE_BLOCK}. You can see the count any time in Settings.</p>
              </div>
            </details>
            <details>
              <summary>Do exec assistants cost extra?</summary>
              <div>
                <p>No. Exec assistants are free.</p>
              </div>
            </details>
            <details>
              <summary>Can we cancel?</summary>
              <div>
                <p>Yes. From our <Link href="/terms">terms</Link>:</p>
                <blockquote>
                  You may cancel at any time. Cancellation takes effect at the end of the current billing period. No refunds are issued for partial months.
                </blockquote>
              </div>
            </details>
            <details>
              <summary>Does it work with Slack, Teams or Microsoft 365?</summary>
              <div>
                <p>Not yet. They are coming soon. Today {name} works with Google email and calendar.</p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="cxs-section cxs-final">
        <div className="cxs-wrap">
          <h2 className="cxs-h">Give everyone a Chief AI Officer.</h2>
          <p className="cxs-lede">${CXO_PRICE_PER_PERSON} per person a month. We set it up for you.</p>
          <div className="cxs-actions">
            <PrimaryCta big />
            <Link className="cx-btn cx-btn-ghost cxs-btn cxs-btn-lg" href="/login">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="cxs-foot">
        <div className="cxs-wrap cxs-foot-in">
          <span>© {new Date().getFullYear()} {SITE_NAME}</span>
          <nav aria-label="Footer">
            <Link href="/login">Sign in</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </main>
  )
}
