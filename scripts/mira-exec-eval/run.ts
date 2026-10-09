#!/usr/bin/env tsx
/**
 * Runs the question bank through Mira (runAgent, server-side, no browser).
 *
 *   npx tsx scripts/mira-exec-eval/run.ts --mock --sample 20                 # dry run, no DB/key
 *   npx tsx scripts/mira-exec-eval/run.ts --tenant pinnacle --sample 200     # pilot
 *   npx tsx scripts/mira-exec-eval/run.ts --tenant pinnacle --pass 2         # full bank, pass 2
 *   npx tsx scripts/mira-exec-eval/run.ts --tenant pinnacle --failed results/pass-1.graded.jsonl
 *
 * Flags: --tenant <slug> | --tenant-id <uuid>, --member <member id> (default: owner),
 *        --pass N (default 1), --sample N, --seed N, --category <cat>, --ids a,b,c,
 *        --failed <graded.jsonl> (rerun only failures), --concurrency N (default 4),
 *        --budget <usd> (stop when exceeded), --out <file>, --allow-side-effects.
 *
 * Resume: rows already in the output file are skipped. Each row carries tokens → $.
 * Side effects: remember/forget/report_issue handlers are made inert and intents are
 * collected, never executed, unless --allow-side-effects. runAgent still records
 * agent_usage for the caller (the per-member daily quota is raised in memory).
 */
import './lib/nextShim'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, repoRoot } from './lib/env'
import { agentModel, costUsd, fmtUsd } from './lib/pricing'
import type { Question, RunRow } from './lib/types'
import { num, parseArgs, pool, readJsonl, rng, shuffle, str } from './lib/util'
import { mockAnswer } from './lib/mock'
import { mockGroundTruth } from './lib/groundTruth'

const args = parseArgs(process.argv.slice(2))
const MOCK = !!args.mock
const PASS = num(args.pass, 1)
const SEED = num(args.seed, 20261008)
const CONC = num(args.concurrency, 4)
const BUDGET = num(args.budget, 0)
const BANK = path.join(__dirname, 'questions', 'bank.jsonl')
const OUT = str(args.out, path.join(__dirname, 'results', `${MOCK ? 'mock-' : ''}pass-${PASS}.jsonl`))

function selectQuestions(): Question[] {
  let qs = readJsonl<Question>(BANK)
  if (args.category) qs = qs.filter((q) => q.category === args.category)
  if (args.ids) {
    const ids = new Set(String(args.ids).split(','))
    qs = qs.filter((q) => ids.has(q.id))
  }
  if (args.failed) {
    const failed = new Set(readJsonl<{ id: string; pass_grade: boolean }>(String(args.failed)).filter((g) => !g.pass_grade).map((g) => g.id))
    qs = qs.filter((q) => failed.has(q.id))
  }
  if (args.sample) {
    const n = num(args.sample, 20)
    // stratified: round-robin over categories after a seeded shuffle
    const byCat = new Map<string, Question[]>()
    for (const q of shuffle(rng(SEED + PASS), qs)) (byCat.get(q.category) ?? byCat.set(q.category, []).get(q.category)!).push(q)
    const out: Question[] = []
    const lists = [...byCat.values()]
    for (let i = 0; out.length < n && lists.some((l) => l.length); i++) for (const l of lists) if (out.length < n && l.length) out.push(l.shift()!)
    qs = out
  }
  return qs
}

type Ask = (q: Question) => Promise<Omit<RunRow, 'id' | 'pass' | 'category' | 'expected_kind' | 'text' | 'cost_usd' | 'ms' | 'mock' | 'ts'>>

async function realAsker(): Promise<Ask> {
  loadEnv(repoRoot())
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']) if (!process.env[k]) throw new Error(`Missing ${k} — put it in .env.local (vercel env pull) or export it. Use --mock to dry-run.`)
  const { getTenantBySlug } = await import('@/lib/tenant')
  const { supabase } = await import('@/lib/supabase')
  const { getMemberById, getOwnerMember } = await import('@/lib/members')
  const { runAgent } = await import('@/lib/agent/runAgent')
  const tools = await import('@/lib/agent/tools')
  const slug = str(args.tenant)
  const tenantId = str(args['tenant-id'])
  if (!slug && !tenantId) throw new Error('--tenant <slug> or --tenant-id <uuid> required')
  const tenant = tenantId ? ((await supabase.from('reps').select('*').eq('id', tenantId).maybeSingle()).data as Awaited<ReturnType<typeof getTenantBySlug>>) : await getTenantBySlug(slug)
  if (!tenant) throw new Error(`tenant not found: ${slug || tenantId}`)
  const member = args.member ? await getMemberById(str(args.member)) : await getOwnerMember(tenant.id)
  if (!member) throw new Error('member not found')
  const evalTenant = { ...tenant, settings: { ...(tenant.settings ?? {}), agent_quota_daily: 1_000_000_000 } }
  if (!args['allow-side-effects']) {
    for (const name of ['remember', 'forget', 'report_issue']) {
      if (tools.TOOL_HANDLERS[name]) tools.TOOL_HANDLERS[name] = async () => ({ content: JSON.stringify({ ok: true, note: 'eval: no-op' }) }) as never
    }
  }
  const model = agentModel()
  console.log(`tenant=${tenant.slug} (${tenant.id}) member=${member.email} model=${model} side_effects=${!!args['allow-side-effects']}`)
  return async (q) => {
    const res = await runAgent({ tenant: evalTenant, caller: member, text: q.text, skipGapDetect: true })
    const u = res.usage ?? { input_tokens: 0, output_tokens: 0, tool_calls: 0, turns: 0, tools_used: [] }
    return { answer: res.replyText ?? '', error: res.error ?? null, intents: (res.intentsToExecute ?? []) as Array<Record<string, unknown>>, tools_used: u.tools_used, turns: u.turns, input_tokens: u.input_tokens, output_tokens: u.output_tokens, model }
  }
}

function mockAsker(): Ask {
  const model = 'mock/' + agentModel()
  return async (q) => {
    const gt = q.ground_truth && q.ground_truth.fn !== 'none' ? mockGroundTruth(q.ground_truth, q.id, SEED) : ({ kind: 'none', reason: 'none' } as const)
    const m = mockAnswer(q, gt, SEED + PASS)
    await new Promise((r) => setTimeout(r, 5))
    return { answer: m.answer, error: null, intents: m.intents, tools_used: m.tools_used, turns: m.turns, input_tokens: m.input_tokens, output_tokens: m.output_tokens, model }
  }
}

async function main() {
  const qs = selectQuestions()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const done = new Set(fs.existsSync(OUT) ? readJsonl<RunRow>(OUT).map((r) => r.id) : [])
  const todo = qs.filter((q) => !done.has(q.id))
  console.log(`${MOCK ? 'MOCK ' : ''}pass ${PASS}: ${qs.length} selected, ${done.size} already done, ${todo.length} to run → ${OUT}`)
  const ask = MOCK ? mockAsker() : await realAsker()
  let spent = 0
  let n = 0
  let stopped = false
  const t0 = Date.now()
  await pool(todo, CONC, async (q) => {
    if (stopped) return
    const start = Date.now()
    let row: RunRow
    try {
      const r = await ask(q)
      const cost = costUsd(r.model.replace(/^mock\//, ''), r.input_tokens, r.output_tokens)
      row = { id: q.id, pass: PASS, category: q.category, expected_kind: q.expected_kind, text: q.text, ...r, cost_usd: cost, ms: Date.now() - start, mock: MOCK, ts: new Date().toISOString() }
    } catch (e) {
      row = { id: q.id, pass: PASS, category: q.category, expected_kind: q.expected_kind, text: q.text, answer: '', error: `exception: ${String((e as Error)?.message ?? e)}`, intents: [], tools_used: [], turns: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: Date.now() - start, model: MOCK ? 'mock' : agentModel(), mock: MOCK, ts: new Date().toISOString() }
    }
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n')
    spent += row.cost_usd
    n++
    if (n % 25 === 0 || n === todo.length) console.log(`  ${n}/${todo.length} spent ${fmtUsd(spent)} avg ${fmtUsd(spent / n)}/q ${Math.round((Date.now() - t0) / 1000)}s`)
    if (BUDGET > 0 && spent >= BUDGET) {
      stopped = true
      console.warn(`budget ${fmtUsd(BUDGET)} reached after ${n} questions — stopping (resume with the same --out)`)
    }
  })
  const all = readJsonl<RunRow>(OUT)
  const total = all.reduce((s, r) => s + r.cost_usd, 0)
  const errs = all.filter((r) => r.error).length
  console.log(`done: ${all.length} rows in ${OUT}; cost ${fmtUsd(total)} (${fmtUsd(total / Math.max(1, all.length))}/q); errors ${errs}; projected full bank (5,000): ${fmtUsd((total / Math.max(1, all.length)) * 5000)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
