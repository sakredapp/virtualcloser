# Ciao refinement loop, 2026-10-18

Four rounds of run, grade, diagnose and fix on the common questions a Pinnacle
executive asks Ciao, before Pinnacle Life Group uses it.

- **Tenant:** demo tenant `rep_store_review_pinnacle` only (fake 32-producer book, 12 fake members). Never rep_spence, never real Pinnacle data.
- **Harness:** `scripts/qa/ciao-question-bank.ts --bank scripts/qa/ciao-common-set.json`. It runs the real runAgent loop, the real GLM-5.3 model and the real read tools. Write tools are stubbed. Google is not connected on the demo tenant, so "connect Google" is the right answer for calendar, Sheets and email.
- **Question set:**
  - Rounds 1–2: 50 questions (P production, S staff, M meetings, D drafting, T tasks, F follow-ups, E edge cases, MT multi-turn).
  - From round 3: 58 questions and 71 turns, after PR #82 added retention, carrier and placement-lag questions (R01–R10, MT8).
- **Rubric (1–5):**
  - 5 = right figures from the right tool, answers the question asked, no padding
  - 4 = right, with a small miss in framing or completeness
  - 3 = partly right, or answers a nearby question
  - 2 = misses the main fact or is misleading
  - 1 = wrong, invented, or failed
- **Fixes:** every fix is general (tool shape, routing, prompt rule or guard). No answer is hardcoded.

## Results

| Round | Questions | Avg | % scoring 4+ | Median latency | p90 latency | Timeouts | Spend (list estimate) |
|---|---|---|---|---|---|---|---|
| 1 | 50 | 3.74 | 70% | 7.6s | 25.3s | several | $4.72 + $0.63 debug |
| 2 | 50 | 3.96 | 80% | 4.6s | 7.3s | 0 | $3.82 |
| 3 | 58 | 4.28 | 88% | 10.9s | 45.2s | 5 | $4.09 + $0.50 probes |
| 4 | 58 | 4.69 | 97% | 3.0s | 5.5s | 0 | $4.25 |
| 4b (5 targeted re-runs after the round 4 fixes) | 5 | 5.0 | 100% | 4.2s | 6.8s | 0 | $0.43 |

The round 3 latency jump came from OpenRouter host stalls, not from Ciao: tools took 0.2–0.4s, and even answers with no tool calls were slow. Round 4 fixed it at the request level.

**Total Ciao spend:**
- the app's own usage meter recorded $19.40 for the loop
- the list-price estimate is about $23
- the budget was $100, with a stop at $90

## Changes by round

### Round 1
- **`producer_production` takes `view` and `period` as required.** GLM dropped optional args, so "this quarter" came back as month to date.
- **Read-only tool batches run in parallel** (`lib/agent/readBatch.ts`). A repeated identical read gets a note instead of a fresh call, because GLM sometimes repeated one read 8 times.
- **Sheets can be filled from a tool.** `create_sheet_report` takes `from_tool: producer_production` plus `from_args`, so the model never retypes 30 rows (`lib/agent/sheetFromTool.ts`). It goes through the same role wall. The Google state line now also says Sheets is not connected when Google is not.
- **The board update reads the tenant book**, not an empty source.

### Round 2
- **The rank view carries more context:**
  - `prior_period`, `totals_prior` and `change_pct`: the same days last month, so a part month is never compared with a full month
  - `pace`: a projection to period end
  - `agencies_by_submitted_ap`: an agency rollup, so agencies are never hand-summed
- **Routing:**
  - vague asks ("how's the team doing") default to production and plan pacing
  - "my week" means calendar plus to-dos
  - "anything waiting on my approval" also reads to-dos that ask for a sign-off
  - "who's behind" with no quotas set up falls back to agents slipping
- **The model's copied history stamps** (`[sent today 9:48 AM, earlier]`) are stripped from replies.
- **Untouched board-update drafts older than an hour regenerate on request.** Last year's YTD is shown only when the book reaches back that far.
- **Prompt:** "last 6 months" maps to `last_6m`, and "vs last month" uses the same-span prior and pace.

### Round 3
- **OpenRouter host choice:** `provider.sort = latency` when no host order is pinned (`OPENROUTER_PROVIDER_SORT`, `none` turns it off).
- **Stall cutoff:** the first attempt is cut at 18s (`OPENROUTER_STALL_MS`) and retried once with no cutoff.
- **The claim-check note** now says the user never sees the check, and tells the model to rewrite from scratch. This stopped "Now it's actually done" and replies addressed to the check.

### Round 4
- **"What do I owe <person>"** reads follow-ups and to-dos in one go. A to-do naming that person counts as owed, and a reminder reuses its words.
- **"Who has the worst placement"** ranks agents (rank, metric=placement, order bottom). The carrier placement view is used only when carriers or products are named.
- **The claim guard no longer reads book figures as action claims.** "Submitted AP $2.4M" and "Issued 730 of 1,051" had added a false "nothing has been saved or sent yet".

## Tests

`__tests__/cxo/ciaoRefinement.spec.ts` covers:
- the read keys and parallel batches
- sheet-from-tool tables
- pace, change % and the agency rollup
- the stale-draft rule
- stamp stripping
- the claim-note wording and book-figure claims
- the required schema
- the Sheets state line
- the new routing hints
- the OpenRouter latency sort and the single stall retry

## Remaining weak spots

- **Multi-turn follow-ups** sometimes pick a nearby list. Example: "the bottom three" after a slipping question used rank bottom by AP, not the slippers.
- **"Put it in a table"** after a not-connected Sheets answer sometimes asks first instead of showing the table.
- **Small wording slips:**
  - "Nobody has never signed in"
  - an item due today labelled as due rather than overdue
  - a name misspelled once in a long meeting prep
- **Placement on recent windows** is mostly pending business. Ciao caveats it, but a quarter-to-date "worst placement" list is still mostly zeros until the apps settle.
- **Not tested on the demo tenant:** calendar, Sheets and email with Google connected. Those need a real-account check.
