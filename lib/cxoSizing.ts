/**
 * Private server sizing: the ONE formula for "you need this size, it costs
 * this much". The /cxo/sizing calculator and the vault job
 * "Size a Private Server" (04 Jobs/Ciao - Suite CXO/) use these numbers, so
 * the page and our quotes always agree. Change a number here, change the job.
 *
 * Pure: no imports beyond the fee constants, no I/O. Client-safe.
 *
 * Copy rule: labels shown to clients never name a model, a model maker, a
 * chip maker or a card. Plain sizes only ("Office box", "Team server").
 * What each size really is (kept for us, never rendered):
 *   office-small  desktop, 128 GB unified memory (M5 Max class)
 *   office        desktop, 256 GB unified memory (M5 Ultra class)
 *   team          workstation, 4 x 96 GB pro cards (384 GB)
 *   company       rack server, 8 x 96 GB server cards (768 GB)
 *   rented        dedicated GPU server(s) in a data center, ours to run
 *
 * Prices live-checked 2026-10-20 (sources in the vault job):
 *   - 128 GB desktop: $5,099 (512 GB SSD) to $5,399 (1 TB), AppleInsider
 *     2026-10-02 and Abt; 4 TB tested at $6,899 (Macworld 2026-09-21).
 *   - 256 GB desktop: $10,799 with 1 TB at launch (configurator, 2026-08-25).
 *   - 96 GB pro card: $12,100 (Newegg, 2026-06) to $16,000 (maker store,
 *     2026-08); server edition eBay average $20,580 (2026-09).
 *   - Rented 1-card server: EUR 1,499/mo + EUR 1,499 setup (Hetzner GEX131,
 *     2026-10-20). 8-GPU cloud node: $5.29/GPU-hr (Lambda 8x B200, 2026-06)
 *     to $8.60 (CoreWeave); H200 nodes cheaper.
 *   - Power: US commercial average 13.5-14.5 cents/kWh (EIA via
 *     secondary sources, 2026); we use 14-18 cents plus cooling.
 *
 * Concurrency (see the job for sources): one 96 GB card served 50 parallel
 * chats on a ~120B mixture-of-experts model at ~31 tokens/s each (1,525
 * tokens/s total, short prompts). The 256 GB desktop does ~41 tokens/s for
 * ONE chat on the large model. People read at ~5-10 tokens/s; we size for
 * 15 tokens/s each so answers feel quick. `streams` below = answers the box
 * can write at the same moment at that speed, for short questions.
 */

import { CXO_PRIVATE_BUILD_FEE, CXO_PRIVATE_CARE_FEE } from './cxoSite'

export type TierId = keyof typeof CXO_PRIVATE_BUILD_FEE
export type Workload = 'short' | 'mixed' | 'long'
export type Placement = 'office' | 'rented'
/** [low, high] in US dollars. */
export type Range = readonly [number, number]

export type SizingInput = {
  /** Everyone who will use it. */
  staff: number
  /** People using it in the same few minutes at the busiest time. Blank = 18% of staff. */
  peak?: number | null
  workload: Workload
  /** Must keep working with the internet off, or never touch the internet. Forces an office box. */
  offline: boolean
  /** Where they want it. Ignored (office) when offline is true. */
  placement: Placement
  /** Company files it should read, in GB. */
  fileGb: number
  /** Train it on their own examples (style, report format). */
  fineTune: boolean
}

type Box = {
  tier: TierId
  label: string
  size: string
  model: string
  /** Model file size in GB (for storage). */
  modelGb: number
  /** Parallel answers at 15 tokens/s, short questions. */
  streams: number
  /** One-time hardware per box (incl. 1 TB storage). */
  hardware: Range
  /** Storage included in `hardware`, TB. */
  includedTb: number
  /** Extra storage per TB above the included amount. */
  perTb: Range
  /** Average draw in kW over a month, incl. cooling. */
  kw: Range
  /** UPS battery backup, one-time. */
  ups: Range
  /** UPS battery replacement, spread per month. */
  upsMonthly: Range
  /** Rent per month (rented only). */
  rent: Range
}

/** The default share of staff using it at the busiest moment. */
export const PEAK_SHARE = 0.18

/** Share of the "at once" people whose answer is being written at any instant. */
export const DUTY: Record<Workload, number> = { short: 0.35, mixed: 0.45, long: 0.6 }

/** Long documents and reports cost more per answer (long reading, long writing). */
export const WORKLOAD_FACTOR: Record<Workload, number> = { short: 1, mixed: 0.7, long: 0.4 }

/** Power price range, $/kWh. */
export const POWER_PRICE: Range = [0.14, 0.18]
const HOURS_PER_MONTH = 730

/** Owned boxes, smallest first. */
export const OFFICE_BOXES: readonly Box[] = [
  {
    tier: 'office-small',
    label: 'Office box (small)',
    size: 'A quiet desktop box',
    model: 'Mid-size AI model',
    modelGb: 70,
    streams: 3,
    hardware: [5_100, 5_400],
    includedTb: 1,
    perTb: [500, 550],
    kw: [0.05, 0.15],
    ups: [200, 300],
    upsMonthly: [5, 10],
    rent: [0, 0],
  },
  {
    tier: 'office',
    label: 'Office box',
    size: 'A quiet desktop box',
    model: 'Large AI model',
    modelGb: 180,
    streams: 6,
    hardware: [10_800, 11_300],
    includedTb: 1,
    perTb: [500, 550],
    kw: [0.08, 0.25],
    ups: [200, 300],
    upsMonthly: [5, 10],
    rent: [0, 0],
  },
  {
    tier: 'team',
    label: 'Team server',
    size: 'A workstation for a closet or server room',
    model: 'Large AI model',
    modelGb: 180,
    streams: 60,
    hardware: [60_000, 80_000],
    includedTb: 4,
    perTb: [150, 250],
    kw: [0.8, 2.0],
    ups: [1_500, 2_500],
    upsMonthly: [30, 60],
    rent: [0, 0],
  },
  {
    tier: 'company',
    label: 'Company server',
    size: 'A rack server for a server room',
    model: 'Largest open AI model',
    modelGb: 460,
    streams: 120,
    hardware: [130_000, 200_000],
    includedTb: 8,
    perTb: [150, 250],
    kw: [2.6, 6.5],
    ups: [4_000, 8_000],
    upsMonthly: [80, 150],
    rent: [0, 0],
  },
] as const

/** Rented private servers (no hardware at the client), smallest first. `hardware` = one-time setup fees. */
export const RENTED_BOXES: readonly Box[] = [
  {
    tier: 'rented',
    label: 'Rented private server',
    size: 'Small: one AI card, in a data center',
    model: 'Mid-size AI model',
    modelGb: 70,
    streams: 25,
    hardware: [1_700, 1_900],
    includedTb: 2,
    perTb: [0, 0],
    kw: [0, 0],
    ups: [0, 0],
    upsMonthly: [0, 0],
    rent: [1_700, 1_900],
  },
  {
    tier: 'rented',
    label: 'Rented private server',
    size: 'Large: four AI cards, in a data center',
    model: 'Large AI model',
    modelGb: 180,
    streams: 60,
    hardware: [6_800, 7_600],
    includedTb: 8,
    perTb: [0, 0],
    kw: [0, 0],
    ups: [0, 0],
    upsMonthly: [0, 0],
    rent: [6_800, 7_600],
  },
  {
    tier: 'rented',
    label: 'Rented private server',
    size: 'Largest: eight AI cards, in a data center',
    model: 'Largest open AI model',
    modelGb: 460,
    streams: 120,
    hardware: [0, 0],
    includedTb: 8,
    perTb: [0, 0],
    kw: [0, 0],
    ups: [0, 0],
    upsMonthly: [0, 0],
    rent: [17_000, 31_000],
  },
] as const

/** One fine-tune run on rented GPUs (hours to a day); redone when the model is upgraded. */
export const FINE_TUNE_RUN: Range = [500, 2_000]

/** Storage sizes we buy, TB. */
const TB_STEPS = [1, 2, 4, 8, 16, 32, 64] as const

export type SizingResult = {
  tier: TierId
  label: string
  size: string
  model: string
  /** How many of that box. */
  boxes: number
  peak: number
  /** Answers being written at the same instant at the busiest time. */
  streamsNeeded: number
  /** What the recommendation can write at once for this workload. */
  streamsCapacity: number
  storageTb: number
  /** One-time: hardware (or rented setup), UPS and extra storage. */
  hardware: Range
  monthly: Range
  monthlyParts: { power: Range; ups: Range; rent: Range; care: number }
  /** Our one-time build fee (DRAFT, see lib/cxoSite.ts). */
  buildFee: number
  /** Our monthly care fee (DRAFT), already inside `monthly`. */
  careFee: number
  /** One fine-tune run, when asked for. */
  fineTuneRun: Range | null
  /** True when offline forced an office box over a rented one. */
  offlineForcedOffice: boolean
}

const clampInt = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback
  return Math.min(max, Math.max(min, v))
}

/** Default peak: 18% of staff, at least 1. */
export function defaultPeak(staff: number): number {
  const s = clampInt(staff, 1, 100_000, 1)
  return Math.max(1, Math.round(s * PEAK_SHARE))
}

/** Storage: two model copies (current + rollback) + files x2.5 (originals, search index, local snapshot) + 200 GB system. */
export function storageTbFor(modelGb: number, fileGb: number): number {
  const gb = modelGb * 2 + Math.max(0, fileGb) * 2.5 + 200
  const tb = gb / 1000
  return TB_STEPS.find((s) => s >= tb) ?? Math.ceil(tb / 64) * 64
}

const add = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Range, k: number): Range => [a[0] * k, a[1] * k]

export function sizePrivateServer(input: SizingInput): SizingResult {
  const staff = clampInt(input.staff, 1, 100_000, 1)
  const peak = clampInt(input.peak ?? defaultPeak(staff), 1, staff, defaultPeak(staff))
  const workload: Workload = input.workload in DUTY ? input.workload : 'mixed'
  const fileGb = Math.max(0, Number.isFinite(input.fileGb) ? input.fileGb : 0)
  const wantsRented = input.placement === 'rented'
  const offlineForcedOffice = wantsRented && input.offline
  const rented = wantsRented && !input.offline

  const streamsNeeded = Math.max(1, Math.ceil(peak * DUTY[workload] - 1e-9))
  const factor = WORKLOAD_FACTOR[workload]
  const ladder = rented ? RENTED_BOXES : OFFICE_BOXES

  // Smallest box that fits; past the biggest, several of the biggest.
  let box = ladder.find((b) => b.streams * factor >= streamsNeeded)
  let boxes = 1
  if (!box) {
    box = ladder[ladder.length - 1]
    boxes = Math.ceil(streamsNeeded / (box.streams * factor))
  }

  const storageTb = storageTbFor(box.modelGb, fileGb)
  const extraTb = Math.max(0, storageTb - box.includedTb)

  const perBoxOnce = add(add(box.hardware, box.ups), mul(box.perTb, extraTb))
  const hardware = mul(perBoxOnce, boxes)

  const power: Range = mul([box.kw[0] * HOURS_PER_MONTH * POWER_PRICE[0], box.kw[1] * HOURS_PER_MONTH * POWER_PRICE[1]], boxes)
  const ups = mul(box.upsMonthly, boxes)
  const rent = mul(box.rent, boxes)
  const careFee = CXO_PRIVATE_CARE_FEE[box.tier] * boxes
  const monthly = add(add(add(power, ups), rent), [careFee, careFee])

  return {
    tier: box.tier,
    label: box.label,
    size: box.size,
    model: box.model,
    boxes,
    peak,
    streamsNeeded,
    streamsCapacity: Math.floor(box.streams * factor * boxes * 10) / 10,
    storageTb,
    hardware: [Math.round(hardware[0]), Math.round(hardware[1])],
    monthly: [Math.round(monthly[0]), Math.round(monthly[1])],
    monthlyParts: {
      power: [Math.round(power[0]), Math.round(power[1])],
      ups,
      rent,
      care: careFee,
    },
    buildFee: CXO_PRIVATE_BUILD_FEE[box.tier],
    careFee,
    fineTuneRun: input.fineTune ? FINE_TUNE_RUN : null,
    offlineForcedOffice,
  }
}

/** Round for display: to $10 under $1k, $100 under $10k, else $1,000. */
export function roundMoney(n: number): number {
  const step = n < 1_000 ? 10 : n < 10_000 ? 100 : 1_000
  return Math.round(n / step) * step
}

const usd = (n: number) => `$${roundMoney(n).toLocaleString('en-US')}`

/** "$5,300 to $5,700", or one figure when both ends round the same. */
export function formatRange(r: Range): string {
  const [a, b] = [usd(r[0]), usd(r[1])]
  return a === b ? a : `${a} to ${b}`
}
