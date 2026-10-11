/**
 * Phone app versions. ONE codebase, one skeleton; everything that differs
 * between companies' versions lives in this file and nowhere else.
 *
 * Pure and client-safe (no imports), so the shell, the pages and the tests can
 * all read it. Which version a tenant gets is decided on the server by
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

export type PhoneVersionKey = 'cxo' | 'pinnacle'

/** What the Home tab leads with. `today` = the day's work; `book` = the book of business. */
export type PhoneHomeKind = 'today' | 'book'

export type PhoneVersion = {
  key: PhoneVersionKey
  /** The app's name on the phone (home header, Me). */
  appName: string
  /** Wordmark text set in Lora when there is no logo. Null = the signed-in company's own name. */
  wordmark: string | null
  /** Logo image. Null = use the wordmark. */
  logoSrc: string | null
  /** The assistant's name in this version. One line to rename it. */
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
    assistantName: 'Ciao',
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
  },
  // Pinnacle Life Group: same skeleton, Home is the issued-premium picture.
  pinnacle: {
    key: 'pinnacle',
    appName: 'Pinnacle Life Group',
    wordmark: 'Pinnacle Life Group',
    logoSrc: null,
    assistantName: 'Ciao',
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

/** CSS custom properties for a version's colour overrides (empty when it has none). */
export function phoneVersionStyle(v: PhoneVersion): Record<string, string> {
  const out: Record<string, string> = {}
  const map = { ground: '--cxph-ground', surface: '--cxph-surface', ink: '--cxph-ink', muted: '--cxph-muted', accentFrom: '--cxph-accent-from', accentTo: '--cxph-accent-to' } as const
  for (const k of Object.keys(map) as Array<keyof typeof map>) {
    const val = v.colors[k]
    if (val) out[map[k]] = val
  }
  return out
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
