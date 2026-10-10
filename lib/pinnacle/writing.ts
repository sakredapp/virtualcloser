/**
 * "Who is writing" (Team page): pure split of agents into writing more,
 * steady and slipping, from two agent breakdowns (last 60 days and the 60
 * before). Kept pure so it is unit tested.
 */
import type { BreakdownRow } from './rollup'

export type WritingBand = 'more' | 'steady' | 'slipping'
export type WritingRow = {
  name: string
  team: string | null
  recent: number
  prior: number
  recentPremium: number
  band: WritingBand
}

/** Minimum change in policies before a move counts, so 1→2 is not "writing more". */
export const WRITING_MIN_STEP = 2
/** Minimum relative change before a move counts. */
export const WRITING_MIN_PCT = 0.25

export function writingBand(recent: number, prior: number): WritingBand {
  const diff = recent - prior
  if (diff >= WRITING_MIN_STEP && (prior === 0 || diff / prior >= WRITING_MIN_PCT)) return 'more'
  if (-diff >= WRITING_MIN_STEP && prior > 0 && -diff / prior >= WRITING_MIN_PCT) return 'slipping'
  return 'steady'
}

const BAND_RANK: Record<WritingBand, number> = { slipping: 0, more: 1, steady: 2 }

export function classifyWriting(recent: BreakdownRow[], prior: BreakdownRow[]): WritingRow[] {
  const byName = new Map<string, WritingRow>()
  const key = (s: string) => s.trim().toLowerCase()
  for (const r of recent) {
    if (!r.label?.trim()) continue
    const k = key(r.label)
    const cur = byName.get(k)
    if (cur) {
      cur.recent += r.policies
      cur.recentPremium += r.premium
    } else byName.set(k, { name: r.label.trim(), team: r.team ?? null, recent: r.policies, prior: 0, recentPremium: r.premium, band: 'steady' })
  }
  for (const r of prior) {
    if (!r.label?.trim()) continue
    const k = key(r.label)
    const cur = byName.get(k)
    if (cur) {
      cur.prior += r.policies
      if (!cur.team && r.team) cur.team = r.team
    } else byName.set(k, { name: r.label.trim(), team: r.team ?? null, recent: 0, prior: r.policies, recentPremium: 0, band: 'steady' })
  }
  const out = [...byName.values()].filter((r) => r.recent > 0 || r.prior > 0)
  for (const r of out) r.band = writingBand(r.recent, r.prior)
  // Biggest movers first in their band; steady by volume.
  return out.sort((a, b) => {
    if (a.band !== b.band) return BAND_RANK[a.band] - BAND_RANK[b.band]
    if (a.band === 'more') return b.recent - b.prior - (a.recent - a.prior) || b.recent - a.recent
    if (a.band === 'slipping') return a.recent - a.prior - (b.recent - b.prior) || b.prior - a.prior
    return b.recent - a.recent || a.name.localeCompare(b.name)
  })
}

/** YYYY-MM-DD shifted by whole days (UTC, no DST drift). */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
