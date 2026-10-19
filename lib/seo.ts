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
export const CXO_SITE_TAGLINE = 'The Chief Whatever-You-Need Officer.'
/** Same words as the home page meta description. */
export const CXO_SITE_DESCRIPTION =
  'Custom-built company AI that runs on a server you own. Exec dashboards and an AI assistant built around your company, on a machine only your company uses. Or start with the cloud plan.'
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

> ${CXO_SITE_TAGLINE} ${CXO_SITE_DESCRIPTION}

We build ${CXO_SITE_NAME} around how your company runs, then run ${n}, its AI assistant, on a machine only your company uses. Your data stays on it, and no vendor can change the rules or switch it off. One build, then a flat monthly care plan. Prefer the cloud? The same ${n} and app, run by us, at one price per person.

## Pages

- [Home](${o}/): Private Server, custom builds, the cloud plan and FAQ.
- [Request access / book a call](${o}${CXO_BOOK_CALL_HREF}): tell us about your company and which option you are interested in.
- [Terms of Service](${o}/terms)
- [Privacy Policy](${o}/privacy)

## Private Server: three ways to own your AI

Every option is the full ${CXO_SITE_NAME} build with ${n}, on a machine only your company uses. One build, then a flat monthly care plan for updates, monitoring and fixes. Quoted after a short call.

- Private Cloud Server: a server rented for your company alone in a US data center. Nothing to buy or plug in. Runs over the internet. Setup about 1 to 2 weeks.
- Office Box: a Mac Studio we set up, test and ship. On 24/7 with a battery backup, and works with the internet down. For exec teams of about 5 to 15. Setup about 2 to 3 weeks.
- Company Server: a multi-GPU server in your office or server room, for the whole company at once. Works fully offline. Setup about 3 to 5 weeks.

Why own it: your data stays on your machine (with the Office Box or Company Server it never leaves your building), nobody can change the rules or switch it off, a fixed cost with no per-seat AI subscriptions or usage bills, and we look after it over a private encrypted connection. For a larger team this costs less over time than per-seat subscriptions; for a small team the cloud plan costs less. Private models are strong at briefs, summaries, drafts and search, and a step behind the biggest cloud models on the very hardest reasoning.

## Custom builds

Exec dashboards, a morning brief for each person, meetings that file their own to-dos, connected systems, reports and company search, built around how your leadership works. Steps: call, build, machine, private AI, test, handover, care.

## Connected to your company

- Calendar and meetings: each person connects their own Google Calendar. ${n} checks the schedule, preps each meeting and keeps the notes.
- Boards and to-dos: projects, cards, due dates and who owns what. Your to-do list fills itself from meetings and requests.
- Meetings: notes from Plaud, Wispr Flow or Zapier come in, and the action items land on the right to-do list.
- Team messages: message a teammate in the app. A request becomes a to-do in one tap.
- Finance and the books: QuickBooks and your revenue plan, read only. Execs only.
- Your own AI: use Claude or another AI app? Connect it and ask about your company from there.
- Microsoft 365, Slack and Teams: coming soon. Today ${n} works with Google Calendar.

## What it does

- A morning brief: meetings, messages from teammates and anything overdue, at the top of the page.
- A to-do list that writes itself, from meetings and teammates' requests, each with the next step ready.
- Follow-ups drafted for you. ${n} writes the recap after a meeting. You read it and send it.
- Reminders before things slip: a heads-up when a to-do is due soon.
- Follow-ups across people: requests between teammates are tracked on both lists.

## Who sees what

- Exec: their own calendar, the boards they are on, meetings, team messages, plus finance and book data. $${CXO_PRICE_PER_PERSON} a month.
- Employee: their own calendar, their to-dos, the boards they are on and their messages. No finance. $${CXO_PRICE_PER_PERSON} a month.
- Exec assistant: works inside the exec's account to keep their day on track. Free.

## Private by design

- On Private Server, ${n} and your data run on a machine only your company uses.
- On the cloud plan, AI requests go to our AI provider with data collection turned off.
- Never used for training: your company's data is never used to train any AI model.
- Walled off: each company has its own space. No company can see another's data.
- Role limits: each person only gets their own calendar and what their role allows.

## Cloud plan pricing

- $${CXO_PRICE_PER_PERSON} per person, per month, execs and employees. Exec assistants are free.
- ${CXO_QUESTIONS_PER_PERSON} questions a month per person, added to one shared pool. Anyone can use it, nobody is capped.
- Over the pool: $${CXO_OVERAGE_PRICE} per ${CXO_OVERAGE_BLOCK} more questions. Nothing stops working.
- Done for you setup: we connect calendar, boards, meetings and your numbers.
- Your own address at yourcompany.suitecxo.com, on phone and desktop.
- Cancel any time. It ends at the end of the billing period.

## How cloud plan setup works

1. Book a call: tell us who is on the team and what tools you use.
2. We connect it: calendar, boards, meetings and your numbers.
3. Your team signs in at yourcompany.suitecxo.com. Each person connects their own calendar and starts asking.
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
