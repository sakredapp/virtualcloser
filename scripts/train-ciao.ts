#!/usr/bin/env tsx
/**
 * Train Ciao: a fixed loop that makes Ciao (internal code: "mira") measurably better.
 *
 *   1. Ask the fixed question set (evals/ciao/questions.v1.json, 34 exec and
 *      employee questions about the invented /cxo/demo company).
 *   2. Grade every answer against the rubric (evals/ciao/harness.ts), 0-2 each:
 *      right_tool, numbers_match_source, stays_in_role, imo_vocabulary,
 *      short_answer_first, asks_before_acting, cites_source.
 *      The mechanical half (tool chosen, forbidden tool not called, refusal on
 *      role probes, nothing sent or booked without a yes, length) always runs.
 *      The subjective half (numbers, vocabulary, answer-first, sources) is a GLM
 *      judge that only runs with --judge.
 *   3. Change ONE thing (a tool description, the CXO prompt, a tool's output shape).
 *   4. Re-ask with --baseline <previous report> and keep the change only if
 *      the score rose; the script prints KEEP or REVERT.
 *   Never edit the question set inside a loop: a new set is a new version
 *   (questions.v2.json) and needs a fresh baseline.
 *
 * DRY RUN (default, free, no keys, no DB):
 *   npx tsx scripts/train-ciao.ts
 * Validates the question set against the live tool list (every expected and
 * forbidden tool exists in lib/agent; employee items expect only employee
 * tools; role probes forbid only executive tools), then prints the estimated
 * cost of a real run. Exits 1 if the set is invalid.
 *
 * REAL RUN (spends money; only when the owner asks):
 *   CIAO_EVAL_DAILY_BUDGET_USD=3 npx tsx scripts/train-ciao.ts --run --budget-usd 3 \
 *     --tenant-id <demo cxo tenant uuid> --exec-member <exec members.id> \
 *     [--employee-member <employee members.id>] [--judge] [--label "shorter revenue answers"] \
 *     [--baseline evals/ciao/results/<earlier>.json] [--ids rev-01,rev-02]
 * Both switches are required: --run --budget-usd <n> AND env
 * CIAO_EVAL_DAILY_BUDGET_USD > 0. The run stops at the lower of the two. Set
 * the env var back to 0 afterwards. Needs NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and OPENROUTER_API_KEY (.env.local). The agent runs
 * on GLM via OpenRouter (lib/aiProvider.ts); nothing here picks a model.
 *
 * Safety: refuses a non-Suite-CXO tenant and the Pinnacle tenant (demo/test
 * tenants only). Every write tool (sends, drafts, bookings, to-dos, memory,
 * HR edits) is replaced by a recorder that performs nothing; read tools run for
 * real. Remaining side effects: the ops audit log rows runAgent already writes.
 * Without --employee-member the employee items are skipped and reported.
 * Output: a JSON report in evals/ciao/results/ (git-ignored). No DB tables.
 */
import './mira-exec-eval/lib/nextShim'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, repoRoot } from './mira-exec-eval/lib/env'
import {
  JUDGE_SYSTEM,
  buildJudgeUser,
  estimateRunUsd,
  gradeMechanical,
  keepOrRevert,
  mergeJudge,
  parseJudge,
  summarize,
  validateQuestionSet,
  type Grade,
  type QuestionItem,
  type QuestionSet,
  type RunRecord,
  type ToolCall,
  WRITE_TOOLS,
  stubResult,
} from '../evals/ciao/harness'

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_SET = path.join(ROOT, 'evals', 'ciao', 'questions.v1.json')
const RESULTS = path.join(ROOT, 'evals', 'ciao', 'results')

type Args = Record<string, string | boolean>
function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')

async function loadCatalog() {
  const tools = await import('@/lib/agent/tools')
  const access = await import('@/lib/agent/access')
  return { all: new Set(Object.keys(tools.TOOL_HANDLERS)), employee: access.EMPLOYEE_TOOLS }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const setPath = str(args.questions) || DEFAULT_SET
  const set = JSON.parse(fs.readFileSync(setPath, 'utf8')) as QuestionSet
  const catalog = await loadCatalog()
  const errs = validateQuestionSet(set, catalog)
  const { DEFAULT_TEXT_MODEL, pricesFor } = await import('@/lib/aiProvider')
  const price = pricesFor(DEFAULT_TEXT_MODEL)
  let items = set.items
  if (args.ids) {
    const ids = new Set(str(args.ids).split(','))
    items = items.filter((i) => ids.has(i.id))
  }
  const est = estimateRunUsd(items.length, price, !!args.judge)
  console.log(`question set ${set.version}: ${set.items.length} items (${set.items.filter((i) => i.caller === 'employee').length} employee), ${catalog.all.size} tools known`)
  if (errs.length) {
    console.error(`INVALID (${errs.length}):\n  ${errs.join('\n  ')}`)
    process.exit(1)
  }
  console.log('valid: every expected/forbidden tool exists; employee items use employee tools only')
  console.log(`estimated cost for ${items.length} questions on ${DEFAULT_TEXT_MODEL}: ~$${est.toFixed(2)}${args.judge ? ' (with judge)' : ` (judge adds ~$${(estimateRunUsd(items.length, price, true) - est).toFixed(2)})`}`)

  if (!args.run) {
    console.log('dry run: nothing was sent to any model. Add --run --budget-usd <n> with CIAO_EVAL_DAILY_BUDGET_USD > 0 to run.')
    return
  }

  // ── Budget switch: both must be set ──
  const flagBudget = Number(args['budget-usd'])
  const envBudget = Number(process.env.CIAO_EVAL_DAILY_BUDGET_USD ?? 0)
  if (!(flagBudget > 0)) throw new Error('--run needs --budget-usd <n> (> 0)')
  if (!(envBudget > 0)) throw new Error('--run needs env CIAO_EVAL_DAILY_BUDGET_USD > 0 (it is 0 or unset). Raise it for this run only, then set it back to 0.')
  const cap = Math.min(flagBudget, envBudget)
  if (est > cap) console.warn(`estimate $${est.toFixed(2)} is above the $${cap} cap: the run will stop when the cap is reached`)

  loadEnv(repoRoot())
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY']) if (!process.env[k]) throw new Error(`Missing ${k} (put it in .env.local)`)
  const tenantId = str(args['tenant-id'])
  const execId = str(args['exec-member'])
  if (!tenantId || !execId) throw new Error('--run needs --tenant-id <uuid> and --exec-member <members.id>')

  const { supabase } = await import('@/lib/supabase')
  const { getMemberById } = await import('@/lib/members')
  const { runAgent } = await import('@/lib/agent/runAgent')
  const { isEmployeeCaller } = await import('@/lib/agent/access')
  const { isPinnacleViewer } = await import('@/lib/pinnacle/rollup')
  const { estimateCostUsd, textModelId } = await import('@/lib/aiProvider')
  const tools = await import('@/lib/agent/tools')
  type Tenant = Parameters<typeof runAgent>[0]['tenant']

  const tenant = (await supabase.from('reps').select('*').eq('id', tenantId).maybeSingle()).data as Tenant | null
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`)
  if ((tenant.brand ?? 'virtualcloser') !== 'cxo') throw new Error('not a Suite CXO tenant: use the demo/test CXO tenant')
  if (isPinnacleViewer(tenant.id)) throw new Error('refusing the Pinnacle tenant: run on a demo/test tenant only')
  const exec = await getMemberById(execId)
  if (!exec || exec.rep_id !== tenant.id) throw new Error('exec member not found on this tenant')
  if (isEmployeeCaller(exec, tenant)) throw new Error('--exec-member is an employee login')
  const employeeId = str(args['employee-member'])
  const employee = employeeId ? await getMemberById(employeeId) : null
  if (employeeId && (!employee || employee.rep_id !== tenant.id || !isEmployeeCaller(employee, tenant))) throw new Error('--employee-member is not an employee login on this tenant')

  // Record every call; writes are replaced by the recorder.
  let calls: ToolCall[] = []
  let results: string[] = []
  for (const [name, handler] of Object.entries(tools.TOOL_HANDLERS)) {
    const write = WRITE_TOOLS.includes(name)
    tools.TOOL_HANDLERS[name] = async (ctx, a) => {
      calls.push({ name, args: a ?? {} })
      const out = write ? { text: stubResult(name, a ?? {}) } : await handler(ctx, a)
      results.push(`${name}: ${String(out.text ?? '').slice(0, 1500)}`)
      return out
    }
  }

  const evalTenant = { ...tenant, settings: { ...(tenant.settings ?? {}), agent_quota_daily: 1_000_000_000 } } as Tenant
  const model = textModelId()
  console.log(`RUN tenant=${tenant.slug} exec=${exec.email} employee=${employee?.email ?? '(none: employee items skipped)'} model=${model} cap=$${cap}`)

  const rows: Array<{ item: QuestionItem; run: RunRecord; grade: Grade; cost_usd: number; tokens: { input: number; output: number }; ms: number; judge?: string }> = []
  const skipped: string[] = []
  let spent = 0
  for (const item of items) {
    if (spent >= cap) {
      skipped.push(`${item.id} (budget)`)
      continue
    }
    const caller = item.caller === 'employee' ? employee : exec
    if (!caller) {
      skipped.push(`${item.id} (no employee member)`)
      continue
    }
    calls = []
    results = []
    const t0 = Date.now()
    let run: RunRecord
    let tokens = { input: 0, output: 0 }
    try {
      const at = new Date(Date.now() - 60_000).toISOString()
      const res = await runAgent({ tenant: evalTenant, caller, text: item.question, history: (item.history ?? []).map((h) => ({ ...h, at })), skipGapDetect: true })
      const u = res.usage
      tokens = { input: (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0), output: u?.output_tokens ?? 0 }
      run = { answer: res.replyText ?? '', tools_used: u?.tools_used ?? [], tool_calls: calls, error: res.error ?? null }
    } catch (e) {
      run = { answer: '', tools_used: [], tool_calls: calls, error: `exception: ${(e as Error)?.message ?? e}` }
    }
    let cost = estimateCostUsd(model, tokens.input, tokens.output)
    let grade = gradeMechanical(item, run)
    let judgeWhy: string | undefined
    if (args.judge && !run.error) {
      const { getAI } = await import('@/lib/ai')
      const res = await getAI().messages.create({ model, max_tokens: 300, system: JUDGE_SYSTEM, messages: [{ role: 'user', content: buildJudgeUser(item, run, results.join('\n')) }] })
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      cost += estimateCostUsd(model, res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0)
      const j = parseJudge(text)
      if (j) grade = mergeJudge(grade, j)
      judgeWhy = text.slice(0, 400)
    }
    spent += cost
    rows.push({ item, run, grade, cost_usd: cost, tokens, ms: Date.now() - t0, judge: judgeWhy })
    console.log(`  ${item.id.padEnd(9)} ${Math.round(grade.pct * 100)}%  $${cost.toFixed(3)}  ${grade.failures.join(' ') || 'ok'}`)
  }

  const summary = summarize(items, rows.map((r) => r.grade))
  const report = { version: set.version, label: str(args.label) || null, at: new Date().toISOString(), tenant: tenant.slug, model, judge: !!args.judge, cost_usd: spent, skipped, summary, rows }
  fs.mkdirSync(RESULTS, { recursive: true })
  const out = str(args.out) || path.join(RESULTS, `${report.at.replace(/[:.]/g, '-')}${report.label ? `-${report.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : ''}.json`)
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`score ${(summary.pct * 100).toFixed(1)}% (${summary.points}/${summary.max}) over ${summary.n} answers; spent $${spent.toFixed(2)}; skipped ${skipped.length}; report ${out}`)
  console.log(`by dimension: ${JSON.stringify(summary.by_dimension)}`)
  if (args.baseline) {
    const base = JSON.parse(fs.readFileSync(str(args.baseline), 'utf8')) as { version: string; summary: { pct: number }; judge?: boolean }
    if (!!base.judge !== !!args.judge) console.warn('baseline and this run differ in --judge: compare like with like')
    const d = keepOrRevert(base, report)
    console.log(`${d.keep ? 'KEEP' : 'REVERT'}: ${d.reason}`)
  }
  console.log('Set CIAO_EVAL_DAILY_BUDGET_USD back to 0.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
