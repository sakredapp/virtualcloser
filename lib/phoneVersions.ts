/**
 * Phone app versions. ONE codebase, one skeleton; everything that differs
 * between companies' versions lives in this file and nowhere else.
 *
 * Pure and client-safe (its one import, the assistant's name, has no imports
 * of its own), so the shell, the pages and the tests can all read it. Which version a tenant gets is decided on the server by
 * `phoneVersionKeyFor`, from the same two facts the rest of the product
 * already uses: the tenant's brand (`reps.brand = 'cxo'`) and whether the
 * tenant is mapped to the Pinnacle book (lib/pinnacle/access).
 *
 * Adding a third company's version:
 *   1. add its key to `PhoneVersionKey`,
 *   2. add one entry to `PHONE_VERSIONS` (about 20 lines, copy `cxo`),
 *   3. add one line to `phoneVersionKeyFor` saying which tenants get it.
 * No screens are copied; the screens read the entry.
 */

import { ASSISTANT_NAME } from './assistantName'

export type PhoneVersionKey = 'cxo' | 'pinnacle'

/** What the Home tab leads with. `today` = the day's work; `book` = the book of business. */
export type PhoneHomeKind = 'today' | 'book'

/**
 * The tokens a company's own look replaces on a phone. Every key is required,
 * so a skin can never leave a token half set. Applied only at phone width on
 * the phone shell (cxo-phone.css, [data-phone-skin]); wider screens never read it.
 */
export type PhoneSkinTokens = {
  ground: string
  surface: string
  ink: string
  muted: string
  hairline: string
  /** Money figures (the Home hero, the top lists, the month-before figures). */
  money: string
}
export type PhoneSkin = {
  /** CSS font-family for every word on the phone (headings and body). */
  font: string
  light: PhoneSkinTokens
  dark: PhoneSkinTokens
}

/** Logo marks drawn as vectors (lib/brandMarks.ts). */
export type PhoneMarkKey = 'pinnacle'

export type PhoneVersion = {
  key: PhoneVersionKey
  /** The app's name on the phone (home header, Me). */
  appName: string
  /** Wordmark text set in Lora when there is no logo. Null = the signed-in company's own name. */
  wordmark: string | null
  /** Logo image. Null = use the wordmark. */
  logoSrc: string | null
  /** The assistant's name in this version (lib/assistantName unless a version sets its own). */
  assistantName: string
  /** What Home leads with. */
  home: PhoneHomeKind
  /**
   * Pages under Work, in this order (by href). Pages the person can open that
   * are not listed here still appear, after these, so nothing goes missing.
   */
  work: string[]
  /** The words this version uses for its numbers. */
  words: {
    /** Short label of the Home hero. */
    hero: string
    submitted: string
    issued: string
    placement: string
    policies: string
    agencies: string
    producers: string
    carriers: string
  }
  /**
   * Colour overrides for the phone skeleton, as CSS values. Leave a key out to
   * keep the product's own token (black and silver).
   */
  colors: Partial<Record<'ground' | 'surface' | 'ink' | 'muted' | 'accentFrom' | 'accentTo', string>>
  /** The company's own type and colours on a phone, light and dark. Null = the product's own look. */
  skin: PhoneSkin | null
  /** The company's own logo mark, drawn beside the wordmark on Home. Null = wordmark (or logo image) only. */
  mark: PhoneMarkKey | null
}

const WORK_DEFAULT = [
  '/dashboard/approvals',
  '/dashboard/boards',
  '/dashboard/calendar',
  '/dashboard/meetings',
  '/dashboard/plan',
  '/dashboard/revenue',
  '/dashboard/pinnacle',
  '/dashboard/execs',
  '/dashboard/partners',
  '/dashboard/employees',
]

export const PHONE_VERSIONS: Record<PhoneVersionKey, PhoneVersion> = {
  // Suite CXO: the generic executive suite. Home is the day's work.
  cxo: {
    key: 'cxo',
    appName: 'Suite CXO',
    wordmark: null,
    logoSrc: null,
    assistantName: ASSISTANT_NAME,
    home: 'today',
    work: WORK_DEFAULT,
    words: {
      hero: 'Needs you today',
      submitted: 'Submitted',
      issued: 'Issued',
      placement: 'Placement rate',
      policies: 'policies',
      agencies: 'Top teams',
      producers: 'Top people',
      carriers: 'Top carriers',
    },
    colors: {},
    skin: null,
    mark: null,
  },
  // Pinnacle Life Group: same skeleton, Home is the issued-premium picture.
  pinnacle: {
    key: 'pinnacle',
    appName: 'Pinnacle Life Group',
    wordmark: 'Pinnacle Life Group',
    logoSrc: null,
    assistantName: ASSISTANT_NAME,
    home: 'book',
    work: ['/dashboard/approvals', '/dashboard/revenue', '/dashboard/pinnacle', '/dashboard/plan', '/dashboard/partners', '/dashboard/execs', '/dashboard/employees', '/dashboard/boards', '/dashboard/calendar', '/dashboard/meetings'],
    words: {
      hero: 'Issued premium',
      submitted: 'Submitted premium',
      issued: 'Issued premium',
      placement: 'Placement rate',
      policies: 'policies',
      agencies: 'Top agencies',
      producers: 'Top producers',
      carriers: 'Top carriers',
    },
    colors: {},
    // Pinnacle Life Group's own look: Instrument Sans, money in its green
    // (lime on dark), near-black grounds in dark.
    skin: {
      font: "var(--font-instrument-sans), 'Instrument Sans', system-ui, -apple-system, sans-serif",
      light: { ground: '#F5F6F7', surface: '#FFFFFF', ink: '#0F1012', muted: '#5B6067', hairline: '#E6E8EB', money: '#016630' },
      dark: { ground: '#0F0F10', surface: '#161617', ink: '#F2F3F5', muted: '#A3A8AF', hairline: '#2A2A2D', money: '#D1FE17' },
    },
    mark: 'pinnacle',
  },
}

/**
 * Which phone version a tenant gets, or null for none (the page keeps today's
 * layout). Only executive-suite tenants get one; only a tenant already mapped
 * to the Pinnacle book gets the Pinnacle version.
 */
export function phoneVersionKeyFor(t: { brand?: string | null; pinnacle: boolean }): PhoneVersionKey | null {
  if (t.brand !== 'cxo') return null
  if (t.pinnacle) return 'pinnacle'
  return 'cxo'
}

export function phoneVersion(key: PhoneVersionKey | null | undefined): PhoneVersion | null {
  return key ? PHONE_VERSIONS[key] ?? null : null
}

/** The team page's address in the product (its place in Work, its icon). */
export const TEAM_PAGE_HREF = '/dashboard/pinnacle'

/**
 * The public demo's two versions. Same two layouts the product has (Home leads
 * with the day's work, or with the book of business), but the demo is open to
 * anyone, so the book version carries the demo's invented company name and
 * never a client's.
 */
export function demoPhoneVersion(home: PhoneHomeKind, company: string): PhoneVersion {
  const base = Object.values(PHONE_VERSIONS).find((v) => v.home === home) ?? PHONE_VERSIONS.cxo
  // The client's own look (type, colours, logo) never shows on the public demo.
  return home === 'book' ? { ...base, appName: company, wordmark: company, logoSrc: null, skin: null, mark: null } : base
}

/** CSS custom properties for a version's colour overrides (empty when it has none). */
export function phoneVersionStyle(v: PhoneVersion): Record<string, string> {
  const out: Record<string, string> = {}
  const map = { ground: '--cxph-ground', surface: '--cxph-surface', ink: '--cxph-ink', muted: '--cxph-muted', accentFrom: '--cxph-accent-from', accentTo: '--cxph-accent-to' } as const
  for (const k of Object.keys(map) as Array<keyof typeof map>) {
    const val = v.colors[k]
    if (val) out[map[k]] = val
  }
  if (v.skin) {
    out['--cxph-font'] = v.skin.font
    for (const theme of ['light', 'dark'] as const) {
      for (const [k, val] of Object.entries(v.skin[theme])) out[`--cxph-${theme === 'light' ? 'l' : 'd'}-${k}`] = val
    }
  }
  return out
}

/**
 * The development-only edition switch on the public demo (/cxo/demo?edition=pinnacle):
 * shows a client's real look over the demo's sample data, for checking that look
 * on a phone. Only on the local dev server (NODE_ENV 'development'); every
 * deployed build, previews included, runs as production and gets null, so the
 * public demo never shows a client.
 */
export function demoEdition(raw: string | string[] | undefined, nodeEnv: string | undefined): PhoneVersionKey | null {
  if (nodeEnv !== 'development') return null
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'pinnacle' ? 'pinnacle' : null
}

/** Attributes for the phone shell: `data-phone-skin` turns the version's own look on (phone width only, cxo-phone.css). */
export function phoneShellAttrs(v: PhoneVersion | null): { 'data-phone-skin'?: string } {
  return v?.skin ? { 'data-phone-skin': v.key } : {}
}

/** A person's page list put in a version's Work order; unlisted pages keep their order at the end. */
export function orderWork<T extends { href: string }>(pages: T[], v: PhoneVersion): T[] {
  const rank = (href: string) => {
    const i = v.work.indexOf(href.split('?')[0])
    return i === -1 ? v.work.length : i
  }
  return pages.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.href) - rank(b.p.href) || a.i - b.i).map((x) => x.p)
}

/** Tabs that have their own place in the bar (Home, Inbox); everything else is Work. */
export function isWorkPage(href: string): boolean {
  const path = href.split('?')[0]
  return path !== '/dashboard' && path !== '/dashboard/inbox' && !path.startsWith('/dashboard/settings')
}
