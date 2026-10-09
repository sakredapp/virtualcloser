# Mira executive eval (Suite CXO / Pinnacle)

A question bank, runner and grader for Mira's executive-facing answers. It calls
`runAgent` directly (no browser), so it exercises the exact tool loop the CXO
shell uses, with a tenant and member id.

```
scripts/mira-exec-eval/
  generate.ts       builds questions/bank.jsonl (≈4,725 generated + 300 handwritten)
  handwritten.ts    the 300 long-tail questions
  run.ts            asks Mira (or a mock) and writes results/pass-N.jsonl
  grade.ts          deterministic checks + Sonnet rubric → .graded.jsonl + .report.md
  questions/        bank.jsonl, summary.json, entities.json (optional, see below)
  results/          git-ignored
  lib/              types, vocab, ground truth, mock answerer, pricing, env
```

Categories: headline_numbers, rankings_movers, funnel_status, pace_projection,
comparisons, why_anomaly, data_freshness_definitions, calendar_actions,
ambiguous_trick, casual_exec. Expected kinds: number, ranking, list,
explanation, refusal_no_data, action. Each row carries a `ground_truth` spec
(period / breakdown / funnel / compare / line_compare / trend / entity / movers /
pace / freshness / none) that `grade.ts` resolves against the same `lib/mcp/data`
functions Mira's tools use, so the number she should have said is computed, not
hand-typed.

## Environment

`run.ts` and real grading need `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (and the model vars Mira uses:
`ANTHROPIC_MODEL_AGENT` / `ANTHROPIC_MODEL_SMART`). Put them in `.env.local`
(`vercel env pull .env.local --environment production` from the suitecxo project).
Haiku is refused by `lib/pricing.ts`; the grader uses `ANTHROPIC_MODEL_GRADER`
or Sonnet.

## 1. Build the bank with real entity names

The shipped bank uses placeholder teams/agents/carriers/states. Regenerate once
with real names so ranking / entity questions can be graded:

```
npx tsx scripts/mira-exec-eval/generate.ts --from-db       # writes questions/entities.json + bank.jsonl
```

(`--seed N` changes the shuffle; the bank is deterministic per seed.)

## 2. 200-question pilot

```
npx tsx scripts/mira-exec-eval/run.ts   --tenant pinnacle --member <exec member id> --sample 200 --pass 1 --concurrency 3 --budget 25
npx tsx scripts/mira-exec-eval/grade.ts --tenant pinnacle --in scripts/mira-exec-eval/results/pass-1.jsonl
open scripts/mira-exec-eval/results/pass-1.report.md
```

`--sample` is stratified across the ten categories. `--member` is the exec's
`members.id`; `--tenant` is the rep slug (or `--tenant-id`). The runner raises
the agent quota in memory, skips gap detection and makes `remember` /
`forget` / `report_issue` inert unless `--allow-side-effects`. Intents
(`send_email`, `book_meeting`, …) are captured, never executed. The only
remaining side effect is the `agent_usage_increment` RPC, which counts usage
against the member for the day.

Dry run without keys or DB: `--mock` swaps in a deterministic mocked Mira with
~15 % injected failures (wrong number, invented team, YoY on missing data, "in
2024", too long, claimed-sent). `grade.ts --mock --no-llm` grades it; this is
how the harness was smoke-tested.

## 3. Full run: 5,000 × 3 passes

```
for p in 1 2 3; do
  npx tsx scripts/mira-exec-eval/run.ts --tenant pinnacle --member <id> --pass $p --concurrency 4 --budget 450
  npx tsx scripts/mira-exec-eval/grade.ts --tenant pinnacle --in scripts/mira-exec-eval/results/pass-$p.jsonl
done
```

Each pass is its own results file; `run.ts` resumes (skips ids already in the
file) so a crash or budget stop is restartable. `--failed <graded.jsonl>` reruns
only the failures of a previous pass; `--category`, `--ids` narrow further.
Three passes separate flaky answers (pass in 1 of 3) from real defects (fail in
3 of 3): the report's clusters are keyed by (tag · category · template family),
so a fix is one family at a time.

### Cost per pass (estimate — calibrate on the pilot)

| item | per question | per 5,000 |
|---|---|---|
| Mira (Sonnet, ~7–8k in / ~350 out per call, 2–3 calls per question incl. tool turns) | ≈ $0.07 | ≈ $350 |
| rubric grader (Sonnet, only explanation/action/list + inconclusive rows, ~1.5k tokens) | ≈ $0.006 × ~1,700 rows | ≈ $15 |
| **one pass** | | **≈ $365** |
| three passes | | **≈ $1,100** |

The tool system prompt is the bulk of the input tokens; enabling prompt caching
in `runAgent` would cut the agent side by roughly 70 %. The 200-question pilot
is ≈ $15. `--budget` stops the runner once the measured spend crosses the cap.

## 4. Fix loop

1. Read `report.md` → top clusters. Each cluster example shows Q, Mira's answer
   and the computed ground truth.
2. Decide the layer: tool output shape (`lib/mcp/data.ts`, `lib/agent/tools.ts`
   `pinnacle_revenue`), the agent system prompt, or the question itself (mark a
   question `meta.flaky` and regenerate if the bank is wrong, not Mira).
3. Re-run just that cluster: `run.ts --failed results/pass-1.graded.jsonl --category comparisons --out results/fix-compare.jsonl`
   then `grade.ts --in results/fix-compare.jsonl`.
4. Promote hard failures into `handwritten.ts` so they stay in the bank forever.
5. Pass gate for a demo: ≥ 95 % on headline / rankings / funnel / comparisons,
   100 % on `refusal_no_data` (never invent 2025 or a team), 0 `claimed_unsent_action`.

Deterministic checks: number within 1 % (or within the rounding the answer
showed, e.g. "$24.1M"), the right period named, a plain "no 2025 data" when last
year is asked, no YoY % when the prior period is empty, named fake entities
refused, ranking top-1 present and ≥ 60 % of the top-N named, length caps,
expected tool/intent present, no "sent" claim without a send intent.
Failure tags: wrong_number, no_number, hallucinated_compare, invented_entity,
invented_data, missing_no_data_statement, wrong_period, wrong_ranking,
too_long, evasive, tool_error, no_action, claimed_unsent_action, wrong_tool,
bad_tone, no_next_step, grader_error, gt_unavailable.

## 5. Mira for execs: what works, what is missing

See the "What runAgent can already do for execs" section that every report.md
ends with (source: `CAPABILITIES_MD` in `grade.ts`). Short version: numbers,
calendar read (forward-only), booking/rescheduling, reminders and tasks all work
through `runAgent`; email send exists but is lead-scoped only and send-only (no
draft→confirm, no inbox read tools wired, no attachments, no meeting notes).
