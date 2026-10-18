/**
 * A time that works for several coworkers (QA X-calendar-07, 2026-10-18).
 *
 * Pure helpers for find_team_free_time: pick the members a person named, and
 * turn each member's Google free/busy into busy blocks with nothing but a
 * start and an end. Google's freeBusy API never returns titles, but our
 * BusySlot carries the calendar's NAME, which can say something private
 * ("Therapy", "Kids"), so it is dropped here before anything leaves.
 */

import type { BusyBlock } from '@/lib/cxoFreeTime'

export type TeamMember = { id: string; display_name: string | null; email: string | null }

/** At most this many people in one search (freeBusy calls are one per account). */
export const TEAM_FREE_MAX_PEOPLE = 12

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim()

function score(m: TeamMember, q: string): number {
  const name = norm(m.display_name || '')
  const email = norm(m.email || '')
  const local = email.split('@')[0]
  if (email && q === email) return 100
  if (name && q === name) return 90
  const parts = name.split(' ').filter(Boolean)
  // A first name and an email local part rank the same, so two Sams always ask.
  if (parts.includes(q) || (local && (q === local || local.split('.').includes(q)))) return 70
  if (q.split(' ').every((w) => parts.some((p) => p.startsWith(w)) || local.startsWith(w))) return 50
  return 0
}

export type PickResult = { members: TeamMember[]; ask?: string }

/** Each query → exactly one member, or an ask (unknown name, or two people match). */
export function pickMembers(all: TeamMember[], queries: string[]): PickResult {
  const out: TeamMember[] = []
  for (const raw of queries) {
    const q = norm(raw)
    if (!q) continue
    const scored = all.map((m) => ({ m, s: score(m, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
    if (!scored.length) return { members: out, ask: `I don't see anyone called "${raw.trim()}" on the team. Who did you mean?` }
    const top = scored.filter((x) => x.s === scored[0].s).map((x) => x.m)
    if (top.length > 1) return { members: out, ask: `Which ${raw.trim()}: ${top.map((m) => m.display_name || m.email).join(', ')}?` }
    if (!out.some((m) => m.id === top[0].id)) out.push(top[0])
  }
  return { members: out }
}

/** Start and end only, sorted and merged where they touch: no calendar names, no titles. */
export function busyOnly(slots: Array<{ startIso: string; endIso: string }>): BusyBlock[] {
  const iv = slots
    .map((s) => [Date.parse(s.startIso), Date.parse(s.endIso)] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0])
  const merged: Array<[number, number]> = []
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged.map(([a, b]) => ({ startIso: new Date(a).toISOString(), endIso: new Date(b).toISOString() }))
}
