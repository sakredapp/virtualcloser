import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getBrand } from '@/lib/brand'
import {
  CXO_BOOK_CALL_HREF,
  CXO_OVERAGE_BLOCK,
  CXO_OVERAGE_PRICE,
  CXO_PRICE_PER_PERSON,
  CXO_QUESTIONS_PER_PERSON,
  cxoCheckoutUrl,
} from '@/lib/cxoSite'
import { AskMock, TodayMock, UsageMock } from './SiteMocks'
import SeatCalculator from './SeatCalculator'
import { CXO_LOGO_URL, CXO_SITE_DESCRIPTION, CXO_SITE_ORIGIN, cxoJsonLd } from '@/lib/seo'
import './site.css'

// Middleware rewrites `/` on suitecxo.com to this route: the public page
// people see before signing in. Rules (owner 10-10): claim only what is
// built or being built, mockups are the real app components, the app's
// own black/silver look, plain short copy, phone first.
//
// Owner 2026-10-19: the headline offer is custom builds plus Private Server
// (Ciao on a machine only that company uses); the per-person cloud plan
// stays as the way to start. Copy rules for this page:
// - No "the government will restrict your AI", no "same as the top 100
//   companies", no blanket "stop AI training on your data".
// - "Cheaper over time" only with its condition (bigger teams).
// - No Private Server prices until the owner sets them.
// - Never name or picture a client (NDA).
export const dynamic = 'force-dynamic'

const SITE_NAME = 'Suite CXO'

const TITLE = `${SITE_NAME} · Your company's AI, on a server you own`

// Canonical is "/" on www: the same page answers on /cxo, and the apex
// redirects to www.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: CXO_SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: `${CXO_SITE_ORIGIN}/`,
    siteName: SITE_NAME,
    title: TITLE,
    description: CXO_SITE_DESCRIPTION,
    images: [{ url: CXO_LOGO_URL, alt: SITE_NAME }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: CXO_SITE_DESCRIPTION, images: [CXO_LOGO_URL] },
}

// Organization + WebSite + SoftwareApplication, in the server HTML. "<" is
// escaped so no value can close the script tag.
const JSON_LD = JSON.stringify(cxoJsonLd()).replace(/</g, '\\u003c')

const PRIVATE_CALL_HREF = `${CXO_BOOK_CALL_HREF}?interest=private`

function Check() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 9.5l3.5 3.5 7.5-8" />
    </svg>
  )
}

/** A phone, drawn small. */
function Phone({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x="0" y="0" width="30" height="52" rx="6" className="cxd-box" />
      <rect x="5" y="7" width="20" height="32" rx="2" className="cxd-screen" />
    </g>
  )
}

/** Today vs Private Server: where a question goes. */
function PathDiagram() {
  return (
    <svg
      className="cxs-diagram"
      viewBox="-24 0 924 330"
      role="img"
      aria-label="Most AI tools send each question over the internet through outside companies to someone else's servers. With Private Server, the question stays on a machine only your company uses."
    >
      <text x="0" y="20" className="cxd-label">Most AI tools</text>
      <Phone x={10} y={44} />
      <text x="25" y="118" textAnchor="middle" className="cxd-cap">Your team</text>
      <path d="M58 70 H210" className="cxd-line is-dash" />
      <g transform="translate(220,30)">
        <path d="M30 64 a28 28 0 0 1 8-52 a36 36 0 0 1 66 6 a25 25 0 0 1 6 46 z" className="cxd-box" />
        <text x="70" y="48" textAnchor="middle" className="cxd-cap">internet</text>
      </g>
      <path d="M345 70 H440" className="cxd-line is-dash" />
      <g transform="translate(450,42)">
        <rect width="120" height="56" rx="10" className="cxd-box" />
        <text x="60" y="33" textAnchor="middle" className="cxd-cap">AI vendor</text>
      </g>
      <path d="M580 70 H650" className="cxd-line is-dash" />
      <g transform="translate(660,26)">
        <rect width="74" height="22" rx="3" className="cxd-metal" />
        <rect y="28" width="74" height="22" rx="3" className="cxd-metal" />
        <rect y="56" width="74" height="22" rx="3" className="cxd-metal" />
        <text x="37" y="100" textAnchor="middle" className="cxd-cap">their servers</text>
      </g>
      <text x="770" y="66" className="cxd-cap">Outside</text>
      <text x="770" y="84" className="cxd-cap">companies</text>
      <text x="770" y="102" className="cxd-cap">in the middle</text>

      <text x="0" y="196" className="cxd-label">Private Server</text>
      <Phone x={10} y={220} />
      <text x="25" y="294" textAnchor="middle" className="cxd-cap">Your team</text>
      <rect x="200" y="204" width="460" height="110" rx="16" className="cxd-wall" />
      <text x="430" y="228" textAnchor="middle" className="cxd-wall-label">YOUR MACHINE · ONLY YOUR COMPANY</text>
      <path d="M58 246 H330" className="cxd-line" />
      <g transform="translate(340,242)">
        <rect width="180" height="56" rx="12" className="cxd-metal" />
        <circle cx="20" cy="28" r="4" className="cxd-dot" />
        <text x="98" y="33" textAnchor="middle" className="cxd-strong">Ciao + your data</text>
      </g>
      <text x="700" y="250" className="cxd-cap">Nobody in</text>
      <text x="700" y="268" className="cxd-cap">the middle</text>
    </svg>
  )
}

export default function CxoMarketingPage() {
  const brand = getBrand('cxo')
  const name = brand.assistantName
  const checkout = cxoCheckoutUrl()

  const BookCall = ({ big = false, href = PRIVATE_CALL_HREF }: { big?: boolean; href?: string }) => (
    <Link className={`cx-btn cxs-btn${big ? ' cxs-btn-lg' : ''}`} href={href}>
      Book a call
    </Link>
  )

  // The cloud plan keeps its own buy button: Whop checkout once a plan is
  // set, otherwise the same request form.
  const CloudCta = () =>
    checkout ? (
      <a className="cx-btn cxs-btn cxs-btn-lg" href={checkout} rel="noopener">
        Start the cloud plan
      </a>
    ) : (
      <Link className="cx-btn cxs-btn cxs-btn-lg" href={`${CXO_BOOK_CALL_HREF}?interest=cloud`}>
        Start the cloud plan
      </Link>
    )

  return (
    <main className="cx-site">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <header className="cxs-nav">
        <div className="cxs-wrap cxs-nav-in">
          <Link className="cxs-logo" href="/" aria-label={`${SITE_NAME} home`}>
            {/* Mark only, no visible words (owner 10-13); the link's aria-label names it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo.markSmallSrc ?? brand.logo.markSrc} alt="" />
          </Link>
          <nav className="cxs-nav-links" aria-label="Site">
            <a className="cxs-nav-hide" href="#private">Private Server</a>
            <a className="cxs-nav-hide" href="#builds">Custom builds</a>
            <a className="cxs-nav-hide-sm" href="#cloud">Cloud plan</a>
            <Link href="/login">Sign in</Link>
            <BookCall />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="cxs-hero">
        <div className="cxs-wrap cxs-hero-grid">
          <div className="cxs-hero-copy">
            <p className="cxs-eyebrow">Custom builds · Private Server</p>
            <h1 className="cxs-h">Your company&rsquo;s AI, on a server you own.</h1>
            <p className="cxs-lede">
              We build Suite CXO around how your company runs, then run {name}, its AI, on a machine only your company uses.
              Your data stays on it. No vendor can change the rules on you or switch it off.
            </p>
            <ul className="cxs-hero-points">
              <li>Built for your company, not off the shelf</li>
              <li>Runs on hardware you own, or a server rented for you alone</li>
              <li>One build, then a flat monthly care plan</li>
            </ul>
            <div className="cxs-actions">
              <BookCall big />
              <a className="cx-btn cx-btn-ghost cxs-btn cxs-btn-lg" href="#private">
                See the three options
              </a>
            </div>
          </div>
          <AskMock name={name} label={`${name} · running on your own server`} />
        </div>
      </section>

      {/* Speed: everything below the hero sits in one Suspense boundary. It is
          still rendered on the server and arrives in the same HTML (nothing
          here waits on data, so no fallback ever shows); the boundary only
          lets the browser wire it up in small slices after the hero, instead
          of in one long task that blocks the first tap. */}
      <Suspense>
      {/* The idea */}
      <section className="cxs-section" id="how">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">The whole idea</p>
            <h2 className="cxs-h">Same {name}. The brain lives with you.</h2>
            <p className="cxs-lede">
              Most AI tools send every question over the internet to someone else&rsquo;s servers. With Private Server, {name} runs on
              your machine, so the answer comes from your data without your data going anywhere.
            </p>
          </div>
          <div className="cxs-card cxs-diagram-card">
            <PathDiagram />
          </div>
        </div>
      </section>

      {/* Why own it */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Why own it</p>
            <h2 className="cxs-h">Ownership and control of the AI your business runs on.</h2>
          </div>
          <div className="cxs-cards">
            <div className="cxs-card">
              <h3 className="cxs-h">Your data stays home</h3>
              <p>Calendars, meetings, numbers and every question stay on a machine only your company uses. With the Office Box or Company Server, they never leave your building.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Nobody changes the rules</h3>
              <p>No vendor can raise your price, cap your use, retire your model or switch it off. Once it runs on your machine, it&rsquo;s yours.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">A fixed cost</h3>
              <p>No per-seat AI subscriptions and no usage bills. You pay for the build, then a flat monthly care plan.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Works offline</h3>
              <p>The Office Box and Company Server keep answering with the internet down. Calendar and finance syncs catch up when it&rsquo;s back.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Yours to keep</h3>
              <p>The hardware is yours, and the AI model sits on it as a file. No account to lose and no terms that change under you.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Looked after</h3>
              <p>We monitor it, update it and fix it over a private encrypted connection. You don&rsquo;t need an IT team.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Three options */}
      <section className="cxs-section" id="private">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Private Server</p>
            <h2 className="cxs-h">Three ways to own your AI.</h2>
            <p className="cxs-lede">Every option is the full Suite CXO build with {name}, on a machine only your company uses.</p>
          </div>
          <div className="cxs-opts">
            <div className="cxs-opt">
              <p className="cxs-card-k">Option A</p>
              <h3 className="cxs-h">Private Cloud Server</h3>
              <p>A server we rent for your company alone, in a US data center. Nothing to buy or plug in.</p>
              <dl>
                <dt>Best for</dt><dd>Remote teams that want privacy without hardware</dd>
                <dt>Offline</dt><dd>No. It runs over the internet, and only you use it</dd>
                <dt>Setup</dt><dd>About 1 to 2 weeks, fully remote</dd>
              </dl>
            </div>
            <div className="cxs-opt is-pick">
              <p className="cxs-card-k">Option B · recommended</p>
              <h3 className="cxs-h">Office Box</h3>
              <p>A Mac Studio desktop we set up, test and ship to you. Plug in power and network, and {name} runs from your office, on 24/7 with a battery backup.</p>
              <dl>
                <dt>Best for</dt><dd>Exec teams of about 5 to 15 with an office</dd>
                <dt>Offline</dt><dd>Yes</dd>
                <dt>Setup</dt><dd>About 2 to 3 weeks, shipped ready</dd>
              </dl>
            </div>
            <div className="cxs-opt">
              <p className="cxs-card-k">Option C</p>
              <h3 className="cxs-h">Company Server</h3>
              <p>A multi-GPU server in your office or server room. Bigger, faster models for the whole company at once.</p>
              <dl>
                <dt>Best for</dt><dd>Whole companies, with dozens of people asking at once</dd>
                <dt>Offline</dt><dd>Yes, fully</dd>
                <dt>Setup</dt><dd>About 3 to 5 weeks, one install day on site</dd>
              </dl>
            </div>
          </div>
          <p className="cxs-note">
            Every option is one build, then a flat monthly care plan for updates, monitoring and fixes. The hardware is included
            with the Office Box and Company Server. We quote after a short call.
          </p>
        </div>
      </section>

      {/* What's inside */}
      <section className="cxs-section">
        <div className="cxs-wrap cxs-split">
          <div>
            <p className="cxs-eyebrow">What&rsquo;s inside</p>
            <h2 className="cxs-h">Five layers. You use the top one.</h2>
            <p className="cxs-lede">
              Your team uses the same Suite CXO app on phone, web and Mac. Everything underneath runs on your machine.
            </p>
          </div>
          <ol className="cxs-stack" aria-label="The five layers, top to bottom">
            <li><span className="cxs-card-k">Your team</span><span>{name} on phone, web and the Mac app</span></li>
            <li className="is-hi"><span className="cxs-card-k">Apps</span><span>Suite CXO and {name}, built for your company</span></li>
            <li><span className="cxs-card-k">The brain</span><span>An open AI model, downloaded to your machine</span></li>
            <li><span className="cxs-card-k">The runner</span><span>Free software that loads the model and answers</span></li>
            <li><span className="cxs-card-k">The machine</span><span>A big-memory computer or GPU server, on 24/7</span></li>
          </ol>
        </div>
      </section>

      {/* Custom builds */}
      <section className="cxs-section" id="builds">
        <div className="cxs-wrap cxs-split">
          <div>
            <p className="cxs-eyebrow">Custom builds</p>
            <h2 className="cxs-h">Built around how your company runs.</h2>
            <p className="cxs-lede">
              We map how your leadership works, then build the dashboards, reports and {name} around it. Big builds for
              companies that want it done right.
            </p>
            <ul className="cxs-list">
              <li>
                <strong>Exec dashboards.</strong> <span>Revenue, team, boards and approvals, laid out the way your leadership reads them.</span>
              </li>
              <li>
                <strong>A morning brief for each person.</strong> <span>Meetings, what&rsquo;s overdue and what needs a yes, at the top of the page.</span>
              </li>
              <li>
                <strong>Meetings that file their own to-dos.</strong> <span>Notes from Plaud, Wispr Flow or Zapier come in, and the action items land on the right list.</span>
              </li>
              <li>
                <strong>Connected to your systems.</strong> <span>Calendars, boards, QuickBooks and your revenue plan, read only. Finance stays with execs.</span>
              </li>
              <li>
                <strong>Reports and company search.</strong> <span>Ask a question across the company and get the answer with where it came from.</span>
              </li>
              <li>
                <strong>Each person sees only their part.</strong> <span>The same walls your team already has. Nobody sees another person&rsquo;s calendar or to-dos.</span>
              </li>
            </ul>
          </div>
          <TodayMock name={name} />
        </div>
      </section>

      {/* How a build goes */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">How a build goes</p>
            <h2 className="cxs-h">From first call to handover, we do the work.</h2>
          </div>
          <ol className="cxs-steps is-7">
            <li><h3 className="cxs-h">Call</h3><p>We learn who is on the team, what they need and the tools you use.</p></li>
            <li><h3 className="cxs-h">Build</h3><p>Your dashboards and {name}, connected to your systems.</p></li>
            <li><h3 className="cxs-h">Machine</h3><p>We rent your server, or set up the box you&rsquo;ll own.</p></li>
            <li><h3 className="cxs-h">Private AI</h3><p>We install the model and point {name} at it.</p></li>
            <li><h3 className="cxs-h">Test</h3><p>Real questions, real speed, before your data goes on.</p></li>
            <li><h3 className="cxs-h">Handover</h3><p>We load your data and train your execs.</p></li>
            <li><h3 className="cxs-h">Care</h3><p>Updates, monitoring and fixes, every month.</p></li>
          </ol>
        </div>
      </section>

      {/* Honest money */}
      <section className="cxs-section">
        <div className="cxs-wrap cxs-split">
          <div>
            <p className="cxs-eyebrow">The money, plainly</p>
            <h2 className="cxs-h">Pay up front. Stop paying per seat.</h2>
          </div>
          <div className="cxs-prose">
            <p>
              Private Server is paid mostly up front: the build and the hardware, then a flat care plan. There are no per-seat AI
              subscriptions and no usage bills on top, however much your team asks.
            </p>
            <p>
              For a larger team, that costs less over time than adding a subscription for every person, every month, for years.
              For a small team, a cloud plan costs less, and we&rsquo;ll tell you so on the call.
            </p>
            <p>
              Private models are strong at briefs, summaries, drafts and search. On the very hardest reasoning they sit a step
              behind the biggest cloud models. We test yours on your real questions before handover.
            </p>
          </div>
        </div>
      </section>

      {/* Cloud plan */}
      <section className="cxs-section" id="cloud">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Prefer the cloud?</p>
            <h2 className="cxs-h">Start with the Suite CXO cloud plan.</h2>
            <p className="cxs-lede">
              The same {name} and app, run by us. One price per person and no credits to guess at. You can move to a private
              server later.
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
                    <strong>Done for you setup.</strong> We connect calendar, boards, meetings and your numbers.
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
                <CloudCta />
              </div>
              {!checkout && <p className="cxs-note">A short call to set up your company, then your team signs in.</p>}
            </div>
            <UsageMock name={name} />
          </div>
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
              <summary>Does the AI learn from our data?</summary>
              <div>
                <p>No. The model doesn&rsquo;t train on your chats, on a private server or on the cloud plan. {name} knows your company because it reads your stored data before it answers. On a private server, that data sits on your machine.</p>
              </div>
            </details>
            <details>
              <summary>What does a private server cost?</summary>
              <div>
                <p>One build, with the hardware included for the Office Box and Company Server, then a flat monthly care plan. The quote depends on the option and the size of your team, so we give it after a short call.</p>
              </div>
            </details>
            <details>
              <summary>Is it cheaper than AI subscriptions?</summary>
              <div>
                <p>For a larger team, over time, yes: there are no per-seat subscriptions or usage bills. For a small team, a cloud plan costs less, and we&rsquo;ll say so.</p>
              </div>
            </details>
            <details>
              <summary>Is a private model as smart as the big cloud AIs?</summary>
              <div>
                <p>For briefs, summaries, drafts and search, it does the job well. On the very hardest reasoning it sits a step behind the biggest cloud models. We test it on your real questions before handover.</p>
              </div>
            </details>
            <details>
              <summary>Does it work without the internet?</summary>
              <div>
                <p>The Office Box and Company Server do. {name} keeps answering from what&rsquo;s stored, and calendar and finance syncs catch up when the connection is back. The Private Cloud Server runs over the internet.</p>
              </div>
            </details>
            <details>
              <summary>Do we need an IT team?</summary>
              <div>
                <p>No. We reach the machine over a private encrypted connection to update, monitor and fix it. The care plan covers that, and helps replace hardware if it fails.</p>
              </div>
            </details>
            <details>
              <summary>Who sees what?</summary>
              <div>
                <p>Each person sees their own calendar, their to-dos, the boards they are on and their messages. Finance and book data are for execs only. Nobody can see another person&rsquo;s calendar or to-dos.</p>
              </div>
            </details>
            <details>
              <summary>What happens to our data on the cloud plan?</summary>
              <div>
                <p>AI requests go to our AI provider with data collection turned off, and your data is never used to train a model. Each company is walled off from every other.</p>
              </div>
            </details>
            <details>
              <summary>Can we cancel the cloud plan?</summary>
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
                <p>Not yet. They are coming soon. Today {name} works with Google Calendar.</p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="cxs-section cxs-final">
        <div className="cxs-wrap">
          <h2 className="cxs-h">Own the AI your company runs on.</h2>
          <p className="cxs-lede">Tell us about your company. We&rsquo;ll show you what we&rsquo;d build and which option fits.</p>
          <div className="cxs-actions">
            <BookCall big />
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
            <Link href={CXO_BOOK_CALL_HREF}>Contact</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
      </Suspense>
    </main>
  )
}
