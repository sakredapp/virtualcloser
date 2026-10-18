/**
 * Seed an INVENTED producer book on the review/demo tenant only, for Ciao QA
 * and demos of producer_production (QA gap #1, 2026-10-18).
 *
 * Every name is made up and obviously so (Sampleton, Mockridge, ...); there
 * are no clients, no contact details, nothing real. Deterministic (fixed
 * seed), and it replaces the demo tenant's book each run.
 *
 * Hard guard: writes only to rep_store_review_pinnacle. Any other tenant id
 * is refused, there is no flag to change it.
 *
 *   npx tsx scripts/qa/seed-demo-producer-book.ts --env-file <env file> [--today 2026-10-18] [--dry-run]
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DEMO_TENANT = 'rep_store_review_pinnacle'

function loadEnvFile(file: string): void {
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? '' : null
}

// Deterministic PRNG (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const AGENCIES = ['Demo Northstar Agency', 'Demo Harbor Point Group', 'Demo Summit Ridge Partners', 'Demo Lakeside Benefits']
// Carriers place differently and issue at different speeds, so placement by
// carrier and the pending lag have something to show: [name, placement shift, issue days min, max].
const CARRIERS: readonly (readonly [string, number, number, number])[] = [
  ['Sample Mutual', 0, 7, 21],
  ['Example Life Co', 0.06, 5, 12],
  ['Placeholder National', -0.2, 14, 35],
  ['Demo Benefit Assurance', 0, 7, 21],
  ['Mockup Guaranty', 0.1, 4, 10],
  ['Fictional Fidelity', -0.06, 10, 28],
]
const FIRST = ['Avery', 'Blake', 'Casey', 'Dana', 'Elliot', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Logan', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Tatum', 'Umi', 'Vale', 'Wren', 'Xan', 'Yael', 'Zion', 'Rowan', 'Emery', 'Hollis', 'Jesse', 'Marlo', 'Sloane']
const LAST = ['Sampleton', 'Mockridge', 'Testwell', 'Fauxley', 'Demoski', 'Placeholt', 'Dummond', 'Fictor', 'Pretendo', 'Specimen', 'Stubbins', 'Notreal', 'Examplar', 'Shamwell', 'Facsimile', 'Proxley']

// Producer archetypes: monthly applications, recent trend multiplier.
//   quiet     stopped writing 100-170 days ago, so they cross the 90-day
//             inactive line inside the last 90 days (retention "stopped")
//   drifting  still active, but no policy for the last 35-80 days
//   back      a 120-day gap, then writing again (retention "reactivated")
type Kind = 'star' | 'solid' | 'steady' | 'light' | 'slipping' | 'quiet' | 'new' | 'rising' | 'drifting' | 'back'
const PLAN: Kind[] = [
  'star', 'star', 'star',
  'solid', 'solid', 'solid', 'solid', 'solid', 'solid',
  'steady', 'steady', 'steady', 'steady', 'steady', 'steady', 'steady',
  'light', 'light', 'light', 'light',
  'slipping', 'slipping', 'slipping', 'slipping',
  'quiet', 'quiet',
  'new', 'new', 'new', 'new',
  'rising', 'rising',
  'quiet', 'drifting', 'drifting', 'back', 'back',
]
const BASE_APPS: Record<Kind, number> = { star: 16, solid: 10, steady: 7, light: 3, slipping: 9, quiet: 6, new: 5, rising: 4, drifting: 7, back: 6 }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

async function main() {
  const envFile = arg('env-file')
  if (!envFile || !fs.existsSync(envFile)) throw new Error('--env-file <file> is required')
  loadEnvFile(envFile)
  const today = arg('today') || iso(new Date())
  const dry = process.argv.includes('--dry-run')
  const tenant = DEMO_TENANT
  if (tenant !== 'rep_store_review_pinnacle') throw new Error('refusing: demo tenant only')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase URL and service role key are required in the env file')
  const db = createClient(url, key, { auth: { persistSession: false } })

  // The tenant must exist and be the review/demo tenant.
  const { data: rep, error: repErr } = await db.from('reps').select('id').eq('id', tenant).maybeSingle()
  if (repErr) throw repErr
  if (!rep) throw new Error(`demo tenant ${tenant} not found`)

  const r = rng(20261018)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const start = addDays(today, -400) // ~13 months of history

  const usedNames = new Set<string>()
  const producers: { id: string; rep_id: string; name: string; agency: string; upline: string | null; state: string; status: string; contracted_at: string; external_id: string; kind: Kind }[] = []
  const STATES = ['TX', 'FL', 'GA', 'NC', 'AZ', 'OH', 'TN', 'MO', 'PA', 'MI']
  PLAN.forEach((kind, i) => {
    let name = ''
    do name = `${FIRST[i % FIRST.length]} ${pick(LAST)}`
    while (usedNames.has(name))
    usedNames.add(name)
    const agency = AGENCIES[i % AGENCIES.length]
    const contracted = kind === 'new' ? addDays(today, -Math.floor(10 + r() * 70)) : kind === 'rising' ? addDays(today, -Math.floor(200 + r() * 60)) : addDays(start, -Math.floor(r() * 900))
    producers.push({
      id: crypto.randomUUID(),
      rep_id: tenant,
      name,
      agency,
      upline: null,
      state: pick(STATES),
      status: kind === 'quiet' && i % 2 === 0 ? 'inactive' : 'active',
      contracted_at: contracted,
      external_id: `demo-agent-${String(i + 1).padStart(3, '0')}`,
      kind,
    })
  })
  // Uplines: the first producer of each agency leads it.
  const leads = new Map<string, string>()
  for (const p of producers) if (!leads.has(p.agency)) leads.set(p.agency, p.name)
  for (const p of producers) p.upline = leads.get(p.agency) === p.name ? null : leads.get(p.agency) ?? null

  type Pol = { rep_id: string; producer_id: string; carrier: string; line: string; product: string; submitted_on: string; annual_premium: number; status: string; issued_on: string | null; lapsed_on: string | null; external_id: string }
  const policies: Pol[] = []
  let seq = 0
  let quietN = 0
  let driftN = 0
  for (const p of producers) {
    // Fixed per-producer stop points so retention has known shapes.
    const quietFrom = p.kind === 'quiet' ? 100 + 30 * quietN++ : 0
    const driftFrom = p.kind === 'drifting' ? 35 + 40 * driftN++ : 0
    const from = p.contracted_at > start ? p.contracted_at : start
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const ago = daysBetween(d, today)
      let rate = BASE_APPS[p.kind] / 30
      if (p.kind === 'slipping' && ago < 75) rate *= ago < 40 ? 0.25 : 0.5
      if (p.kind === 'quiet' && ago < quietFrom) rate = 0
      if (p.kind === 'drifting' && ago < driftFrom) rate = 0
      if (p.kind === 'back' && ago >= 60 && ago < 180) rate = 0
      if (p.kind === 'rising') rate *= ago < 60 ? 2.6 : 1
      if (p.kind === 'new') rate *= 1 + (daysBetween(p.contracted_at, d) / 60)
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
      if (dow === 0 || dow === 6) rate *= 0.3
      // Poisson(rate) applications that day (Knuth).
      const L = Math.exp(-rate)
      let n = -1
      let prod = 1
      do {
        n++
        prod *= r()
      } while (prod > L && n < 6)
      for (let k = 0; k < n; k++) {
        const lr = r()
        const line = lr < 0.62 ? 'Life' : lr < 0.95 ? 'Health' : 'Annuity'
        const ap = line === 'Life' ? 600 + r() * 3400 : line === 'Health' ? 1200 + r() * 4800 : 12000 + r() * 48000
        const product = line === 'Life' ? pick(['Term 20', 'Final Expense', 'IUL', 'Mortgage Protection']) : line === 'Health' ? pick(['ACA Silver', 'Short Term Medical', 'Supplemental Hospital', 'Dental Vision']) : pick(['Fixed Index Annuity', 'MYGA'])
        const [carrier, carrierShift, lagMin, lagMax] = pick(CARRIERS)
        // Every app gets its outcome and the day it is decided; until that day it is pending.
        const lag = lagMin + Math.floor(r() * (lagMax - lagMin + 1))
        let status = 'submitted'
        let issued: string | null = null
        let lapsed: string | null = null
        if (ago >= lag) {
          const s = r()
          const placeBoost = (p.kind === 'star' ? 0.06 : p.kind === 'light' ? -0.1 : 0) + carrierShift
          if (s < 0.72 + placeBoost) {
            status = 'issued'
            issued = addDays(d, lag)
            if (ago > 90 && r() < (p.kind === 'slipping' ? 0.16 : 0.08)) {
              status = 'lapsed'
              lapsed = addDays(issued, Math.min(daysBetween(issued, today), 45 + Math.floor(r() * 120)))
            }
          } else if (s < 0.9 + placeBoost / 2) status = 'declined'
          else if (s < 0.985) status = 'withdrawn' // the rest stay stuck in underwriting
        }
        policies.push({ rep_id: tenant, producer_id: p.id, carrier, line, product, submitted_on: d, annual_premium: Math.round(ap), status, issued_on: issued, lapsed_on: lapsed, external_id: `demo-pol-${String(++seq).padStart(6, '0')}` })
      }
    }
  }

  console.log(`tenant ${tenant}: ${producers.length} invented producers, ${policies.length} invented policies, ${start}..${today}`)
  if (dry) return

  // Replace the demo tenant's book (policies cascade with producers).
  const del = await db.from('cxo_book_producers').delete().eq('rep_id', tenant)
  if (del.error) throw del.error
  const insP = await db.from('cxo_book_producers').insert(producers.map(({ kind: _k, ...p }) => p))
  if (insP.error) throw insP.error
  for (let i = 0; i < policies.length; i += 500) {
    const ins = await db.from('cxo_book_policies').insert(policies.slice(i, i + 500))
    if (ins.error) throw ins.error
  }
  console.log('seeded')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
