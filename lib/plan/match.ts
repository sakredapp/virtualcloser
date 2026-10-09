/**
 * Fuzzy name matching for uploads: "Mutual Of Omaha Ins. Co." → "Mutual of Omaha",
 * "MOO" → "Mutual of Omaha", "Final Exp" → "Final Expense". Pure; no server imports.
 */
import { norm } from './shared'

/** Words that say nothing about which carrier it is. */
const NOISE = new Set([
  'the', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'companies', 'llc', 'ltd', 'ins', 'insurance',
  'assurance', 'group', 'financial', 'of', 'america', 'american', 'national', 'and', 'life', 'health', 'annuity', 'usa', 'us',
])

/** The name with filler words dropped ("Mutual of Omaha Insurance Co" → "mutual omaha"). Falls back to norm() when everything is filler. */
export function core(s: string): string {
  const words = norm(s).split(' ').filter(Boolean)
  const kept = words.filter((w) => !NOISE.has(w))
  return (kept.length ? kept : words).join(' ')
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  const t = s.replace(/\s+/g, ' ')
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Sørensen–Dice on letter pairs, 0..1. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const A = bigrams(a)
  const B = bigrams(b)
  let both = 0
  for (const [g, n] of A) both += Math.min(n, B.get(g) ?? 0)
  return (2 * both) / (a.length - 1 + (b.length - 1))
}

/** Initials with and without the small words: "Mutual of Omaha" → ["mo", "moo"]. */
function initials(s: string): string[] {
  const words = norm(s).split(' ').filter(Boolean)
  const short = words.filter((w) => w !== 'of' && w !== 'and' && w !== 'the').map((w) => w[0]).join('')
  const full = words.map((w) => w[0]).join('')
  return short === full ? [short] : [short, full]
}

/** How alike two names are, 0..1. */
export function similarity(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ca = core(a)
  const cb = core(b)
  if (ca === cb) return 0.97
  // One is a whole-word part of the other ("Omaha" in "Mutual of Omaha", "IUL" in "IUL Express").
  if (` ${cb} `.includes(` ${ca} `) || ` ${ca} `.includes(` ${cb} `)) return 0.9
  // Initials: "MOO" ↔ "Mutual of Omaha", "F&G" ↔ "Fidelity & Guaranty".
  const ra = na.replace(/ /g, '')
  const rb = nb.replace(/ /g, '')
  if ((ra.length >= 2 && ra.length <= 5 && initials(b).includes(ra)) || (rb.length >= 2 && rb.length <= 5 && initials(a).includes(rb))) return 0.88
  // A prefix of the other ("Final Exp" ↔ "Final Expense").
  if ((ca.length >= 4 && cb.startsWith(ca)) || (cb.length >= 4 && ca.startsWith(cb))) return 0.86
  return Math.max(dice(ca, cb), dice(na, nb) * 0.95)
}

export type NameMatch = {
  /** As it was in the file. */
  raw: string
  /** exact: same name; fuzzy: close to a known name (applied unless they say keep); unknown: nothing close. */
  kind: 'exact' | 'fuzzy' | 'unknown'
  /** The known name it maps to (exact/fuzzy), or the best guess (unknown, may be null). */
  name: string | null
  score: number
}

export const FUZZY_AUTO = 0.82
export const FUZZY_SUGGEST = 0.55

/** Match one name against the known list. */
export function matchName(raw: string, known: string[]): NameMatch {
  const n = norm(raw)
  if (!n) return { raw, kind: 'exact', name: raw, score: 1 }
  let best: string | null = null
  let bestScore = 0
  for (const k of known) {
    if (!k) continue
    if (norm(k) === n) return { raw, kind: 'exact', name: k, score: 1 }
    const s = similarity(raw, k)
    if (s > bestScore) {
      best = k
      bestScore = s
    }
  }
  if (best && bestScore >= FUZZY_AUTO) return { raw, kind: 'fuzzy', name: best, score: bestScore }
  return { raw, kind: 'unknown', name: best && bestScore >= FUZZY_SUGGEST ? best : null, score: bestScore }
}

/** Unique, non-empty names, first spelling wins. */
export function uniqueNames(list: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>()
  for (const s of list) {
    const t = (s ?? '').trim()
    if (t && !seen.has(norm(t))) seen.set(norm(t), t)
  }
  return Array.from(seen.values())
}
