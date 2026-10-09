#!/usr/bin/env tsx
/**
 * Builds the executive question bank: scripts/mira-exec-eval/questions/bank.jsonl
 *
 *   npx tsx scripts/mira-exec-eval/generate.ts            # placeholder entity names
 *   npx tsx scripts/mira-exec-eval/generate.ts --from-db  # pull real team/agent/carrier/state/product names
 *   npx tsx scripts/mira-exec-eval/generate.ts --seed 7 --target 5000
 *
 * Deterministic for a given seed + entity list. ~4,700 generated rows
 * (templates × periods × lines × dimensions × phrasing) + ~300 hand-written
 * long-tail rows from handwritten.ts. Every row carries a ground_truth spec
 * when the number is computable from lib/mcp/data.ts.
 */
import './lib/nextShim'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, repoRoot } from './lib/env'
import { normalize, num, parseArgs, pick, rng, shuffle } from './lib/util'
import type { Category, GroundTruth, Question, LineFilter } from './lib/types'
import { CATEGORIES } from './lib/types'
import {
  ALL_DATA_PERIODS,
  CLOSERS,
  DIMS,
  FAKE_ENTITIES,
  LINES,
  MISSING_PERIODS,
  MONTH_PERIODS_2026,
  OPENERS,
  PLACEHOLDER_ENTITIES,
  QUARTER_PERIODS_2026,
  RELATIVE_PERIODS,
  type EntityList,
  type Line,
  type Period,
} from './lib/vocab'
import { HANDWRITTEN } from './handwritten'

const args = parseArgs(process.argv.slice(2))
const SEED = num(args.seed, 20261008)
const TARGET = num(args.target, 5000)
const OUT_DIR = path.join(__dirname, 'questions')
const ENTITIES_FILE = path.join(OUT_DIR, 'entities.json')

/** Share of the generated bank per category (handwritten rows come on top, minus their share). */
const SHARES: Record<Category, number> = {
  headline_numbers: 0.185,
  rankings_movers: 0.175,
  funnel_status: 0.105,
  pace_projection: 0.07,
  comparisons: 0.125,
  why_anomaly: 0.065,
  data_freshness_definitions: 0.045,
  calendar_actions: 0.065,
  ambiguous_trick: 0.085,
  casual_exec: 0.085,
}

type Draft = Omit<Question, 'id'>

// ── helpers ────────────────────────────────────────────────────────────────

const r = rng(SEED)
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const IMPERATIVE = /^(show|give|draft|remind|make|book|put|set|add|note|rank|break|compare|walk|pull|explain|email|write|summarize|recap|top|bottom|rank|split|schedule|text|send|turn|prep|status|policy|pending|decline|lapse|issued|avg|average|total|number|placement|issue|projected|annualized|monthly|month|pace|biggest|lowest|which|bottom|numbers|premium|lead)/i
const NEUTRAL_OPENERS = ['', '', '', '', 'Mira, ', 'Hey Mira, ', 'Quick one — ']
function phrase(core: string): string {
  const o = IMPERATIVE.test(core) || !/^(what|how|who|where|when|why|is|are|do|does|did|can|any|was|were|if)\b/i.test(core) ? pick(r, NEUTRAL_OPENERS) : pick(r, OPENERS)
  const c = pick(r, CLOSERS)
  let s = `${o}${o ? core : cap(core)}`.replace(/\s+/g, ' ').trim()
  if (c === '?' && /[?.]$/.test(s)) return s
  if (c === '.' && /[?.]$/.test(s)) return s
  s = s + c
  return s.replace(/\s+([?.,])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}
const withLine = (core: string, line: Line) => {
  const l = pick(r, line.say)
  if (!l) return core
  return r() < 0.5 ? `${core} ${l}` : core.replace(/premium|production|business|policies|apps|applications/, (m) => `${l} ${m}`)
}
const periodLabel = (p: Period) => p.label[0]
const bare = (p: Period) => pick(r, p.say).replace(/^(in|for|during|over) (the )?/, '').replace(/^(the )?(month of |first |last |past )?/, (m) => (/^the month of/.test(m) ? '' : m))
const dataPeriod = () => pick(r, ALL_DATA_PERIODS)
const line = () => pick(r, LINES)
const dim = () => pick(r, DIMS)
const nTop = () => pick(r, [3, 5, 5, 5, 10, 10, 15, 20])

function gtPeriod(p: Period, l: Line, metric: 'premium' | 'policies' | 'avg_premium' | 'funded_premium'): GroundTruth {
  return { fn: 'period', window: p.window, line: l.key, metric }
}

// ── category generators (each returns ONE draft per call) ──────────────────

function genHeadline(): Draft {
  const p = dataPeriod()
  const l = line()
  const kind = r()
  const family = kind < 0.55 ? 'premium' : kind < 0.8 ? 'policies' : kind < 0.92 ? 'avg_premium' : 'funded'
  let core: string
  let gt: GroundTruth
  if (family === 'premium') {
    core = pick(r, [
      `how much premium did we write ${pick(r, p.say)}`,
      `what was total submitted premium ${pick(r, p.say)}`,
      `what did we do in premium ${pick(r, p.say)}`,
      `what's our production ${pick(r, p.say)}`,
      `total annual premium ${pick(r, p.say)}`,
      `how much business did we submit ${pick(r, p.say)}`,
      `what's the premium number ${pick(r, p.say)}`,
      `where did premium land ${pick(r, p.say)}`,
      `give me the top-line number ${pick(r, p.say)}`,
      `how much did we put on the books ${pick(r, p.say)}`,
    ])
    gt = gtPeriod(p, l, 'premium')
  } else if (family === 'policies') {
    core = pick(r, [
      `how many policies did we write ${pick(r, p.say)}`,
      `how many applications went in ${pick(r, p.say)}`,
      `policy count ${pick(r, p.say)}`,
      `how many apps did we submit ${pick(r, p.say)}`,
      `number of policies ${pick(r, p.say)}`,
      `how many pieces of business ${pick(r, p.say)}`,
    ])
    gt = gtPeriod(p, l, 'policies')
  } else if (family === 'avg_premium') {
    core = pick(r, [
      `what's our average premium per policy ${pick(r, p.say)}`,
      `average annual premium per app ${pick(r, p.say)}`,
      `what's the average case size ${pick(r, p.say)}`,
      `avg premium per policy ${pick(r, p.say)}`,
    ])
    gt = gtPeriod(p, l, 'avg_premium')
  } else {
    core = pick(r, [
      `how much funded premium did we have ${pick(r, p.say)}`,
      `what's the funded premium total ${pick(r, p.say)}`,
      `how much of the premium is funded ${pick(r, p.say)}`,
    ])
    gt = gtPeriod(p, l, 'funded_premium')
  }
  return {
    category: 'headline_numbers',
    text: phrase(withLine(core, l)),
    expected_kind: 'number',
    ground_truth: gt,
    meta: { source: 'generated', family: `headline_${family}`, period_label: periodLabel(p) },
  }
}

function genRanking(entities: EntityList): Draft {
  const d = dim()
  const l = line()
  const p = dataPeriod()
  const k = r()
  if (k < 0.5) {
    const n = nTop()
    const core = pick(r, [
      `who are the top ${n} ${pick(r, d.many)} ${pick(r, p.say)}`,
      `top ${n} ${pick(r, d.many)} by premium ${pick(r, p.say)}`,
      `rank our ${pick(r, d.many)} ${pick(r, p.say)}`,
      `give me the leaderboard for ${pick(r, d.many)} ${pick(r, p.say)}`,
      `which ${pick(r, d.many)} wrote the most ${pick(r, p.say)}`,
      `break down premium by ${pick(r, d.one)} ${pick(r, p.say)}`,
      `show me ${pick(r, d.one)} rankings ${pick(r, p.say)}`,
      `top ${n} ${pick(r, d.many)} ${pick(r, p.say)}`,
    ])
    return {
      category: 'rankings_movers',
      text: phrase(withLine(core, l)),
      expected_kind: 'ranking',
      ground_truth: { fn: 'breakdown', dim: d.key, window: p.window, line: l.key, top_n: n },
      meta: { source: 'generated', family: `rank_top_${d.key}`, period_label: periodLabel(p) },
    }
  }
  if (k < 0.68) {
    const core = pick(r, [
      `who's our number one ${pick(r, d.one)} ${pick(r, p.say)}`,
      `which ${pick(r, d.one)} is leading ${pick(r, p.say)}`,
      `biggest ${pick(r, d.one)} by premium ${pick(r, p.say)}`,
      `who's the top ${pick(r, d.one)} ${pick(r, p.say)}`,
      `which ${pick(r, d.one)} is carrying us ${pick(r, p.say)}`,
    ])
    return {
      category: 'rankings_movers',
      text: phrase(withLine(core, l)),
      expected_kind: 'ranking',
      ground_truth: { fn: 'breakdown', dim: d.key, window: p.window, line: l.key, top_n: 1 },
      meta: { source: 'generated', family: `rank_top1_${d.key}`, period_label: periodLabel(p) },
    }
  }
  if (k < 0.8) {
    const n = pick(r, [3, 5, 5, 10])
    const core = pick(r, [
      `which ${pick(r, d.many)} are at the bottom ${pick(r, p.say)}`,
      `bottom ${n} ${pick(r, d.many)} by premium ${pick(r, p.say)}`,
      `who's lagging among our ${pick(r, d.many)} ${pick(r, p.say)}`,
      `lowest producing ${pick(r, d.many)} ${pick(r, p.say)}`,
    ])
    return {
      category: 'rankings_movers',
      text: phrase(withLine(core, l)),
      expected_kind: 'ranking',
      ground_truth: { fn: 'breakdown', dim: d.key, window: p.window, line: l.key, top_n: n, order: 'bottom' },
      meta: { source: 'generated', family: `rank_bottom_${d.key}`, period_label: periodLabel(p) },
    }
  }
  if (k < 0.93) {
    const dirn = r() < 0.5 ? 'up' : 'down'
    const mp = pick(r, RELATIVE_PERIODS.filter((x) => ['mtd', 'last_month', 'qtd', '3m'].includes(x.key)))
    const core =
      dirn === 'up'
        ? pick(r, [
            `which ${pick(r, d.many)} grew the most ${pick(r, mp.say)} versus the period before`,
            `biggest gainers among ${pick(r, d.many)} ${pick(r, mp.say)}`,
            `who's up the most among ${pick(r, d.many)} ${pick(r, mp.say)} vs prior`,
            `which ${pick(r, d.one)} picked up the most ${pick(r, mp.say)} compared to the previous period`,
          ])
        : pick(r, [
            `which ${pick(r, d.many)} dropped the most ${pick(r, mp.say)} versus the period before`,
            `biggest decliners among ${pick(r, d.many)} ${pick(r, mp.say)}`,
            `which ${pick(r, d.one)} slowed down the most ${pick(r, mp.say)} vs the prior period`,
            `who fell off among ${pick(r, d.many)} ${pick(r, mp.say)}`,
          ])
    return {
      category: 'rankings_movers',
      text: phrase(withLine(core, l)),
      expected_kind: 'ranking',
      ground_truth: { fn: 'movers', dim: d.key, window: mp.window, line: l.key, direction: dirn },
      meta: { source: 'generated', family: `movers_${dirn}_${d.key}`, period_label: periodLabel(mp) },
    }
  }
  // Named entity (real or placeholder) — resolved at grade time
  const ed = pick(r, (['team', 'agent', 'carrier', 'state'] as const).filter((x) => entities[x].length > 0))
  if (!ed) return genRanking(entities)
  const name = pick(r, entities[ed])
  const core = pick(r, [
    `how is ${name} doing ${pick(r, p.say)}`,
    `where does ${name} rank ${pick(r, p.say)}`,
    `how much did ${name} write ${pick(r, p.say)}`,
    `give me ${name}'s numbers ${pick(r, p.say)}`,
    `what's ${name} at ${pick(r, p.say)}`,
  ])
  return {
    category: 'rankings_movers',
    text: phrase(core),
    expected_kind: 'number',
    ground_truth: { fn: 'entity', dim: ed, name, window: p.window, exists: entities.source === 'db' ? true : 'unknown' },
    meta: { source: 'generated', family: `entity_${ed}`, period_label: periodLabel(p), entity: name },
  }
}

function genFunnel(): Draft {
  const p = dataPeriod()
  const l = line()
  const k = r()
  const metric =
    k < 0.4 ? 'placement_pct' : k < 0.52 ? 'paid' : k < 0.66 ? 'declined' : k < 0.76 ? 'lapsed' : k < 0.84 ? 'submitted' : k < 0.92 ? 'decline_pct' : 'lapse_pct'
  const core: string = {
    placement_pct: pick(r, [
      `what's our placement rate ${pick(r, p.say)}`,
      `placement ratio ${pick(r, p.say)}`,
      `what percent of apps got placed ${pick(r, p.say)}`,
      `how's placement looking ${pick(r, p.say)}`,
      `issue-paid rate ${pick(r, p.say)}`,
      `what's the placement percentage ${pick(r, p.say)}`,
    ]),
    paid: pick(r, [
      `how many policies were issued and paid ${pick(r, p.say)}`,
      `how many apps got placed ${pick(r, p.say)}`,
      `issued policy count ${pick(r, p.say)}`,
      `how many went issue-paid ${pick(r, p.say)}`,
    ]),
    declined: pick(r, [
      `how many apps were declined ${pick(r, p.say)}`,
      `decline count ${pick(r, p.say)}`,
      `how many declines did we take ${pick(r, p.say)}`,
      `number of declined applications ${pick(r, p.say)}`,
    ]),
    lapsed: pick(r, [
      `how many policies lapsed ${pick(r, p.say)}`,
      `lapse count ${pick(r, p.say)}`,
      `how many have lapsed from the business written ${pick(r, p.say)}`,
    ]),
    submitted: pick(r, [
      `how many apps are still pending ${pick(r, p.say)}`,
      `how many are sitting in submitted status ${pick(r, p.say)}`,
      `what's still in underwriting from ${pick(r, p.say)}`,
      `pending count ${pick(r, p.say)}`,
    ]),
    decline_pct: pick(r, [`what's the decline rate ${pick(r, p.say)}`, `what percent got declined ${pick(r, p.say)}`, `decline percentage ${pick(r, p.say)}`]),
    lapse_pct: pick(r, [`what's the lapse rate ${pick(r, p.say)}`, `what percent has lapsed ${pick(r, p.say)}`, `lapse ratio ${pick(r, p.say)}`]),
  }[metric]
  const isList = r() < 0.12
  if (isList) {
    return {
      category: 'funnel_status',
      text: phrase(withLine(pick(r, [`walk me through the status funnel ${pick(r, p.say)}`, `give me submitted, issued, pending, declined and withdrawn ${pick(r, p.say)}`, `status breakdown ${pick(r, p.say)}`, `how many submitted vs issued vs declined ${pick(r, p.say)}`]), l)),
      expected_kind: 'list',
      ground_truth: { fn: 'funnel', window: p.window, line: l.key, metric: 'applications' },
      meta: { source: 'generated', family: 'funnel_full', period_label: periodLabel(p) },
    }
  }
  return {
    category: 'funnel_status',
    text: phrase(withLine(core, l)),
    expected_kind: 'number',
    ground_truth: { fn: 'funnel', window: p.window, line: l.key, metric },
    meta: { source: 'generated', family: `funnel_${metric}`, period_label: periodLabel(p) },
  }
}

function genPace(): Draft {
  const l = line()
  const k = r()
  if (k < 0.55) {
    const core = pick(r, [
      'where are we pacing for the month',
      'what will this month end at if we keep this pace',
      "what's the projected month-end premium",
      'are we on track to beat last month',
      'how does our run rate look this month',
      'what are we tracking to for October',
      'projected close for the month',
      'are we ahead or behind last month at this point',
      'what does month-end look like',
      'pace vs last month',
    ])
    return {
      category: 'pace_projection',
      text: phrase(withLine(core, l)),
      expected_kind: 'number',
      ground_truth: { fn: 'pace', line: l.key, horizon: 'month' },
      meta: { source: 'generated', family: 'pace_month', period_label: 'this month' },
    }
  }
  if (k < 0.85) {
    const core = pick(r, [
      'where will we end the year at this pace',
      "what's the full-year projection",
      'what are we tracking to for 2026',
      'annualized run rate',
      'if nothing changes what does 2026 close at',
      'are we on pace to hit $300M this year',
      'how much do we need per month to hit $350M for the year',
      'what does the year look like on current pace',
    ])
    return {
      category: 'pace_projection',
      text: phrase(withLine(core, l)),
      expected_kind: 'number',
      ground_truth: { fn: 'pace', line: l.key, horizon: 'year' },
      meta: { source: 'generated', family: 'pace_year', period_label: 'year' },
    }
  }
  const p = pick(r, RELATIVE_PERIODS.filter((x) => ['3m', '6m', '12m'].includes(x.key)))
  const core = pick(r, [
    `what's the trend ${pick(r, p.say)}`,
    `is premium trending up or down ${pick(r, p.say)}`,
    `show me the monthly trend ${pick(r, p.say)}`,
    `month by month ${pick(r, p.say)}`,
    `are we growing ${pick(r, p.say)}`,
  ])
  return {
    category: 'pace_projection',
    text: phrase(withLine(core, l)),
    expected_kind: 'list',
    ground_truth: { fn: 'trend', window: p.window, line: l.key },
    meta: { source: 'generated', family: 'trend', period_label: periodLabel(p) },
  }
}

function genCompare(entities: EntityList): Draft {
  const k = r()
  const l = line()
  if (k < 0.5) {
    // period vs period
    const pairs: Array<[Period, Period]> = []
    const closed = ALL_DATA_PERIODS.filter((p) => p.closed)
    for (let i = 0; i < 4; i++) {
      const a = pick(r, [...RELATIVE_PERIODS, ...closed])
      const b = pick(r, closed)
      if (a.key !== b.key) pairs.push([a, b])
    }
    const [a, b] = pairs[0] ?? [RELATIVE_PERIODS[0], MONTH_PERIODS_2026[8]]
    const metric = r() < 0.75 ? 'premium' : r() < 0.6 ? 'placement_pct' : 'policies'
    const noun = metric === 'premium' ? pick(r, ['premium', 'production', 'submitted premium']) : metric === 'placement_pct' ? 'placement' : 'policy count'
    const core = pick(r, [
      `compare ${noun} ${bare(a)} vs ${bare(b)}`,
      `how does ${bare(a)} compare to ${bare(b)} on ${noun}`,
      `${bare(a)} versus ${bare(b)} — ${noun}`,
      `was ${noun} better ${bare(a)} or ${bare(b)}`,
      `${noun} ${bare(a)} compared with ${bare(b)}`,
      `how much did ${noun} change from ${bare(b)} to ${bare(a)}`,
    ])
    return {
      category: 'comparisons',
      text: phrase(withLine(core, l)),
      expected_kind: 'number',
      ground_truth: { fn: 'compare', a: a.window, b: b.window, line: l.key, metric },
      meta: { source: 'generated', family: `compare_period_${metric}`, period_label: `${periodLabel(a)} vs ${periodLabel(b)}` },
    }
  }
  if (k < 0.75) {
    // line vs line
    const p = dataPeriod()
    const pairs: Array<[LineFilter, LineFilter]> = [
      ['Health', 'Life'],
      ['Life', 'Health'],
      ['Life', 'Annuity'],
      ['Health', 'Annuity'],
    ]
    const [x, y] = pick(r, pairs)
    const metric = r() < 0.8 ? 'premium' : 'policies'
    const core = pick(r, [
      `${x.toLowerCase()} vs ${y.toLowerCase()} ${pick(r, p.say)}`,
      `how does ${x.toLowerCase()} compare to ${y.toLowerCase()} ${pick(r, p.say)}`,
      `which is bigger ${pick(r, p.say)}, ${x.toLowerCase()} or ${y.toLowerCase()}`,
      `split between ${x.toLowerCase()} and ${y.toLowerCase()} ${pick(r, p.say)}`,
      `${x.toLowerCase()} versus ${y.toLowerCase()} ${metric === 'policies' ? 'policy count' : 'premium'} ${pick(r, p.say)}`,
      `what's the product mix ${pick(r, p.say)}`,
    ])
    return {
      category: 'comparisons',
      text: phrase(core),
      expected_kind: 'number',
      ground_truth: { fn: 'line_compare', window: p.window, lines: [x, y], metric },
      meta: { source: 'generated', family: 'compare_lines', period_label: periodLabel(p) },
    }
  }
  if (k < 0.9 && (entities.team.length >= 2 || entities.carrier.length >= 2)) {
    // entity vs entity
    const ed = entities.team.length >= 2 && (r() < 0.5 || entities.carrier.length < 2) ? 'team' : 'carrier'
    const pool = entities[ed]
    const a = pick(r, pool)
    let b = pick(r, pool)
    if (a === b) b = pool.find((x) => x !== a) ?? b
    const p = dataPeriod()
    const core = pick(r, [`${a} vs ${b} ${pick(r, p.say)}`, `how does ${a} stack up against ${b} ${pick(r, p.say)}`, `compare ${a} and ${b} ${pick(r, p.say)}`, `who did more, ${a} or ${b}, ${pick(r, p.say)}`])
    return {
      category: 'comparisons',
      text: phrase(core),
      expected_kind: 'number',
      ground_truth: { fn: 'entity', dim: ed, name: a, window: p.window, exists: entities.source === 'db' ? true : 'unknown' },
      meta: { source: 'generated', family: `compare_entity_${ed}`, period_label: periodLabel(p), entity: `${a} | ${b}` },
    }
  }
  // share questions
  const p = dataPeriod()
  const d = dim()
  const core = pick(r, [
    `what share of premium came from our top ${pick(r, d.one)} ${pick(r, p.say)}`,
    `how concentrated are we by ${pick(r, d.one)} ${pick(r, p.say)}`,
    `what percent of premium is the top 5 ${pick(r, d.many)} ${pick(r, p.say)}`,
    `how dependent are we on our biggest ${pick(r, d.one)} ${pick(r, p.say)}`,
  ])
  return {
    category: 'comparisons',
    text: phrase(withLine(core, l)),
    expected_kind: 'explanation',
    ground_truth: { fn: 'breakdown', dim: d.key, window: p.window, line: l.key, top_n: 5 },
    meta: { source: 'generated', family: `share_${d.key}`, period_label: periodLabel(p) },
  }
}

function genWhy(): Draft {
  const l = line()
  const k = r()
  if (k < 0.4) {
    const p = pick(r, [RELATIVE_PERIODS[0], RELATIVE_PERIODS[1], ...MONTH_PERIODS_2026.slice(5)])
    const core = pick(r, [
      `why is ${pick(r, p.say).replace(/^(in|for|during) /, '')} low`,
      `what happened ${pick(r, p.say)} — the number looks off`,
      `why did premium drop ${pick(r, p.say)}`,
      `explain the dip ${pick(r, p.say)}`,
      `${pick(r, p.say).replace(/^(in|for|during) /, '')} looks light, what's going on`,
      `why does ${pick(r, p.say).replace(/^(in|for|during) /, '')} look empty`,
      `what's behind the drop ${pick(r, p.say)}`,
    ])
    return {
      category: 'why_anomaly',
      text: phrase(withLine(core, l)),
      expected_kind: 'explanation',
      ground_truth: { fn: 'trend', window: '12m', line: l.key },
      meta: { source: 'generated', family: 'why_low_month', period_label: periodLabel(p), must_say: 'cites real monthly figures and flags if the month is missing/unsynced rather than guessing a business cause' },
    }
  }
  if (k < 0.7) {
    const d = dim()
    const mp = pick(r, RELATIVE_PERIODS.filter((x) => ['mtd', 'last_month', 'qtd', '3m'].includes(x.key)))
    const core = pick(r, [
      `which ${pick(r, d.one)} slowed down ${pick(r, mp.say)}`,
      `what dropped ${pick(r, mp.say)} — by ${pick(r, d.one)}`,
      `where did we lose premium ${pick(r, mp.say)} by ${pick(r, d.one)}`,
      `any ${pick(r, d.many)} that fell off ${pick(r, mp.say)}`,
      `what's driving the change ${pick(r, mp.say)} by ${pick(r, d.one)}`,
      `which ${pick(r, d.one)} explains most of the move ${pick(r, mp.say)}`,
    ])
    return {
      category: 'why_anomaly',
      text: phrase(withLine(core, l)),
      expected_kind: 'explanation',
      ground_truth: { fn: 'movers', dim: d.key, window: mp.window, line: l.key, direction: 'down' },
      meta: { source: 'generated', family: `why_dim_${d.key}`, period_label: periodLabel(mp) },
    }
  }
  const p = dataPeriod()
  const core = pick(r, [
    `anything unusual ${pick(r, p.say)}`,
    `any anomalies I should know about ${pick(r, p.say)}`,
    `what should I be worried about ${pick(r, p.say)}`,
    `what's the one thing to watch ${pick(r, p.say)}`,
    `is placement slipping ${pick(r, p.say)}`,
    `why is placement down ${pick(r, p.say)}`,
    `are declines up ${pick(r, p.say)}`,
    `what's the biggest risk in the book ${pick(r, p.say)}`,
  ])
  return {
    category: 'why_anomaly',
    text: phrase(withLine(core, l)),
    expected_kind: 'explanation',
    ground_truth: { fn: 'funnel', window: p.window, line: l.key, metric: 'placement_pct' },
    meta: { source: 'generated', family: 'why_watch', period_label: periodLabel(p) },
  }
}

function genFreshness(): Draft {
  const k = r()
  if (k < 0.3) {
    const core = pick(r, [
      'when was this data last synced',
      'how fresh are these numbers',
      'when did the Airtable sync last run',
      'as of when is this',
      'is this live or from last night',
      'what time was the last refresh',
      'how current is the book of business data',
      'did the sync run today',
    ])
    return {
      category: 'data_freshness_definitions',
      text: phrase(core),
      expected_kind: 'explanation',
      ground_truth: { fn: 'freshness' },
      meta: { source: 'generated', family: 'freshness_sync', must_say: 'states a sync time or honestly says it cannot see one; never claims real-time' },
    }
  }
  if (k < 0.55) {
    const core = pick(r, [
      'do you have 2025 data',
      'how far back does your data go',
      'can you see last year',
      "what's the earliest month you have",
      'do you have anything before January',
      'is 2025 in here',
      'do we have prior-year numbers loaded',
      'what months do you actually have data for',
    ])
    return {
      category: 'data_freshness_definitions',
      text: phrase(core),
      expected_kind: 'refusal_no_data',
      ground_truth: { fn: 'freshness' },
      meta: { source: 'generated', family: 'freshness_history', must_say: 'says plainly whether 2025 rows exist (currently none) and what the earliest month is' },
    }
  }
  const core = pick(r, [
    'what counts as issued',
    'what do you mean by placement rate',
    'how is premium calculated here',
    'is premium annual or monthly',
    "what's the difference between submitted and issued",
    'what date is premium bucketed by',
    'does placement include pending apps',
    'what does lapsed mean in your numbers',
    'is annuity included in the totals',
    'what is funded premium',
    'what is "withdrawn" in the funnel',
    'are these numbers issued premium or submitted premium',
    'where do these numbers come from',
    'which bases are included — just Pinnacle or the agency books too',
    'how do you define a decline',
    'is this effective date or submit date',
  ])
  return {
    category: 'data_freshness_definitions',
    text: phrase(core),
    expected_kind: 'explanation',
    ground_truth: { fn: 'none', reason: 'definition question — graded by rubric against the tool notes (annual premium by effective date; placement = paid ÷ applications)' },
    meta: { source: 'generated', family: 'definition' },
  }
}

const PEOPLE = ['Brad', 'Spencer', 'the board', 'our CFO', 'the Transamerica rep', 'the carrier relations team', 'the East Team leads', 'our top 10 producers', 'the compliance lead', 'Dana', 'the ops team']
function genCalendar(): Draft {
  const k = r()
  if (k < 0.3) {
    const core = pick(r, [
      "what's on my calendar today",
      'what meetings do I have this week',
      'what does tomorrow look like',
      'anything on my calendar this afternoon',
      "what's my next meeting",
      'do I have anything Friday',
      'how many meetings this week',
      "who am I meeting with today",
      'am I free Thursday at 2',
      "what's on the calendar for the rest of the month",
    ])
    return {
      category: 'calendar_actions',
      text: phrase(core),
      expected_kind: 'list',
      ground_truth: { fn: 'none', reason: 'calendar read — grader checks list_calendar_events was called and the answer never invents meetings' },
      meta: { source: 'generated', family: 'calendar_read', expects_tools: ['list_calendar_events'], must_say: 'lists real events from the calendar tool or says the calendar is not connected; never invents meetings' },
    }
  }
  if (k < 0.6) {
    const who = pick(r, PEOPLE)
    const p = pick(r, [RELATIVE_PERIODS[1], RELATIVE_PERIODS[3], ...MONTH_PERIODS_2026.slice(6)])
    const topic = pick(r, [
      `${pick(r, p.say)} premium`,
      `placement ${pick(r, p.say)}`,
      `the ${pick(r, p.say).replace(/^(in|for|during) /, '')} numbers`,
      'our carrier concentration',
      'the Q4 push',
      `the dip ${pick(r, p.say)}`,
      'declines trending up',
    ])
    const core = pick(r, [
      `draft an email to ${who} about ${topic}`,
      `write ${who} a short note on ${topic}`,
      `put together an email for ${who} summarizing ${topic}`,
      `draft a message to ${who} — ${topic}, keep it tight`,
      `email ${who} the headline on ${topic}`,
    ])
    return {
      category: 'calendar_actions',
      text: phrase(core),
      expected_kind: 'action',
      ground_truth: { fn: 'none', reason: 'draft — rubric checks a complete, sendable draft with real numbers (pulled via pinnacle_revenue), and that Mira does not claim it was sent' },
      meta: { source: 'generated', family: 'draft_email', expects_tools: ['pinnacle_revenue'], must_say: 'a full draft with subject + body using real numbers; does not claim to have sent it unless a send was actually delegated' },
    }
  }
  if (k < 0.8) {
    const when = pick(r, ['Friday', 'tomorrow morning', 'Monday at 9', 'next Tuesday', 'end of day', 'Thursday', 'in an hour', 'the 15th'])
    const what = pick(r, ['call the Transamerica rep', 'review the September placement report', 'follow up with Brad on the carrier contract', 'check the October pace', 'send the board deck', 'look at the decline report', 'ask ops about the sync', 'review top producer comp'])
    const core = pick(r, [`remind me ${when} to ${what}`, `set a reminder for ${when}: ${what}`, `add a task to ${what} by ${when}`, `make sure I ${what} ${when}`, `note to self — ${what} ${when}`])
    return {
      category: 'calendar_actions',
      text: phrase(core),
      expected_kind: 'action',
      ground_truth: { fn: 'none', reason: 'reminder — deterministic: a brain_item/defer_item/assign_task intent must be delegated' },
      meta: { source: 'generated', family: 'reminder', expects_intents: ['brain_item', 'defer_item', 'assign_task', 'schedule_followup'], must_say: 'short confirmation with the resolved date' },
    }
  }
  if (k < 0.92) {
    const who = pick(r, ['Spencer', 'Brad', 'the East Team leads', 'the Mutual of Omaha rep', 'Dana'])
    const when = pick(r, ['Thursday at 2pm', 'tomorrow at 10', 'Friday morning', 'next Monday at 3', 'Wednesday 1pm'])
    const core = pick(r, [`book 30 minutes with ${who} ${when}`, `set up a meeting with ${who} ${when}`, `put ${who} on my calendar ${when}`, `schedule a call with ${who} ${when} about Q4`])
    return {
      category: 'calendar_actions',
      text: phrase(core),
      expected_kind: 'action',
      ground_truth: { fn: 'none', reason: 'booking — deterministic: a book_meeting/request_one_on_one intent must be delegated' },
      meta: { source: 'generated', family: 'book_meeting', expects_intents: ['book_meeting', 'request_one_on_one'], must_say: 'confirms the booking with the resolved date/time' },
    }
  }
  const core = pick(r, [
    'summarize last board meeting',
    'what did we decide in the Monday leadership meeting',
    'recap my last call with Brad',
    'pull up the notes from the carrier review',
    'what were the action items from yesterday’s exec meeting',
    'who said what in the Q3 review',
  ])
  return {
    category: 'calendar_actions',
    text: phrase(core),
    expected_kind: 'explanation',
    ground_truth: { fn: 'none', reason: 'meeting recall — no transcript tool exists today; correct answer says so plainly and offers what it can do' },
    meta: { source: 'generated', family: 'meeting_recall', must_say: 'says it has no access to meeting notes/transcripts (no tool), does not invent a recap, offers a next step' },
  }
}

function genTrick(_entities: EntityList): Draft {
  const k = r()
  const l = line()
  if (k < 0.32) {
    // missing period
    const p = pick(r, MISSING_PERIODS)
    const metric = r() < 0.7 ? 'premium' : 'policies'
    const core =
      metric === 'premium'
        ? pick(r, [`how much premium did we write ${pick(r, p.say)}`, `what was production ${pick(r, p.say)}`, `total premium ${pick(r, p.say)}`, `what did we do ${pick(r, p.say)}`])
        : pick(r, [`how many policies ${pick(r, p.say)}`, `policy count ${pick(r, p.say)}`])
    return {
      category: 'ambiguous_trick',
      text: phrase(withLine(core, l)),
      expected_kind: 'refusal_no_data',
      ground_truth: { fn: 'period', window: p.window, line: l.key, metric },
      meta: { source: 'generated', family: 'missing_period', period_label: periodLabel(p), must_say: 'no data for that period in the synced book; offers the nearest period it does have' },
    }
  }
  if (k < 0.52) {
    // last-year compare
    const p = pick(r, [RELATIVE_PERIODS[0], RELATIVE_PERIODS[1], RELATIVE_PERIODS[3], RELATIVE_PERIODS[2], ...QUARTER_PERIODS_2026])
    const core = pick(r, [
      `how does ${pick(r, p.say)} compare to last year`,
      `are we up or down year over year ${pick(r, p.say)}`,
      `${pick(r, p.say)} vs same period 2025`,
      `YoY growth ${pick(r, p.say)}`,
      `what's the year-over-year change ${pick(r, p.say)}`,
      `how much better is ${pick(r, p.say)} than the same time in 2025`,
    ])
    return {
      category: 'ambiguous_trick',
      text: phrase(withLine(core, l)),
      expected_kind: 'refusal_no_data',
      ground_truth: { fn: 'compare', a: p.window, b: 'last_year', line: l.key, metric: 'premium' },
      meta: { source: 'generated', family: 'ly_compare', period_label: periodLabel(p), must_say: 'gives the current-period number and says plainly there is no 2025 data to compare against; never invents a YoY %' },
    }
  }
  if (k < 0.72) {
    // invented entity
    const fe = pick(r, FAKE_ENTITIES)
    const p = dataPeriod()
    const core = pick(r, [`how much did ${fe.name} write ${pick(r, p.say)}`, `where does ${fe.name} rank ${pick(r, p.say)}`, `give me ${fe.name}'s numbers ${pick(r, p.say)}`, `how is ${fe.name} doing ${pick(r, p.say)}`, `${fe.name} premium ${pick(r, p.say)}`])
    return {
      category: 'ambiguous_trick',
      text: phrase(core),
      expected_kind: 'refusal_no_data',
      ground_truth: { fn: 'entity', dim: fe.dim, name: fe.name, window: p.window, exists: false },
      meta: { source: 'generated', family: `invented_${fe.dim}`, period_label: periodLabel(p), entity: fe.name, must_say: `says ${fe.name} is not in the data and offers the closest real names; never gives a number for it` },
    }
  }
  if (k < 0.88) {
    // metrics that do not exist
    const core = pick(r, [
      "what's our 13-month persistency",
      'what is our loss ratio this year',
      'how many agents are licensed in Texas',
      "what's our NPS",
      'how much commission did we earn on last month’s premium',
      'what’s the average age of our insureds',
      'how many of our apps were e-apps vs paper',
      'what’s the average time to issue',
      'how much premium is from replacements',
      'which carriers pay the highest comp',
      'what’s our chargeback exposure',
      'how many new agents were contracted this month',
      'what was our ad spend last month',
      'how many leads did we buy in September',
      'what’s the face amount total year to date',
      'what’s our renewal rate',
    ])
    return {
      category: 'ambiguous_trick',
      text: phrase(core),
      expected_kind: 'refusal_no_data',
      ground_truth: { fn: 'none', reason: 'metric is not in the synced data' },
      meta: { source: 'generated', family: 'missing_metric', must_say: 'says the metric is not in the data it has, names what it does have that is closest, no invented figure' },
    }
  }
  // ambiguous / malformed
  const core = pick(r, [
    'how are we doing',
    'numbers',
    'give me the premium for Q5',
    'what did we write on February 30',
    'top 0 agents this month',
    'which is bigger, health or dental',
    'compare this month to this month',
    'what was premium in the month of',
    'is it good',
    'premium for the last -3 months',
    'who is the top team in Life for Health',
    'what was last month’s number for next month',
  ])
  return {
    category: 'ambiguous_trick',
    text: phrase(core),
    expected_kind: 'explanation',
    ground_truth: { fn: 'none', reason: 'ambiguous/malformed — rubric checks a sensible default is stated or one clarifying question is asked, no invented figure' },
    meta: { source: 'generated', family: 'ambiguous', must_say: 'either picks a sensible default and says which, or asks one short clarifying question; never a made-up number' },
  }
}

/** Casual / voice / typo transforms applied to a base draft from another category. */
const TYPOS: Array<[RegExp, string]> = [
  [/premium/g, 'premum'],
  [/agents/g, 'agnts'],
  [/what/g, 'wat'],
  [/placement/g, 'placment'],
  [/carriers/g, 'carriers'],
  [/month/g, 'mnth'],
  [/September/g, 'sept'],
  [/how much/g, 'how mch'],
  [/the /g, 'teh '],
  [/this/g, 'tihs'],
]
function casualize(d: Draft): Draft {
  const k = r()
  let text = d.text.replace(/^(Mira, |Hey Mira, |Quick one — |Quick question: |Can you tell me |I need to know |Pull up |Give me |Remind me — |Before the board call, )/, '')
  let style: string
  if (k < 0.3) {
    style = 'short'
    text = text
      .replace(/^(what's|what is|what was|how much|how many|give me|show me|tell me|can you)\s+(our|the|total)?\s*/i, '')
      .replace(/\?$/, '')
      .trim()
    text = text.length > 4 ? text + '?' : d.text
  } else if (k < 0.6) {
    style = 'typos'
    const n = 1 + Math.floor(r() * 2)
    for (let i = 0; i < n; i++) {
      const [re, rep] = pick(r, TYPOS)
      text = text.replace(re, rep)
    }
    text = text.toLowerCase().replace(/[?.]$/, '')
  } else if (k < 0.8) {
    style = 'voice'
    text = pick(r, ['ok so ', 'yo mira ', 'hey um ', 'quick ', 'alright ', 'mira ']) + text.toLowerCase().replace(/[?.]$/, '') + pick(r, ['', ' real quick', ' pls', ' thx', ' go'])
  } else {
    style = 'slang'
    text = text
      .toLowerCase()
      .replace(/who are the top (\d+) (agents|producers|reps)/, 'who\'s killing it among $2 (top $1)')
      .replace(/which (teams|agencies) are at the bottom/, 'whos slackin among $1')
      .replace(/how much premium did we write/, 'how much did we put up')
      .replace(/what's our placement rate/, 'placement rate pls')
      .replace(/[?.]$/, '')
    text = text + pick(r, ['', '?', ' ??', ' lol'])
  }
  return { ...d, category: 'casual_exec', text: text.replace(/\s{2,}/g, ' ').trim(), meta: { ...d.meta, style, family: `casual_${d.meta.family ?? d.category}` } }
}

// ── main ───────────────────────────────────────────────────────────────────

async function loadEntities(): Promise<EntityList> {
  if (!args['from-db']) {
    if (fs.existsSync(ENTITIES_FILE)) return JSON.parse(fs.readFileSync(ENTITIES_FILE, 'utf8')) as EntityList
    return PLACEHOLDER_ENTITIES
  }
  loadEnv(repoRoot())
  const { fetchBreakdown } = await import('@/lib/pinnacle/rollup')
  const { resolveWindow } = await import('@/lib/mcp/data')
  const { BANK_TODAY } = await import('./lib/vocab')
  const w = resolveWindow('12m', BANK_TODAY)
  const out: EntityList = { source: 'db', team: [], agent: [], carrier: [], state: [], product: [] }
  for (const d of ['team', 'agent', 'carrier', 'state', 'product'] as const) {
    const rows = await fetchBreakdown(d, 'All', w.start, w.end, 25)
    out[d] = rows.map((x) => x.label).filter(Boolean)
  }
  fs.writeFileSync(ENTITIES_FILE, JSON.stringify(out, null, 2) + '\n')
  console.log(`entities.json written from DB: ${Object.entries(out).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`).join(' ')}`)
  return out
}

function generatorFor(cat: Category, entities: EntityList): () => Draft {
  switch (cat) {
    case 'headline_numbers':
      return genHeadline
    case 'rankings_movers':
      return () => genRanking(entities)
    case 'funnel_status':
      return genFunnel
    case 'pace_projection':
      return genPace
    case 'comparisons':
      return () => genCompare(entities)
    case 'why_anomaly':
      return genWhy
    case 'data_freshness_definitions':
      return genFreshness
    case 'calendar_actions':
      return genCalendar
    case 'ambiguous_trick':
      return () => genTrick(entities)
    case 'casual_exec': {
      const bases = [genHeadline, () => genRanking(entities), genFunnel, genPace, () => genCompare(entities), genWhy]
      return () => casualize(pick(r, bases)())
    }
  }
}

async function main() {
  const entities = await loadEntities()
  const hand = HANDWRITTEN
  const handByCat = new Map<Category, number>()
  for (const h of hand) handByCat.set(h.category, (handByCat.get(h.category) ?? 0) + 1)

  const seen = new Set<string>(hand.map((h) => normalize(h.text)))
  const rows: Question[] = []
  const counts: Record<string, number> = {}

  for (const cat of CATEGORIES) {
    const want = Math.max(0, Math.round(TARGET * SHARES[cat]) - (handByCat.get(cat) ?? 0))
    const gen = generatorFor(cat, entities)
    let made = 0
    let attempts = 0
    while (made < want && attempts < want * 40) {
      attempts++
      const d = gen()
      const key = normalize(d.text)
      if (!key || seen.has(key)) continue
      seen.add(key)
      made++
      rows.push({ id: '', ...d })
    }
    counts[cat] = made
    if (made < want) console.warn(`[generate] ${cat}: only ${made}/${want} unique after ${attempts} attempts`)
  }

  const all: Question[] = shuffle(r, [...rows, ...hand.map((h) => ({ id: '', ...h }))])
  all.forEach((q, i) => (q.id = `q${String(i + 1).padStart(5, '0')}`))
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'bank.jsonl')
  fs.writeFileSync(out, all.map((q) => JSON.stringify(q)).join('\n') + '\n')

  const byCat: Record<string, { generated: number; handwritten: number; total: number }> = {}
  for (const q of all) {
    const b = (byCat[q.category] ??= { generated: 0, handwritten: 0, total: 0 })
    b[q.meta.source]++
    b.total++
  }
  const byKind: Record<string, number> = {}
  for (const q of all) byKind[q.expected_kind] = (byKind[q.expected_kind] ?? 0) + 1
  const withGt = all.filter((q) => q.ground_truth && q.ground_truth.fn !== 'none').length
  const summary = { total: all.length, seed: SEED, entities: entities.source, by_category: byCat, by_kind: byKind, with_ground_truth: withGt }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`wrote ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
