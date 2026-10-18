#!/usr/bin/env tsx
/**
 * Pre-launch QA for Ciao on the Pinnacle edition: run a realistic question
 * bank (scripts/qa/ciao-question-bank.json) through the REAL agent path
 * (lib/agent/runAgent.ts, prod env, real GLM model, real read tools) as two
 * demo users on the review tenant, and record answer, tools, errors, latency
 * and cost per question. Grading is done by a person reading the output.
 *
 * PRIVACY: hard-wired to the demo tenant rep_store_review_pinnacle (12 fake
 * members). It refuses any other tenant, and it blanks the Pinnacle book
 * allow-list (PINNACLE_VIEWER_REP_IDS) and the Airtable token for this
 * process so no real Pinnacle data can be read even by accident.
 *
 * WRITES: every write tool in evals/ciao/harness WRITE_TOOLS (plus a few
 * more below) is replaced by a recorder that performs nothing. The Google
 * writes (calendar, Sheets, Gmail reply) run for real ONLY when the demo
 * tenant has no Google connection, so the "connect Google" answer is what
 * gets tested; with a connection they are stubbed too. Remaining side
 * effects: the ops audit rows (cxo_mira_audit) and, for an employee asking
 * for an outside send, an approval row (cxo_mira_approvals) on the demo
 * tenant. The run prints its start time; delete rows created after it.
 *
 * DRY RUN (default): validates the bank and prints a cost estimate.
 *   npx tsx scripts/qa/ciao-question-bank.ts
 * REAL RUN (spends money on OpenRouter):
 *   npx tsx scripts/qa/ciao-question-bank.ts --run --env-file <prod env file> \
 *     [--budget-usd 10] [--concurrency 3] [--ids X-calendar-01,...] [--out file.json]
 * The env file comes from `vercel env pull <file> --environment=production`
 * into a scratch folder OUTSIDE the repo. Output defaults to
 * evals/ciao/results/ (git-ignored).
 */
import '../mira-exec-eval/lib/nextShim'
import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const ROOT = path.resolve(__dirname, '..', '..')
const BANK = path.join(__dirname, 'ciao-question-bank.json')
const RESULTS = path.join(ROOT, 'evals', 'ciao', 'results')

/** The only tenant this script will ever run on. */
const DEMO_TENANT = 'rep_store_review_pinnacle'
/** Jordan Avery (owner) and Maya Fischer (rep = employee login), both fake demo members. */
const EXEC_MEMBER = 'b2ebfa4a-5675-41b5-ae61-8be12808da51'
const EMPLOYEE_MEMBER = '75ca3e68-f398-4371-9b19-466beb9b1840'

const MAX_CONCURRENCY = 3
const DEFAULT_BUDGET = 10

type Item = { id: string; persona: 'exec' | 'employee'; category: string; question: string; expect: string; /** Follow-up turns, asked in order with the earlier turns as history. */ turns?: string[] }
type Bank = { version: string; tenant: string; items: Item[] }
type Call = { name: string; args: Record<string, unknown>; stubbed: boolean; result: string }
/** One follow-up turn of a multi-turn item. */
type TurnRow = { question: string; answer: string; tools_used: string[]; calls: Call[]; error: string | null; ms: number; cost_usd: number }
type Row = {
  id: string
  persona: Item['persona']
  category: string
  question: string
  expect: string
  answer: string
  tools_used: string[]
  calls: Call[]
  error: string | null
  ms: number
  /** input = every prompt token sent; cached = the part of it the provider served from cache. */
  tokens: { input: number; cached?: number; output: number }
  cost_usd: number
  /** Follow-up turns (multi-turn items only). cost_usd above includes them. */
  followups?: TurnRow[]
}

/** Google writes: real when the demo tenant has no Google connection (so we see the connect-Google reply). */
const GOOGLE_WRITES = new Set(['create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner', 'create_sheet_report', 'reply_to_thread'])
/** Writes not in evals/ciao/harness WRITE_TOOLS. */
const EXTRA_WRITES = ['send_partner_message', 'create_sheet_report']

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next
      i++
    } else out[a.slice(2)] = true
  }
  return out
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')

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

/** Leadership agenda writes unless it is a draft or a list. */
function isWriteCall(name: string, args: Record<string, unknown>, writeTools: Set<string>): boolean {
  if (writeTools.has(name)) return true
  if (name === 'leadership_agenda') return !['draft', 'candidates', undefined, ''].includes(args.action as string | undefined)
  return false
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // --bank picks another bank file in this folder (e.g. ciao-common-set.json for the refinement loop).
  const bankFile = args.bank ? path.join(__dirname, path.basename(str(args.bank))) : BANK
  const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8')) as Bank
  if (bank.tenant !== DEMO_TENANT) throw new Error(`bank tenant must be ${DEMO_TENANT}`)
  const ids = new Set(bank.items.map((i) => i.id))
  if (ids.size !== bank.items.length) throw new Error('duplicate ids in the bank')
  let items = bank.items
  if (args.ids) {
    const want = new Set(str(args.ids).split(','))
    items = items.filter((i) => want.has(i.id))
  }
  const { DEFAULT_TEXT_MODEL, pricesFor } = await import('@/lib/aiProvider')
  const { estimateRunUsd } = await import('../../evals/ciao/harness')
  const turnCount = items.reduce((n, i) => n + 1 + (i.turns?.length ?? 0), 0)
  const est = estimateRunUsd(turnCount, pricesFor(DEFAULT_TEXT_MODEL))
  console.log(`bank ${bank.version}: ${items.length} items, ${turnCount} turns (${items.filter((i) => i.persona === 'exec').length} exec, ${items.filter((i) => i.persona === 'employee').length} employee); estimate ~$${est.toFixed(2)} on ${DEFAULT_TEXT_MODEL}`)
  if (!args.run) {
    console.log('dry run: nothing sent. Add --run --env-file <prod env file> to run.')
    return
  }

  // ── Env, with the Pinnacle book locked out for this process ──
  const envFile = str(args['env-file'])
  if (!envFile || !fs.existsSync(envFile)) throw new Error('--run needs --env-file <file from vercel env pull>')
  if (path.resolve(envFile).startsWith(ROOT)) throw new Error('keep the env file outside the repo')
  loadEnvFile(envFile)
  process.env.PINNACLE_VIEWER_REP_IDS = '__ciao_qa_nobody__'
  delete process.env.PINNACLE_AIRTABLE_TOKEN
  delete process.env.PINNACLE_AIRTABLE_BASES
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY']) if (!process.env[k]) throw new Error(`missing ${k} in the env file`)
  const budget = Math.min(Number(args['budget-usd'] ?? DEFAULT_BUDGET) || DEFAULT_BUDGET, DEFAULT_BUDGET)
  const conc = Math.max(1, Math.min(MAX_CONCURRENCY, Number(args.concurrency ?? MAX_CONCURRENCY) || MAX_CONCURRENCY))

  const { supabase } = await import('@/lib/supabase')
  const { getMemberById } = await import('@/lib/members')
  const { runAgent } = await import('@/lib/agent/runAgent')
  const { isEmployeeCaller } = await import('@/lib/agent/access')
  const { isPinnacleViewer } = await import('@/lib/pinnacle/rollup')
  const { estimateCostUsd, textModelId } = await import('@/lib/aiProvider')
  const { WRITE_TOOLS, stubResult } = await import('../../evals/ciao/harness')
  const tools = await import('@/lib/agent/tools')
  type Tenant = Parameters<typeof runAgent>[0]['tenant']

  const tenant = (await supabase.from('reps').select('*').eq('id', DEMO_TENANT).maybeSingle()).data as Tenant | null
  if (!tenant || tenant.id !== DEMO_TENANT || tenant.brand !== 'cxo') throw new Error('demo tenant not found or not Suite CXO')
  if (isPinnacleViewer(tenant.id)) throw new Error('the demo tenant reads as a Pinnacle book viewer: refusing')
  const exec = await getMemberById(EXEC_MEMBER)
  const employee = await getMemberById(EMPLOYEE_MEMBER)
  if (!exec || exec.rep_id !== DEMO_TENANT || isEmployeeCaller(exec, tenant)) throw new Error('exec demo member not found / not an exec')
  if (!employee || employee.rep_id !== DEMO_TENANT || !isEmployeeCaller(employee, tenant)) throw new Error('employee demo member not found / not an employee login')
  const { count: googleCount } = await supabase.from('google_tokens').select('id', { count: 'exact', head: true }).eq('rep_id', DEMO_TENANT)
  const googleConnected = (googleCount ?? 0) > 0

  const writeTools = new Set<string>([...WRITE_TOOLS, ...EXTRA_WRITES])
  if (!googleConnected) for (const g of GOOGLE_WRITES) writeTools.delete(g)

  // Per-question call recorder (concurrency-safe).
  const als = new AsyncLocalStorage<Call[]>()
  for (const [name, handler] of Object.entries(tools.TOOL_HANDLERS)) {
    tools.TOOL_HANDLERS[name] = async (ctx, a) => {
      const argsIn = (a ?? {}) as Record<string, unknown>
      const stub = isWriteCall(name, argsIn, writeTools)
      const out = stub ? { text: stubResult(name, argsIn) } : await handler(ctx, a)
      als.getStore()?.push({ name, args: argsIn, stubbed: stub, result: String(out.text ?? '').slice(0, 4000) })
      return out
    }
  }

  const evalTenant = { ...tenant, settings: { ...(tenant.settings ?? {}), agent_quota_daily: 1_000_000_000 } } as Tenant
  const model = textModelId()
  const startedAt = new Date().toISOString()
  console.log(`RUN start=${startedAt} tenant=${tenant.slug} exec=${exec.display_name} employee=${employee.display_name} google=${googleConnected ? 'connected (writes stubbed)' : 'not connected (writes real -> connect-Google)'} model=${model} concurrency=${conc} cap=$${budget}`)

  const rows: Row[] = []
  const skipped: string[] = []
  let spent = 0
  await pool(items, conc, async (item) => {
    if (spent >= budget) {
      skipped.push(item.id)
      return
    }
    const caller = item.persona === 'employee' ? employee : exec
    // The OpenRouter adapter reports input_tokens = all prompt tokens (cached
    // included) and cache_read = the cached part, so adding them double counted.
    // Anthropic reports them disjoint.
    const openrouter = model.startsWith('openrouter:')
    const ask = async (text: string, history: Array<{ role: 'user' | 'assistant'; content: string; at: string }>) => {
      const calls: Call[] = []
      const t0 = Date.now()
      try {
        const res = await als.run(calls, () => runAgent({ tenant: evalTenant, caller, text, history, skipGapDetect: true }))
        const u = res.usage
        const cached = u?.cache_read_input_tokens ?? 0
        const input = openrouter ? (u?.input_tokens ?? 0) : (u?.input_tokens ?? 0) + cached + (u?.cache_creation_input_tokens ?? 0)
        const tokens = { input, cached, output: u?.output_tokens ?? 0 }
        return { answer: res.replyText ?? '', tools_used: u?.tools_used ?? [], calls, error: res.error ?? null, ms: Date.now() - t0, tokens, cost_usd: estimateCostUsd(model, tokens.input, tokens.output) }
      } catch (e) {
        return { answer: '', tools_used: [] as string[], calls, error: `exception: ${(e as Error)?.message ?? e}`, ms: Date.now() - t0, tokens: { input: 0, output: 0 }, cost_usd: 0 }
      }
    }
    const first = await ask(item.question, [])
    const row: Row = { ...item, ...first }
    const history = [
      { role: 'user' as const, content: item.question, at: new Date(Date.now() - 60_000).toISOString() },
      { role: 'assistant' as const, content: first.answer, at: new Date().toISOString() },
    ]
    if (item.turns?.length) {
      row.followups = []
      for (const q of item.turns) {
        const t = await ask(q, history)
        row.followups.push({ question: q, answer: t.answer, tools_used: t.tools_used, calls: t.calls, error: t.error, ms: t.ms, cost_usd: t.cost_usd })
        row.cost_usd += t.cost_usd
        history.push({ role: 'user', content: q, at: new Date(Date.now() - 1000).toISOString() }, { role: 'assistant', content: t.answer, at: new Date().toISOString() })
      }
    }
    spent += row.cost_usd
    rows.push(row)
    console.log(`  ${row.id.padEnd(22)} ${String(row.ms).padStart(6)}ms $${row.cost_usd.toFixed(3)} tools=[${row.tools_used.join(',')}]${row.error ? ` ERROR ${row.error}` : ''}${row.followups ? ` +${row.followups.length} turns [${row.followups.map((f) => `${f.ms}ms:${f.tools_used.join(',')}`).join(' | ')}]` : ''}`)
  })

  rows.sort((a, b) => bank.items.findIndex((i) => i.id === a.id) - bank.items.findIndex((i) => i.id === b.id))
  // Latency per turn (a follow-up is its own wait for the person).
  const ms = rows.flatMap((r) => [r.ms, ...(r.followups ?? []).map((f) => f.ms)]).sort((a, b) => a - b)
  const pct = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0)
  const report = { version: bank.version, at: startedAt, tenant: tenant.slug, model, google_connected: googleConnected, cost_usd: spent, latency_ms: { median: pct(0.5), p90: pct(0.9), max: ms[ms.length - 1] ?? 0 }, skipped, rows }
  fs.mkdirSync(RESULTS, { recursive: true })
  const out = str(args.out) || path.join(RESULTS, `pinnacle-qa-${startedAt.replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`done: ${rows.length} answered, ${skipped.length} skipped, spent ~$${spent.toFixed(2)}, median ${report.latency_ms.median}ms p90 ${report.latency_ms.p90}ms; report ${out}`)
  console.log(`cleanup: demo-tenant rows created after ${startedAt} (cxo_mira_audit, cxo_mira_approvals) are QA rows.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
