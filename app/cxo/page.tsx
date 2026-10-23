import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getBrand } from '@/lib/brand'
import { CXO_BOOK_CALL_HREF, CXO_OVERAGE_BLOCK, CXO_OVERAGE_PRICE, CXO_PRICE_PER_PERSON, CXO_PRIVATE_BUILD_FEE, CXO_PRIVATE_CARE_FEE, CXO_QUESTIONS_PER_PERSON, cxoCheckoutUrl } from '@/lib/cxoSite'
import { CXO_LOGO_URL, CXO_SITE_DESCRIPTION, CXO_SITE_ORIGIN, cxoJsonLd } from '@/lib/seo'
import './site.css'

// Middleware rewrites `/` on suitecxo.com to this route: the public page
// people see before signing in.
//
// Owner 2026-10-19: written for the person we email, the IT director or
// compliance lead at a 50 to 500 person firm (the CEO signs later). Very
// simple: the problem, how it works, why IT signs off, what it is for.
// Owner go 2026-10-22 (Nick's two-option framing 2026-10-20): two ways to
// buy, the cloud plan or the private build on a server the client owns
// (client buys the hardware, we build onto it and run it remotely). The
// private build is delivered once the self-hosted package passes QA.
// Copy rules for this page:
// - One brand: "Ciao by Suite CXO". Never name the AI model or provider.
// - "Every answer is checked", never "uncensored".
// - Only TRUE claims: data is never used to train AI, role-based access,
//   checked answers. "Stays on your own server" / "never leaves your
//   building" ONLY about the private build (owner 2026-10-22), never the cloud.
// - Prices: the cloud per-person price and the approved private build/care
//   fees in lib/cxoSite.ts (owner 2026-10-20). Nothing else.
// - "Cheaper over time" only for larger teams, with the small-team caveat.
// - No government or "top 100 companies" lines, no blanket training claim.
// - No Slack/Teams (not built), no texting, calling, ads or inbox offers.
// - Never name or picture a client (NDA).
// Anchors other sites link to: #private, #cloud (plus #how, #pricing).
export const dynamic = 'force-dynamic'

const SITE_NAME = 'Suite CXO'

const TITLE = 'Ciao by Suite CXO · One company AI your team can say yes to'

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

const BUILD_CALL_HREF = `${CXO_BOOK_CALL_HREF}?interest=build`
const PRIVATE_CALL_HREF = `${CXO_BOOK_CALL_HREF}?interest=private`
/** Smallest approved private-build fees (owner 2026-10-20), shown as "from" prices. */
const PRIVATE_BUILD_FROM = CXO_PRIVATE_BUILD_FEE['office-small']
const PRIVATE_CARE_FROM = CXO_PRIVATE_CARE_FEE['office-small']
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`)

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

/** Personal AI accounts vs one company AI: who can see what was shared. */
function PathDiagram({ name }: { name: string }) {
  return (
    <svg
      className="cxs-diagram"
      viewBox="-22 0 442 300"
      role="img"
      aria-label={`With public AI tools, staff use personal accounts nobody can see. With ${name}, your team logs into one company account you control, and your data is never used to train AI.`}
    >
      <text x="0" y="16" className="cxd-label">Public AI tools</text>
      <Phone x={4} y={34} />
      <text x="19" y="104" textAnchor="middle" className="cxd-cap">Your team</text>
      <path d="M44 60 H262" className="cxd-line is-dash" />
      <text x="153" y="50" textAnchor="middle" className="cxd-cap">out of sight</text>
      <rect x="270" y="32" width="148" height="56" rx="10" className="cxd-box" />
      <text x="344" y="56" textAnchor="middle" className="cxd-cap">Personal</text>
      <text x="344" y="74" textAnchor="middle" className="cxd-cap">AI accounts</text>

      <text x="0" y="166" className="cxd-label">{name}</text>
      <Phone x={4} y={204} />
      <text x="19" y="274" textAnchor="middle" className="cxd-cap">Your team</text>
      <rect x="112" y="178" width="306" height="112" rx="14" className="cxd-wall" />
      <text x="265" y="200" textAnchor="middle" className="cxd-wall-label">YOUR COMPANY ACCOUNT</text>
      <path d="M44 230 H252" className="cxd-line" />
      <rect x="252" y="208" width="150" height="44" rx="10" className="cxd-metal" />
      <circle cx="268" cy="230" r="4" className="cxd-dot" />
      <text x="334" y="235" textAnchor="middle" className="cxd-strong">{name}</text>
      <text x="265" y="278" textAnchor="middle" className="cxd-cap">never used to train AI</text>
    </svg>
  )
}

export default function CxoMarketingPage() {
  const brand = getBrand('cxo')
  const name = brand.assistantName
  const checkout = cxoCheckoutUrl()

  const BookCall = ({ big = false }: { big?: boolean }) => (
    <Link className={`cx-btn cxs-btn${big ? ' cxs-btn-lg' : ''}`} href={CXO_BOOK_CALL_HREF}>
      Book a call
    </Link>
  )

  // The cloud plan's buy button: Whop checkout once a plan is set,
  // otherwise the request form with the cloud plan picked.
  const CloudCta = () =>
    checkout ? (
      <a className="cx-btn cxs-btn" href={checkout} rel="noopener">
        Start the cloud plan
      </a>
    ) : (
      <Link className="cx-btn cxs-btn" href={`${CXO_BOOK_CALL_HREF}?interest=cloud`}>
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
            <a className="cxs-nav-hide" href="#how">How it works</a>
            <a className="cxs-nav-hide" href="#pricing">Pricing</a>
            <Link className="cxs-nav-hide-sm" href="/login">Sign in</Link>
            <BookCall />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="cxs-hero">
        <div className="cxs-wrap cxs-hero-grid">
          <div className="cxs-hero-copy">
            <p className="cxs-eyebrow">{name} by Suite CXO</p>
            <h1 className="cxs-h">Give your team an AI you can say yes to.</h1>
            <p className="cxs-lede">
              {name} is one company AI your team logs into, connected to your company&rsquo;s data. Your data is never used to
              train AI, and every answer is checked.
            </p>
            <div className="cxs-actions">
              <BookCall big />
              <a className="cx-btn cx-btn-ghost cxs-btn cxs-btn-lg" href="#how">
                How it works
              </a>
            </div>
          </div>
          <div className="cxs-card cxs-diagram-card">
            <PathDiagram name={name} />
          </div>
        </div>
      </section>

      {/* Speed: everything below the hero sits in one Suspense boundary. It is
          still rendered on the server and arrives in the same HTML (nothing
          here waits on data, so no fallback ever shows); the boundary only
          lets the browser wire it up in small slices after the hero. */}
      <Suspense>
      {/* The problem */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">The problem</p>
            <h2 className="cxs-h">Your team already uses AI. You just can&rsquo;t see it.</h2>
          </div>
          <div className="cxs-cards">
            <div className="cxs-card">
              <h3 className="cxs-h">It&rsquo;s already happening</h3>
              <p>Staff paste client files into personal AI tools to get work done faster.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">A ban doesn&rsquo;t stop it</h3>
              <p>It just moves to phones and home laptops, out of sight.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">You can&rsquo;t audit what you can&rsquo;t see</h3>
              <p>Client data leaves, and nobody knows where it went.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works: the cloud plan. */}
      <section className="cxs-section" id="how">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">How it works</p>
            <h2 className="cxs-h">Three steps. We do the setup.</h2>
          </div>
          <ol className="cxs-steps">
            <li>
              <h3 className="cxs-h">We set up your company</h3>
              <p>Your own {name} account, with your people and the role each one has.</p>
            </li>
            <li>
              <h3 className="cxs-h">We connect your data</h3>
              <p>The tools and files you allow. Each person only sees what their role allows.</p>
            </li>
            <li>
              <h3 className="cxs-h">Your team logs in</h3>
              <p>They ask {name} instead of pasting client files into personal AI tools.</p>
            </li>
          </ol>
          <ol className="cxs-stack cxs-compare" aria-label="Personal AI tools compared with one company AI">
            <li>
              <span className="cxs-card-k">Public AI tools</span>
              <span>Staff use personal accounts. You can&rsquo;t see what was shared, or whether it trains someone&rsquo;s AI.</span>
            </li>
            <li className="is-hi">
              <span className="cxs-card-k">{name}</span>
              <span>One company account you control. Your data is never used to train AI.</span>
            </li>
          </ol>
        </div>
      </section>

      {/* Why IT signs off: only claims that are true today. */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">For IT and compliance</p>
            <h2 className="cxs-h">Why IT and compliance sign off.</h2>
          </div>
          <div className="cxs-cards is-4">
            <div className="cxs-card">
              <h3 className="cxs-h">Not used to train AI</h3>
              <p>Your questions, answers and files are never used to train AI.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">You decide who sees what</h3>
              <p>You choose who can sign in. Each person only sees what their role allows.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Every answer is checked</h3>
              <p>A quality check runs on each answer before your team sees it.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">One price per person</h3>
              <p>A clear monthly price per person. No credits to guess at.</p>
            </div>
          </div>
        </div>
      </section>

      {/* What it's for */}
      <section className="cxs-section">
        <div className="cxs-wrap cxs-split">
          <div>
            <p className="cxs-eyebrow">What your team uses it for</p>
            <h2 className="cxs-h">The everyday work, without the risk.</h2>
          </div>
          <ul className="cxs-list">
            <li>
              <strong>Drafts.</strong> <span>Recaps, replies and first drafts, ready for a person to check.</span>
            </li>
            <li>
              <strong>Summaries.</strong> <span>Meetings and long notes, cut down to what matters.</span>
            </li>
            <li>
              <strong>Answers from your own data.</strong> <span>Ask a question and see where the answer came from.</span>
            </li>
            <li>
              <strong>Meeting prep and notes.</strong> <span>A brief before each meeting, the to-dos after.</span>
            </li>
            <li>
              <strong>Nothing slips.</strong> <span>To-dos from meetings and requests, with a heads-up before they&rsquo;re due.</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Checked answers */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Quality</p>
            <h2 className="cxs-h">Every answer is checked before your team sees it.</h2>
            <p className="cxs-lede">{name} runs a quality check on each answer, so your team gets fewer wrong facts and fewer dead ends.</p>
          </div>
        </div>
      </section>

      {/* Pricing: two ways to buy (Nick 2026-10-20, owner go 2026-10-22). Our cloud per
          person, or a private build on a server the client owns. The only private
          prices allowed are the approved build and care fees in lib/cxoSite.ts. */}
      <section className="cxs-section" id="pricing">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Pricing</p>
            <h2 className="cxs-h">Two ways to buy.</h2>
            <p className="cxs-lede">Our cloud, billed per person. Or a private build on a server you own. Custom dashboards and tools can be added to either.</p>
          </div>
          <div className="cxs-plans">
            <div className="cxs-price-card" id="cloud">
              <p className="cxs-card-k">The cloud plan</p>
              <div className="cxs-price">
                <b>${CXO_PRICE_PER_PERSON}</b>
                <span>per person, per month, plus tax where applicable</span>
              </div>
              <p className="cxs-price-sub">Exec assistants are free.</p>
              <ul className="cxs-includes">
                <li>
                  <Check />
                  <span>
                    <strong>{CXO_QUESTIONS_PER_PERSON} questions a month per person,</strong> added to one shared pool.
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
                    <strong>We set it up</strong> and connect your data.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Cancel any time.</strong> It ends at the end of the billing period.
                  </span>
                </li>
              </ul>
              <div className="cxs-actions">
                <CloudCta />
              </div>
            </div>
            <div className="cxs-price-card" id="private-build">
              <p className="cxs-card-k">The private build</p>
              <div className="cxs-price">
                <b>from {money(PRIVATE_BUILD_FROM)}</b>
                <span>to build, then from {money(PRIVATE_CARE_FROM)} a month to look after it</span>
              </div>
              <p className="cxs-price-sub">You buy the hardware. We spec it, build onto it and run it for you.</p>
              <ul className="cxs-includes">
                <li>
                  <Check />
                  <span>
                    <strong>Your data stays on your own server.</strong> Questions, answers and files never leave your building.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Once it&rsquo;s yours, it&rsquo;s yours.</strong> Nobody can reprice it, rewrite it or switch it off later.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>No per-person AI bills.</strong> One build fee, one care fee, sized to your team.
                  </span>
                </li>
                <li>
                  <Check />
                  <span>
                    <strong>Same {name}, your dashboards,</strong> built for how your firm works.
                  </span>
                </li>
              </ul>
              <div className="cxs-actions">
                <Link className="cx-btn cxs-btn" href={PRIVATE_CALL_HREF}>
                  Book a call about the private build
                </Link>
                <Link className="cx-btn cx-btn-ghost cxs-btn" href="/cxo/sizing">
                  What size would we need?
                </Link>
              </div>
            </div>
          </div>
          <p className="cxs-plans-note">
            Custom builds on either plan: an exec dashboard, a weekly report, a tool for one job. We quote after a short call.{' '}
            <Link href={BUILD_CALL_HREF}>Ask about a custom build</Link>
          </p>
        </div>
      </section>

      {/* Own it (Nick 2026-10-20, owner go 2026-10-22): the private build in the
          client's words. Other sites link to /#private, so the anchor lives here.
          Guardrails: no "government will restrict AI" as fact, cheaper only with
          its condition, no prices beyond lib/cxoSite.ts. */}
      <section className="cxs-section cxs-soon-section" id="private">
        <div className="cxs-wrap">
          <div className="cxs-soon">
            <div>
              <p className="cxs-eyebrow">Own it</p>
              <h3 className="cxs-h">Once it&rsquo;s yours, it&rsquo;s yours.</h3>
              <p>
                The private build puts {name} on a server your company owns. You buy the hardware we spec and ship it to
                us. We build {name} and your dashboards onto it, ship it back, and look after it from here. Your data
                stays on your own server.
              </p>
              <p>
                No vendor can reprice it, rewrite it or switch it off later. Whatever the rules around cloud AI become,
                yours is already in your building, under your control. For larger teams it also costs less than
                per-person AI subscriptions over time. For a small team the cloud plan is usually the better buy, and
                we&rsquo;ll say so on the call.
              </p>
            </div>
            <div className="cxs-soon-links">
              <Link className="cx-btn cx-btn-ghost cxs-btn" href="/cxo/sizing">
                What size would we need?
              </Link>
              <Link className="cx-btn cx-btn-ghost cxs-btn" href={PRIVATE_CALL_HREF}>
                Book a call about the private build
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="cxs-section" id="faq">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">FAQ</p>
            <h2 className="cxs-h">What IT asks us.</h2>
          </div>
          <div className="cxs-faq">
            <details>
              <summary>Where does our data go?</summary>
              <div>
                <p>
                  On the cloud plan, {name} runs on our cloud. To write an answer, your question is sent to the AI providers
                  we use, with data collection turned off. Your data is never used to train AI.
                </p>
                <p>On the private build, {name} runs on your own server and your data stays there.</p>
              </div>
            </details>
            <details>
              <summary>Who can see what?</summary>
              <div>
                <p>You decide who can use {name} and what it can see. Each person only sees what their role allows. Nobody sees another person&rsquo;s calendar or to-dos.</p>
              </div>
            </details>
            <details>
              <summary>What happens when better AI comes out?</summary>
              <div>
                <p>We test it and switch it on for you. Your setup, your data and your access rules stay the same.</p>
              </div>
            </details>
            <details>
              <summary>Does our IT team have to run it?</summary>
              <div>
                <p>No. We set it up and run it for you: updates, monitoring and fixes.</p>
              </div>
            </details>
            <details>
              <summary>How long does setup take?</summary>
              <div>
                <p>It depends on what you connect. We&rsquo;ll give you a date on the call.</p>
              </div>
            </details>
            <details>
              <summary>Can we run it on our own server?</summary>
              <div>
                <p>
                  Yes. That is the private build: you buy the hardware we spec, we build {name} onto it and look after it
                  for you. Start with the <Link href="/cxo/sizing">size calculator</Link>, then{' '}
                  <Link href={PRIVATE_CALL_HREF}>book a call</Link>.
                </p>
              </div>
            </details>
            <details>
              <summary>What if the company behind the AI shuts down?</summary>
              <div>
                <p>
                  On the private build, nothing changes for you. The server is yours and keeps working. Nobody can take
                  it back, reprice it or switch it off.
                </p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="cxs-section cxs-final">
        <div className="cxs-wrap">
          <h2 className="cxs-h">Say yes to AI, on your terms.</h2>
          <p className="cxs-lede">A short call. We&rsquo;ll show you {name} and how it fits your firm.</p>
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
            <Link href="/cxo/sizing">Server size calculator</Link>
            <Link href={CXO_BOOK_CALL_HREF}>Contact</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/support">Support</Link>
          </nav>
        </div>
      </footer>
      </Suspense>
    </main>
  )
}
