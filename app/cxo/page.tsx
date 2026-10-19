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
import { CXO_LOGO_URL, CXO_SITE_DESCRIPTION, CXO_SITE_ORIGIN, cxoJsonLd } from '@/lib/seo'
import './site.css'

// Middleware rewrites `/` on suitecxo.com to this route: the public page
// people see before signing in.
//
// Owner 2026-10-19: written for the person we email, the IT director or
// compliance lead at a 50 to 500 person firm (the CEO signs later). Very
// simple: the problem, how it works, why IT signs off, what it is for.
// Copy rules for this page:
// - One brand: "Ciao by Suite CXO". Never name the AI model.
// - "Every answer is checked", never "uncensored".
// - No Private Server or build prices. Only the cloud plan price.
// - No government or "top 100 companies" lines, no blanket training claim.
// - No Slack/Teams (not built), no texting, calling, ads or inbox offers.
// - Never name or picture a client (NDA).
// Anchors other sites link to: #private, #cloud (plus #how, #pricing).
export const dynamic = 'force-dynamic'

const SITE_NAME = 'Suite CXO'

const TITLE = 'Ciao by Suite CXO · An AI your team can use, on a machine you control'

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

/** Public AI tools vs Ciao: where a question goes. */
function PathDiagram({ name }: { name: string }) {
  return (
    <svg
      className="cxs-diagram"
      viewBox="-22 0 442 300"
      role="img"
      aria-label={`Public AI tools send your question and files to an outside AI company. With ${name}, the question stays on a machine only your company uses.`}
    >
      <text x="0" y="16" className="cxd-label">Public AI tools</text>
      <Phone x={4} y={34} />
      <text x="19" y="104" textAnchor="middle" className="cxd-cap">Your team</text>
      <path d="M44 60 H262" className="cxd-line is-dash" />
      <text x="153" y="50" textAnchor="middle" className="cxd-cap">files leave</text>
      <rect x="270" y="32" width="148" height="56" rx="10" className="cxd-box" />
      <text x="344" y="56" textAnchor="middle" className="cxd-cap">Outside AI</text>
      <text x="344" y="74" textAnchor="middle" className="cxd-cap">company</text>

      <text x="0" y="166" className="cxd-label">{name}</text>
      <Phone x={4} y={204} />
      <text x="19" y="274" textAnchor="middle" className="cxd-cap">Your team</text>
      <rect x="112" y="178" width="306" height="112" rx="14" className="cxd-wall" />
      <text x="265" y="200" textAnchor="middle" className="cxd-wall-label">YOUR MACHINE</text>
      <path d="M44 230 H252" className="cxd-line" />
      <rect x="252" y="208" width="150" height="44" rx="10" className="cxd-metal" />
      <circle cx="268" cy="230" r="4" className="cxd-dot" />
      <text x="334" y="235" textAnchor="middle" className="cxd-strong">{name}</text>
      <text x="265" y="278" textAnchor="middle" className="cxd-cap">nothing leaves</text>
    </svg>
  )
}

export default function CxoMarketingPage() {
  const brand = getBrand('cxo')
  const name = brand.assistantName
  const checkout = cxoCheckoutUrl()

  const BookCall = ({ big = false }: { big?: boolean }) => (
    <Link className={`cx-btn cxs-btn${big ? ' cxs-btn-lg' : ''}`} href={PRIVATE_CALL_HREF}>
      Book a call
    </Link>
  )

  // The cloud plan keeps its own buy button: Whop checkout once a plan is
  // set, otherwise the same request form.
  const CloudCta = () =>
    checkout ? (
      <a className="cx-btn cx-btn-ghost cxs-btn" href={checkout} rel="noopener">
        Start the cloud plan
      </a>
    ) : (
      <Link className="cx-btn cx-btn-ghost cxs-btn" href={`${CXO_BOOK_CALL_HREF}?interest=cloud`}>
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
              {name} is a private AI assistant that runs on a machine only your company uses. Client files never go to an
              outside AI company.
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

      {/* How it works. #private stays here: other sites link to /#private. */}
      <section className="cxs-section" id="how">
        <div className="cxs-wrap" id="private">
          <div className="cxs-head">
            <p className="cxs-eyebrow">How it works</p>
            <h2 className="cxs-h">Three steps. We do the setup.</h2>
          </div>
          <ol className="cxs-steps">
            <li>
              <h3 className="cxs-h">A machine only you use</h3>
              <p>A private cloud server rented for you alone, a box in your office, or your own server.</p>
            </li>
            <li>
              <h3 className="cxs-h">{name} runs on it</h3>
              <p>It connects to the tools you allow. Each person only sees what their role allows.</p>
            </li>
            <li>
              <h3 className="cxs-h">Your team asks {name}</h3>
              <p>Not a public chatbot. Questions and files stay on your machine.</p>
            </li>
          </ol>
          <ol className="cxs-stack cxs-compare" aria-label="Where a question goes">
            <li>
              <span className="cxs-card-k">Public AI tools</span>
              <span>Your question and files travel to an outside AI company&rsquo;s computers.</span>
            </li>
            <li className="is-hi">
              <span className="cxs-card-k">{name}</span>
              <span>The AI lives on your machine. Questions and answers never leave it.</span>
            </li>
          </ol>
        </div>
      </section>

      {/* Why IT signs off */}
      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">For IT and compliance</p>
            <h2 className="cxs-h">Why IT and compliance sign off.</h2>
          </div>
          <div className="cxs-cards is-4">
            <div className="cxs-card">
              <h3 className="cxs-h">Data stays on your machine</h3>
              <p>Questions, answers and files stay on a machine only your company uses.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">You decide who sees what</h3>
              <p>You choose who can use it. Each person only sees what their role allows.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">A fixed cost</h3>
              <p>A flat monthly fee. No per-question meter, no surprise bills.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Nobody can switch it off</h3>
              <p>No vendor can change the rules, cap your use or turn it off on you.</p>
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

      {/* Pricing, no numbers */}
      <section className="cxs-section" id="pricing">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Pricing</p>
            <h2 className="cxs-h">One build, then a flat monthly fee.</h2>
            <p className="cxs-lede">Sized to your headcount. No per-question meter. We quote after a short call.</p>
          </div>
          <div className="cxs-cards is-4 cxs-tiers">
            <div className="cxs-card"><h3 className="cxs-h">Up to 25 people</h3></div>
            <div className="cxs-card"><h3 className="cxs-h">Up to 50 people</h3></div>
            <div className="cxs-card"><h3 className="cxs-h">Up to 100 people</h3></div>
            <div className="cxs-card"><h3 className="cxs-h">Larger teams</h3></div>
          </div>
          <div className="cxs-actions">
            <BookCall big />
          </div>

          {/* Cloud plan: the small way to start. Wording and price as already live. */}
          <div className="cxs-cloud" id="cloud">
            <div>
              <p className="cxs-eyebrow">Prefer the cloud?</p>
              <h3 className="cxs-h">Start with the Suite CXO cloud plan.</h3>
              <p className="cxs-note">
                The same {name} and app, run by us. One price per person and no credits to guess at. You can move to a private
                server later.
              </p>
            </div>
            <div className="cxs-price-card">
              <div className="cxs-price">
                <b>${CXO_PRICE_PER_PERSON}</b>
                <span>per person, per month</span>
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
                    <strong>Cancel any time.</strong> It ends at the end of the billing period.
                  </span>
                </li>
              </ul>
              <div className="cxs-actions">
                <CloudCta />
              </div>
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
              <summary>Where does our data live?</summary>
              <div>
                <p>On a machine only your company uses: a private cloud server rented for you alone, a box in your office, or your own server. Questions and answers stay on it.</p>
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
                <p>We test it and swap it in for you. Your setup, your data and your access rules stay the same.</p>
              </div>
            </details>
            <details>
              <summary>Does our IT team have to run it?</summary>
              <div>
                <p>No. We set it up and care for it every month: updates, monitoring and fixes, over a private encrypted connection.</p>
              </div>
            </details>
            <details>
              <summary>How long does setup take?</summary>
              <div>
                <p>About 1 to 5 weeks, depending on the machine. A private cloud server is the fastest, at about 1 to 2 weeks.</p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="cxs-section cxs-final">
        <div className="cxs-wrap">
          <h2 className="cxs-h">Say yes to AI, on your terms.</h2>
          <p className="cxs-lede">A short call. We&rsquo;ll show you where {name} would run and how it fits your firm.</p>
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
