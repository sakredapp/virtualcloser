# Connect your AI — the Suite CXO MCP server

Suite CXO is the executive suite for a life insurance IMO. "Connect your AI" lets
an owner or executive plug their **own** Claude or ChatGPT into it. Their assistant
can then read every number in the suite (issued premium, placement, product mix,
carriers, agencies, producers, states, books of business, calendar) and rearrange
the dashboard by being asked.

- Endpoint: `https://<host>/api/mcp` (Streamable HTTP, stateless, JSON responses)
- Keys: made on **Integrations → Connect your AI**; stored as sha256 in `mcp_tokens`
- Auth: `Authorization: Bearer cxo_…` **or** `?k=cxo_…` on the URL (claude.ai and
  ChatGPT custom connectors have no bearer-token box, so the link carries the key)
- Scope: every call is scoped to the key's account. No tool takes an account argument.

## Setup

### Claude (claude.ai — Pro, Max, Team, Enterprise)
1. Settings → Connectors (under Customize) → Add → **Add custom connector**.
2. Name `Suite CXO`, MCP server URL = the **connection link** from the card
   (`https://www.suitecxo.com/api/mcp?k=cxo_…`). Leave the OAuth boxes empty.
3. Continue. Optionally set read-only tools to "Always allow".
4. Ask: *How is the business doing year to date?*

### ChatGPT (Plus or higher, Developer mode)
1. Settings → Apps & Connectors → (Advanced: Developer mode on) → Create / Add MCP server.
2. Name `Suite CXO`, Server URL = the connection link. Authentication: **No authentication**.
3. In a chat, `+` → More → turn on Suite CXO. Ask the same question.

### Claude Code / anything with headers
```
claude mcp add --transport http suite-cxo https://www.suitecxo.com/api/mcp \
  --header "Authorization: Bearer cxo_…"
```

## Tools

Read (all tenant-scoped; every result has a one-line `summary`):

| Tool | Answers |
| --- | --- |
| `get_company_snapshot` | The Monday view in one call: YTD premium and pace vs last year, MTD + projected month end, trailing 3/6/12 with direction, placement funnel, product mix, top 5 producers / carriers / states / agencies, watch list. |
| `get_overview(line?, book?)` | YTD, MTD, trailing 3/6/12 months with deltas vs prior period, product mix, funnel. |
| `get_trend(window?, grain?, line?, book?)` | Premium over time by day/week/month, direction, best period. |
| `get_breakdown(dim, window?, line?, limit?)` | Ranked table by `team` (agency), `agent` (producer), `carrier`, `state`, `product`. |
| `get_status_funnel(window?, line?)` | Applications, paid, declined, lapsed, placement %, change vs prior. |
| `get_agency_books(window?)` | Every book of business side by side. |
| `compare_periods(a, b, line?, book?)` | Any two windows with deltas. |
| `get_agent(name, window?)` / `get_carrier(name, window?)` / `get_agency(name, window?)` | Deep dive: rank, share, placement, line split, vs prior. |
| `search(query, window?, limit?)` | Find producers, carriers, agencies, states by name. |
| `list_meetings(days?)` | Upcoming meetings in local time. |
| `get_dashboard_layout` | Current layout + the catalog of tiles, KPIs, timeframes. |

Write (persist to `reps.settings.dashboard_prefs` via `lib/dashboardPrefs.ts`):

| Tool | Does |
| --- | --- |
| `set_dashboard_layout(tiles?, default_timeframe?, pinned_kpis?, pinned_breakdowns?, hidden_sections?, headline_note?)` | Rearranges the dashboard. Arrays replace; omitted fields keep. |
| `pin_kpi(kpi, pinned?, position?)` | Pin/unpin one KPI in the strip. |
| `set_default_timeframe(timeframe)` | `mtd` `qtd` `ytd` `3m` `6m` `12m` `all`. |
| `add_note(text, as_headline?)` | Leaves a note on the notes tile (and optionally as the headline). |
| `remove_note(note_id?, clear_headline?)` | Removes a note / clears the headline. |

Windows: `mtd`, `qtd`, `ytd`, `3m`, `6m`, `12m`, `last_month`, `last_year`, `all`, or
`{start, end}` (YYYY-MM-DD). "Prior period" is the same dates last year for
mtd/qtd/ytd, and the adjacent earlier window for trailing windows.

Resources: `cxo://snapshot`, `cxo://overview`, `cxo://trend/12m`,
`cxo://breakdown/{team|agent|carrier|state|product}`, `cxo://dashboard/layout`.

Prompts: `monday_briefing`, `where_is_growth`, `what_to_worry_about`, `set_up_my_dashboard(focus)`.

## Dashboard prefs contract (for the dashboard UI)

```ts
import { getDashboardPrefs, type DashboardPrefs } from '@/lib/dashboardPrefs'
const prefs = await getDashboardPrefs(tenant.id)
// prefs.tiles            DashboardTile[]        visible tiles, in order
// prefs.default_timeframe 'mtd'|'qtd'|'ytd'|'3m'|'6m'|'12m'|'all'
// prefs.pinned_kpis      DashboardKpi[]
// prefs.pinned_breakdowns BreakdownDim[]       'team'|'agent'|'carrier'|'state'|'product'
// prefs.hidden_sections  string[]
// prefs.headline_note    string | null
// prefs.notes            { id, text, author, created_at }[]
```

Tile ids: `headline`, `kpis`, `premium_trend`, `product_mix`, `status_funnel`,
`breakdowns`, `agency_books`, `meetings`, `notes`. KPI ids: `ytd_premium`,
`mtd_premium`, `trailing_3m_premium`, `trailing_6m_premium`, `trailing_12m_premium`,
`policies_issued`, `policies_submitted`, `placement_pct`, `avg_premium_per_policy`,
`projected_month_end`.

## Files

- `app/api/mcp/route.ts` — the server endpoint (GET/POST/DELETE/OPTIONS)
- `lib/mcp/server.ts` — tools, resources, prompts
- `lib/mcp/data.ts` — the numbers (same RPCs as the dashboard)
- `lib/mcp/auth.ts`, `lib/mcp/tokens.ts` — keys
- `lib/dashboardPrefs.ts` — layout store
- `app/api/me/mcp-token/route.ts` — create / list / revoke keys
- `app/components/ConnectYourAiCard.tsx` — the Integrations card
- `supabase/mcp_tokens_migration.sql` — run once per database

## Failure modes

- No / bad key → `401` JSON.
- `mcp_tokens` table missing → `503` with the migration to run (the card says
  "Keys are not switched on for this account yet").
- Account not in `PINNACLE_VIEWER_REP_IDS` (when set) → tools answer
  "No book of business is connected to this account yet."
