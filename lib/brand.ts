/**
 * Brand registry — one place to look up everything that differs between
 * VirtualCloser (sales-rep OS) and CXO Suite (executive OS).
 *
 * Adding the third sister-brand later means appending one entry here and
 * mapping its root domain. Nothing else in the codebase needs to know.
 *
 * Safety: VirtualCloser is the default brand. Any tenant without an
 * explicit `brand` column value resolves to VC and renders identically
 * to today's behavior. CXO behavior only activates when a tenant is
 * explicitly flipped OR the request host is on a CXO-branded domain.
 */
import { headers } from 'next/headers'

export type BrandKey = 'virtualcloser' | 'cxo'

export type BrandConfig = {
  key: BrandKey
  /** Public-facing product name (used in <title>, emails, Telegram intro). */
  name: string
  /** Primary registered root domain (no subdomain). */
  rootDomain: string
  /** Marketing route group. `/` resolves to `marketingRoute` for this brand's gateway host. */
  marketingRoute: string
  /** Logo paths — wordmark + square mark + OG card. Falls back to remote URL when null. */
  logo: {
    /** Full wordmark — used in dashboard top-left and marketing hero. */
    wordmarkSrc: string
    wordmarkRatio: number // width / height
    /** Square/round mark — favicon, OG, compact corner. */
    markSrc: string
    /** OpenGraph share card (1200x630 recommended). */
    ogSrc: string
  }
  /** Telegram bot config — env-var names to read at runtime. */
  telegram: {
    tokenEnv: string
    usernameEnv: string
    usernameFallback: string
  }
  /** Sender label used in outbound emails. */
  emailFromName: string
  /** Public-facing support email surfaced in dashboard help links + onboarding. */
  supportEmail: string
  /** Dashboard tab preset key — `lib/brand-tabs.ts` reads this. */
  tabPreset: 'sales' | 'executive'
  /** CSS theme tokens. Applied via [data-brand="<key>"] in globals.css. */
  theme: {
    /** Accent / primary action color. */
    accent: string
    /** Darker shade of accent for hover/active. */
    accentDark: string
    /** Page background. */
    bg: string
    /** Card / surface color. */
    paper: string
    /** Soft secondary surface (alternate cards). */
    paper2: string
    /** Primary text color. */
    ink: string
    /** Muted text. */
    muted: string
    /** Subtle border. */
    borderSoft: string
  }
  /** Short tagline used on the marketing hero. */
  tagline: string
  /** Long-form descriptor for OG / metadata. */
  description: string
}

const VIRTUAL_CLOSER: BrandConfig = {
  key: 'virtualcloser',
  name: 'Virtual Closer',
  rootDomain: 'virtualcloser.com',
  marketingRoute: '/',
  logo: {
    wordmarkSrc:
      'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/Virtual%20(2000%20x%201000%20px).png',
    wordmarkRatio: 2,
    markSrc:
      'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/Virtual%20(1024%20x%201024%20px).png',
    ogSrc: '/logo.png',
  },
  telegram: {
    tokenEnv: 'TELEGRAM_BOT_TOKEN',
    usernameEnv: 'TELEGRAM_BOT_USERNAME',
    usernameFallback: 'VirtualCloserBot',
  },
  emailFromName: 'Virtual Closer',
  supportEmail: 'team@virtualcloser.com',
  tabPreset: 'sales',
  theme: {
    accent: '#ff2800',
    accentDark: '#c21a00',
    bg: '#ff2800',
    paper: '#ffffff',
    paper2: '#f7f4ef',
    ink: '#0f0f0f',
    muted: '#2b2b2b',
    borderSoft: 'rgba(15, 15, 15, 0.12)',
  },
  tagline: 'AI Sales Command Center',
  description:
    'AI-powered SDR, dialer, and CRM in one. Built for closers who want the calls made and the deals booked while they sleep.',
}

const CXO_SUITE: BrandConfig = {
  key: 'cxo',
  name: 'CXO Suite',
  rootDomain: 'suitecxo.com',
  marketingRoute: '/cxo',
  logo: {
    // Square wordmark hosted in Supabase storage. Same asset re-used for the
    // corner mark and OG share card until we generate dedicated crops.
    wordmarkSrc:
      'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png',
    wordmarkRatio: 1,
    markSrc:
      'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png',
    ogSrc:
      'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png',
  },
  telegram: {
    tokenEnv: 'CXO_TELEGRAM_BOT_TOKEN',
    usernameEnv: 'CXO_TELEGRAM_BOT_USERNAME',
    usernameFallback: 'CXOSuiteBot',
  },
  emailFromName: 'CXO Suite',
  supportEmail: 'team@suitecxo.com',
  tabPreset: 'executive',
  theme: {
    accent: '#3B2C23', // espresso
    accentDark: '#2a1f19',
    bg: '#F4EDE1', // ivory
    paper: '#ffffff',
    paper2: '#DDD1C3', // beige
    ink: '#3B2C23',
    muted: '#5a463a',
    borderSoft: 'rgba(59, 44, 35, 0.16)',
  },
  tagline: 'The Executive Operating System',
  description:
    'Run your company from one screen. Team performance, comms, calendar, inbox, assistants — purpose-built for the C-suite.',
}

const REGISTRY: Record<BrandKey, BrandConfig> = {
  virtualcloser: VIRTUAL_CLOSER,
  cxo: CXO_SUITE,
}

const ALL_BRANDS: BrandConfig[] = [VIRTUAL_CLOSER, CXO_SUITE]

/** Look up a brand config by key. Unknown keys fall back to VirtualCloser. */
export function getBrand(key: string | null | undefined): BrandConfig {
  if (!key) return VIRTUAL_CLOSER
  return REGISTRY[key as BrandKey] ?? VIRTUAL_CLOSER
}

/** All brand configs. Used by middleware to enumerate known root domains. */
export function listBrands(): BrandConfig[] {
  return ALL_BRANDS
}

/**
 * Return the brand whose root domain matches this host. Used by middleware
 * and server components to determine which brand surface to render.
 *
 * Matches:
 *   - exact root  (suitecxo.com)
 *   - www subdomain  (www.suitecxo.com)
 *   - any tenant subdomain  (spencer.suitecxo.com)
 *
 * Returns VirtualCloser when no domain matches — preserving existing behavior
 * on localhost, vercel.app previews, and the legacy VC root.
 */
export function brandFromHost(host: string | null | undefined): BrandConfig {
  if (!host) return VIRTUAL_CLOSER
  const clean = host.split(':')[0].toLowerCase()
  for (const brand of ALL_BRANDS) {
    const root = brand.rootDomain
    if (clean === root) return brand
    if (clean === `www.${root}`) return brand
    if (clean.endsWith(`.${root}`)) return brand
  }
  return VIRTUAL_CLOSER
}

/**
 * True if this host is a "gateway" for ANY brand — the apex, www, or a
 * preview/local host where no specific tenant is implied.
 */
export function isAnyGatewayHost(host: string | null | undefined): boolean {
  if (!host) return true
  const clean = host.split(':')[0].toLowerCase()
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return true
  if (clean.endsWith('.vercel.app')) return true
  for (const brand of ALL_BRANDS) {
    if (clean === brand.rootDomain || clean === `www.${brand.rootDomain}`) return true
  }
  return false
}

/**
 * Strip the brand root domain from a host and return the leftmost label as
 * the tenant slug. Returns null if the host isn't a branded subdomain.
 */
export function slugFromBrandedHost(host: string | null | undefined): string | null {
  if (!host) return null
  const clean = host.split(':')[0].toLowerCase()
  for (const brand of ALL_BRANDS) {
    const root = brand.rootDomain
    if (clean.endsWith(`.${root}`) && clean !== `www.${root}`) {
      return clean.slice(0, -1 * (root.length + 1)).split('.')[0]
    }
  }
  return null
}

/**
 * Resolve the current brand from incoming request headers. Reads
 * `x-tenant-host` (set by middleware) and falls back to `host`.
 *
 * Safe to call from any server component or route handler. Returns the
 * VirtualCloser config when no host is available (e.g., build-time
 * static generation), preserving today's behavior.
 */
export async function getCurrentBrand(): Promise<BrandConfig> {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  return brandFromHost(host)
}

/**
 * Telegram token resolver — brand-aware. When called without a brand it
 * defaults to VC, matching the legacy behavior of `process.env.TELEGRAM_BOT_TOKEN`.
 * Call sites in `lib/telegram.ts` use this to keep existing helpers
 * backward-compatible while opening a path for brand-scoped outbound DMs.
 */
export function brandTelegramToken(brand: BrandConfig | BrandKey | null | undefined): string | undefined {
  const b = typeof brand === 'string' ? getBrand(brand) : brand ?? VIRTUAL_CLOSER
  return process.env[b.telegram.tokenEnv]
}

export function brandTelegramUsername(brand: BrandConfig | BrandKey | null | undefined): string {
  const b = typeof brand === 'string' ? getBrand(brand) : brand ?? VIRTUAL_CLOSER
  return process.env[b.telegram.usernameEnv] ?? b.telegram.usernameFallback
}
