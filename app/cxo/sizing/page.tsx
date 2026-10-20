import type { Metadata } from 'next'
import Link from 'next/link'
import { getBrand } from '@/lib/brand'
import { CXO_BOOK_CALL_HREF } from '@/lib/cxoSite'
import { cxoPageMeta } from '@/lib/seo'
import SizingCalculator from './SizingCalculator'
import '../site.css'

// Private server sizing calculator (owner 2026-10-20): clients don't know how
// big a server they need, so this says "you need this size, it costs this
// much". The formula is lib/cxoSizing.ts, the same one the vault job
// "Size a Private Server" uses.
// The private server is NOT sold yet (owner 2026-10-20): no checkout, no
// order button, only "Book a call". Copy rules are the home page's: never
// name a model, a model maker, a chip maker or a card; plain sizes only.
// Build and care fees are DRAFTS in lib/cxoSite.ts (owner sign-off needed).

export const metadata: Metadata = cxoPageMeta(
  '/cxo/sizing',
  'Private server sizing',
  'How big a private AI server your firm would need, and roughly what it costs to buy and run.',
)

const SITE_NAME = 'Suite CXO'
const BOOK_HREF = `${CXO_BOOK_CALL_HREF}?interest=private`

export default function CxoSizingPage() {
  const brand = getBrand('cxo')
  const name = brand.assistantName
  return (
    <main className="cx-site">
      <header className="cxs-nav">
        <div className="cxs-wrap cxs-nav-in">
          <Link className="cxs-logo" href="/" aria-label={`${SITE_NAME} home`}>
            {/* Mark only, no visible words (owner 10-13). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo.markSmallSrc ?? brand.logo.markSrc} alt="" />
          </Link>
          <nav className="cxs-nav-links" aria-label="Site">
            <Link className="cxs-nav-hide" href="/#pricing">Pricing</Link>
            <Link className="cxs-nav-hide-sm" href="/login">Sign in</Link>
            <Link className="cx-btn cxs-btn" href={BOOK_HREF}>
              Book a call
            </Link>
          </nav>
        </div>
      </header>

      <section className="cxs-hero cxs-calc-hero">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">Private server · coming</p>
            <h1 className="cxs-h">How big a private server would you need?</h1>
            <p className="cxs-lede">
              Tell us about your team. We&rsquo;ll show the size of server {name} would need and roughly what it costs to buy
              and run. It isn&rsquo;t available yet; this is for planning.
            </p>
          </div>
          <SizingCalculator bookHref={BOOK_HREF} />
        </div>
      </section>

      <section className="cxs-section">
        <div className="cxs-wrap">
          <div className="cxs-head">
            <p className="cxs-eyebrow">How we size it</p>
            <h2 className="cxs-h">Sized for your busiest moment.</h2>
          </div>
          <div className="cxs-cards">
            <div className="cxs-card">
              <h3 className="cxs-h">People at once, not headcount</h3>
              <p>Most teams have about one in five people using it at the same moment. That peak sets the size.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Long files need more</h3>
              <p>Reading a 50-page contract takes far more work than a quick question, so heavy file work moves you up a size.</p>
            </div>
            <div className="cxs-card">
              <h3 className="cxs-h">Room to grow</h3>
              <p>Each size answers several people at once at a comfortable reading speed. Past the biggest, we add another.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="cxs-foot">
        <div className="cxs-wrap cxs-foot-in">
          <span>© {new Date().getFullYear()} {SITE_NAME}</span>
          <nav aria-label="Footer">
            <Link href="/">Home</Link>
            <Link href={CXO_BOOK_CALL_HREF}>Contact</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </main>
  )
}
