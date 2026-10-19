/**
 * Search and AI-answer-engine rules for every host this app serves.
 *
 * One app serves the public Suite CXO site (www.suitecxo.com, apex redirects
 * there), every company's own app host (mike.suitecxo.com, pinnacle.*, ...),
 * Vercel preview hosts and roleplay.virtualcloser.com. Only the public site
 * may be indexed, and on it only the marketing pages. Everything else says
 * "do not index" twice: robots.txt (Disallow) and an X-Robots-Tag header
 * (middleware), so a page linked from elsewhere still stays out.
 *
 * Pure and edge-safe: no imports with side effects. Used by middleware,
 * app/robots.ts, app/sitemap.ts, app/llms.txt and the tests.
 */
import {
  CXO_BOOK_CALL_HREF,
  CXO_OVERAGE_BLOCK,
  CXO_OVERAGE_PRICE,
  CXO_PRICE_PER_PERSON,
  CXO_QUESTIONS_PER_PERSON,
} from './cxoSite'
import { ASSISTANT_NAME } from './assistantName'

/** The one canonical origin. suitecxo.com 307s to www, so www is canonical. */
export const CXO_SITE_ORIGIN = 'https://www.suitecxo.com'
export const CXO_SITE_NAME = 'Suite CXO'
/** Same words as the home page meta description. */
export const CXO_SITE_DESCRIPTION =
  'Ciao by Suite CXO is a private AI on a machine only your company uses, and it is yours to keep. Client files never go to an outside AI company. We set it up and care for it.'
export const CXO_LOGO_URL =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png'

const MARKETING_HOSTS = new Set(['suitecxo.com', 'www.suitecxo.com'])
/** Virtual Closer's own site is served by another project; kept neutral here in case it ever lands on this one. */
const VC_SITE_HOSTS = new Set(['virtualcloser.com', 'www.virtualcloser.com'])

function cleanHost(host: string | null | undefined): string {
  return (host ?? '').split(':')[0].trim().toLowerCase()
}

/** The public Suite CXO site: apex or www only. Company hosts, previews and localhost are not. */
export function isCxoMarketingHost(host: string | null | undefined): boolean {
  return MARKETING_HOSTS.has(cleanHost(host))
}

/** Public marketing pages, the only ones in the sitemap. Paths as served on www. */
export const CXO_SITEMAP_PATHS = ['/', '/cxo/request-access', '/privacy', '/terms'] as const

/**
 * Pages on the public host that must never be indexed but may be crawled, so
 * the crawler sees the noindex header:
 *   - sign-in and account setup pages;
 *   - /cxo/demo: a public demo full of SAMPLE numbers. Indexed, search and AI
 *     answers could quote those invented figures as Suite CXO's own. It stays
 *     open by link for sales, just out of the index.
 */
const NOINDEX_PREFIXES = [
  '/cxo/demo',
  '/login',
  '/logout',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/onboard',
  '/welcome',
]

/** Never crawled on the public host either: the app, the console and the API. */
export const CXO_DISALLOW_PATHS = ['/dashboard', '/admin', '/api/', '/onboard', '/u/', '/welcome'] as const

/** AI and search crawlers named explicitly, so nobody reads "*" as an accident. */
export const AI_AND_SEARCH_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Googlebot',
  'Bingbot',
] as const

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** Should this response carry X-Robots-Tag: noindex? */
export function shouldNoindex(host: string | null | undefined, pathname: string): boolean {
  const h = cleanHost(host)
  if (VC_SITE_HOSTS.has(h)) return false
  if (!MARKETING_HOSTS.has(h)) return true
  let p = (pathname || '/').split('?')[0].toLowerCase().replace(/\/{2,}/g, '/')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  if (NOINDEX_PREFIXES.some((x) => under(p, x))) return true
  if (CXO_DISALLOW_PATHS.some((x) => under(p, x.replace(/\/$/, '')))) return true
  return false
}

export type RobotsRule = { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] }
export type RobotsFile = { rules: RobotsRule[]; sitemap?: string; host?: string }

/** robots.txt for the host asking. */
export function robotsFor(host: string | null | undefined): RobotsFile {
  const h = cleanHost(host)
  if (MARKETING_HOSTS.has(h)) {
    const group = { allow: '/', disallow: [...CXO_DISALLOW_PATHS] }
    return {
      rules: [
        { userAgent: [...AI_AND_SEARCH_BOTS], ...group },
        { userAgent: '*', ...group },
      ],
      sitemap: `${CXO_SITE_ORIGIN}/sitemap.xml`,
    }
  }
  if (VC_SITE_HOSTS.has(h)) return { rules: [{ userAgent: '*', allow: '/' }] }
  // Company app hosts, preview deployments, localhost, roleplay.virtualcloser.com.
  return { rules: [{ userAgent: '*', disallow: '/' }] }
}

/**
 * Sitemap entries for the host asking: the marketing pages on the public host,
 * nothing anywhere else. No lastmod: a "now" stamp on every request would tell
 * crawlers every page changed every time, and they learn to ignore it.
 */
export function sitemapFor(host: string | null | undefined) {
  if (!isCxoMarketingHost(host)) return []
  return CXO_SITEMAP_PATHS.map((p) => ({
    url: p === '/' ? `${CXO_SITE_ORIGIN}/` : `${CXO_SITE_ORIGIN}${p}`,
    changeFrequency: p === '/' ? ('weekly' as const) : ('monthly' as const),
    priority: p === '/' ? 1 : p === CXO_BOOK_CALL_HREF ? 0.8 : 0.3,
  }))
}

/**
 * JSON-LD for the home page: Organization + WebSite + SoftwareApplication.
 * Facts only from the page itself (name, description, price per person).
 */
export function cxoJsonLd() {
  const org = `${CXO_SITE_ORIGIN}/#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: CXO_SITE_NAME,
        url: `${CXO_SITE_ORIGIN}/`,
        logo: CXO_LOGO_URL,
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'sales',
          url: `${CXO_SITE_ORIGIN}${CXO_BOOK_CALL_HREF}`,
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${CXO_SITE_ORIGIN}/#website`,
        name: CXO_SITE_NAME,
        url: `${CXO_SITE_ORIGIN}/`,
        description: CXO_SITE_DESCRIPTION,
        publisher: { '@id': org },
        inLanguage: 'en',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${CXO_SITE_ORIGIN}/#software`,
        name: CXO_SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, iOS, Android',
        url: `${CXO_SITE_ORIGIN}/`,
        description: CXO_SITE_DESCRIPTION,
        publisher: { '@id': org },
        offers: {
          '@type': 'Offer',
          price: String(CXO_PRICE_PER_PERSON),
          priceCurrency: 'USD',
          description: `$${CXO_PRICE_PER_PERSON} per person, per month. Exec assistants are free.`,
          url: `${CXO_SITE_ORIGIN}/#pricing`,
        },
      },
    ],
  }
}

/** /llms.txt: a plain summary for AI engines, built only from copy already on the site. */
export function cxoLlmsTxt(): string {
  const n = ASSISTANT_NAME
  const o = CXO_SITE_ORIGIN
  return `# ${CXO_SITE_NAME}

> ${CXO_SITE_DESCRIPTION}

${n} by ${CXO_SITE_NAME} gives your team an AI you can say yes to. Staff already paste client files into personal AI tools, and a ban only moves that out of sight. ${n} runs on a machine only your company uses, so questions, answers and files stay there. Built for firms of about 50 to 500 people that hold client data: law, accounting, wealth management, insurance, healthcare, and anyone under client NDAs.

## Pages

- [Home](${o}/): how it works, why IT and compliance sign off, what it is for, pricing and FAQ.
- [Book a call](${o}${CXO_BOOK_CALL_HREF}): tell us about your company and what you are interested in.
- [Terms of Service](${o}/terms)
- [Privacy Policy](${o}/privacy)

## How it works

1. We set up a machine only your company uses: a private cloud server rented for you alone, a box in your office, or your own server.
2. ${n} runs on it and connects to the tools you allow. Each person only sees what their role allows.
3. Your team asks ${n} instead of pasting into a public chatbot. Questions and files stay on your machine.

Public AI tools send your question and files to an outside AI company's computers. With ${n}, the AI lives on your machine and questions and answers never leave it.

## Yours to keep

AI you rent (ChatGPT, Copilot and the rest): you pay every month, forever. They can raise the price, change it or switch it off. Stop paying and it's gone.

${n} on your machine: installed once and stored on your machine, like any file you own. Use it as much as you want, for the cost of power. Nobody can take it back, even if the company that made it goes away. Like owning the DVD instead of streaming it. When a better AI comes out, we add it for you, and the files it reads are always your current ones.

## Why IT and compliance sign off

- Data stays on your machine: questions, answers and files stay on a machine only your company uses.
- You decide who sees what: you choose who can use it, and each person only sees what their role allows.
- A fixed cost: a flat monthly fee, no per-question meter.
- Yours to keep: it can't be taken away or switched off. No vendor can change the rules or cap your use.
- Every answer is checked before your team sees it.
- We set it up and care for it every month (updates, monitoring and fixes), so your IT team does not have to run it. When better AI comes out, we test it and swap it in.

## What teams use it for

- Drafts: recaps, replies and first drafts, ready for a person to check.
- Summaries of meetings and long notes.
- Answers from your own data, with where the answer came from.
- Meeting prep and notes: a brief before each meeting, the to-dos after.
- To-dos from meetings and requests, with a heads-up before they are due.

## Pricing

One build, then a flat monthly fee sized to your headcount (up to 25, 50 or 100 people, or larger). No per-question meter. We quote after a short call. Setup takes about 1 to 5 weeks, depending on the machine.

Prefer the cloud? The ${CXO_SITE_NAME} cloud plan runs the same ${n} and app for you:

- $${CXO_PRICE_PER_PERSON} per person, per month. Exec assistants are free.
- ${CXO_QUESTIONS_PER_PERSON} questions a month per person, added to one shared pool.
- Over the pool: $${CXO_OVERAGE_PRICE} per ${CXO_OVERAGE_BLOCK} more questions. Nothing stops working.
- Cancel any time. It ends at the end of the billing period.
`
}

/**
 * Per-page canonical + social card for a Suite CXO page. A page's openGraph
 * replaces the layout's whole openGraph block (Next merges shallowly), so the
 * card is written out in full here.
 */
export function cxoPageMeta(path: string, title: string, description: string = CXO_SITE_DESCRIPTION) {
  const full = `${title} · ${CXO_SITE_NAME}`
  const url = `${CXO_SITE_ORIGIN}${path}`
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website' as const,
      url,
      siteName: CXO_SITE_NAME,
      title: full,
      description,
      images: [{ url: CXO_LOGO_URL, alt: CXO_SITE_NAME }],
    },
    twitter: { card: 'summary_large_image' as const, title: full, description, images: [CXO_LOGO_URL] },
  }
}
