# CRM Build Spec — Inbox, Telegram, Trello

For the CRM developer. Three features to build, each documented as: what it does, how it works, the data model, the AI logic, config, and a "what to build" list. Nothing else.

Tenancy note used throughout: a tenant is `reps` (id = **text**); people within a tenant are `members` (id = **uuid**). Most rows carry `rep_id`, and multi-account features also carry `owner_member_id`.

---

## 1. Inbox (email only — AI triage + AI replies)

**What it does:** Connect Gmail via OAuth → "Load" pulls the latest ~200 threads → Claude classifies each thread → for threads that need a reply, Claude writes a draft using the matched CRM lead's context + the rep's real calendar availability → rep approves / edits / regenerates / snoozes / dismisses → approved drafts send as properly threaded Gmail replies. Email only; no SMS.

### 1.1 Data flow
```
Gmail OAuth (per member) ──▶ google_tokens
        │
   sync ("Load" button, or ~30s tick)     lib/email/syncTick.ts
        │   first run: seed up to 200 threads (2 pages × 100)
        │   after:     incremental deltas via Gmail history cursor
        ▼
  email_threads + email_messages     (cursor in gmail_sync_state)
        │
   triage (batch of 10)     lib/email/triageTick.ts
        │   Claude Haiku → { priority, category, needs_reply, reasoning }
        ▼
  needs_reply threads → draftEmailReply()   (Claude Sonnet + free calendar slots + lead context)
        │
        ▼
  email_drafts (status='pending')
        │
   UI: /dashboard/inbox?tab=email      app/dashboard/inbox/EmailTab.tsx
        │   approve / edit+send / regenerate / snooze / dismiss
        ▼
  replyToGmailThread()  → Gmail send (RFC2822, In-Reply-To + References headers)
```

### 1.2 Key files
| Path | Purpose |
|------|---------|
| `lib/email/syncTick.ts` | Gmail sync: seed (up to 200 threads) then incremental via history cursor; archive/restore reconciliation every 10 min. |
| `lib/email/triageTick.ts` | Batch classification (10 threads/run) + draft insertion. |
| `lib/email/calendarContext.ts` | `findFreeSlots()` → next 7 business days of 30-min slots (9–5). Feeds real times into drafts so the model never invents a meeting time. |
| `lib/claude.ts` | `triageEmail()` (~L1562) and `draftEmailReply()` (~L1677) — prompts + JSON parsing. |
| `lib/google.ts` | OAuth, per-member token store/refresh, Gmail wrappers, `replyToGmailThread()`. |
| `app/dashboard/inbox/EmailTab.tsx` | Draft UI + server actions (approve / approveAll / dismiss / snooze / regenerate). |
| `app/dashboard/inbox/ActiveInbox.tsx` | Raw inbox view, live SSE updates, natural-language search. |
| `app/dashboard/inbox/AccountSwitcher.tsx` | Multi-account (shared vs per-member Gmail) dropdown. |
| `app/api/inbox/search/route.ts` | NL query → Gmail search syntax (Claude), keyword fallback. |
| `app/api/inbox/stream/route.ts` | SSE via Supabase Realtime. |
| `app/api/cron/gmail-sync/route.ts`, `.../gmail-triage/route.ts` | HTTP triggers — this is your "Load" button target + cron. |
| `supabase/email_triage_migration.sql` | Schema for the 4 email tables. |

### 1.3 AI logic
- **Triage** — model `ANTHROPIC_MODEL_FAST` (default `claude-haiku-4-5`). Returns strict JSON `{ priority (urgent|high|normal|low|noise), category, needs_reply, reasoning }`. `needs_reply` is true **only** when the latest message is inbound *and* the sender expects a response — this is what kills FYIs, "thanks!", and auto-replies so you don't draft against noise.
- **Drafting** — model `ANTHROPIC_MODEL_SMART` (default `claude-sonnet-4-5`). Inputs: last ~8 messages, matched lead (name/company/status/notes via `matchLead()` on the from-address), the rep's real free slots, and the rep's learned email style. Output JSON `{ subject, body }`. Prompt enforces 3–6 sentences, no corporate filler, one clear next step, signs with rep name only, never invents times.
- **Sending** — `replyToGmailThread()` builds an RFC2822 message with `In-Reply-To` + `References` headers so Gmail threads the reply. **Do not skip these headers** — without them the reply appears as a brand-new thread.

### 1.4 Gotcha to copy faithfully: dismissed drafts must stay dismissed
An earlier version re-drafted every active lead on every tick, so dismissing a draft did nothing — it regenerated next run. Fixed with two helpers (`lib/supabase.ts`):
- `getLatestEmailDraftAction(repId, leadId)` — most recent draft action for a lead.
- `shouldDraftForLead(latest, lastContact)` — returns false if a draft is already pending, or if it was drafted and the lead hasn't been contacted since; only re-drafts on genuinely new activity.

Any auto-draft loop needs this guard.

### 1.5 Tables
```sql
email_threads(
  id uuid pk, rep_id text, owner_member_id uuid null, gmail_thread_id text,
  subject, from_address, from_name, snippet, last_message_at, message_count,
  priority, category, needs_reply bool, reasoning,          -- triage output
  status(new|triaged|drafted|approved|sent|snoozed|archived|dismissed),
  snoozed_until, lead_id uuid null,
  unique(rep_id, gmail_thread_id))

email_messages(
  id uuid pk, thread_id uuid, gmail_message_id text unique, direction(inbound|outbound),
  from_address, to_addresses[], cc_addresses[], subject, body_text, body_html, sent_at)

email_drafts(
  id uuid pk, thread_id uuid, rep_id text, owner_member_id uuid null,
  subject, body, model_used,
  status(pending|approved|sent|dismissed|superseded), edited_by_human bool,
  feedback, sent_at, gmail_message_id)

gmail_sync_state(
  id uuid pk, rep_id text, member_id uuid null, last_history_id,
  last_synced_at, last_error, consecutive_errors,
  unique(rep_id) where member_id is null,
  unique(rep_id, member_id) where member_id is not null)

google_tokens(rep_id text, member_id uuid null, access_token, refresh_token,
  expires_at, email, scope, unique(rep_id, member_id))
```

### 1.6 Config
```
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI
# scopes: gmail.readonly, gmail.modify, gmail.send,
#         calendar.events, calendar.freebusy, calendar.readonly, openid, email
ANTHROPIC_API_KEY
ANTHROPIC_MODEL_FAST     # default claude-haiku-4-5   (triage)
ANTHROPIC_MODEL_SMART    # default claude-sonnet-4-5  (drafts)
EMAIL_TRIAGE_REP_IDS     # allowlist | "*" | unset(off)
CRON_SECRET              # bearer for the sync/triage HTTP triggers
```

### 1.7 What to build
1. Gmail sync engine — token mgmt + history cursor + reconciliation (`syncTick.ts`). Keep the seed-then-incremental pattern; wire the "Load" button to `POST /api/cron/gmail-sync`.
2. `triageEmail()` + `draftEmailReply()` prompts — reuse near-verbatim.
3. `replyToGmailThread()` threading — reuse as-is (keep the headers).
4. The 4-table schema + `google_tokens`.
5. `shouldDraftForLead()` dedup guard.
6. UI: collapsible thread rows + server actions + SSE live updates.

---

## 2. Telegram assistant

**What it does:** A conversational copilot over Telegram. User texts or sends voice notes in plain language; Claude interprets the intent and *executes CRM actions* (add/update lead, log call, book meeting, create task, log KPI, etc.), then replies with a confirmation. It also pushes proactive daily briefings and appointment reminders. Voice notes are transcribed and treated like text.

### 2.1 Setup
- Webhook: `POST /api/telegram/webhook`. Bot token `TELEGRAM_BOT_TOKEN`, username default `VirtualCloserBot`, shared secret `TELEGRAM_WEBHOOK_SECRET` (validated on the `x-telegram-bot-api-secret-token` header, fail-closed in prod).
- Register:
  ```bash
  curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -d url=https://<crm-domain>/api/telegram/webhook \
    -d secret_token=${TELEGRAM_WEBHOOK_SECRET}
  ```
- A Telegram bot points at exactly **one** webhook URL. To reuse the existing VirtualCloser bot on the CRM, just repoint it at the CRM domain (or run a small fan-out router if two apps must share one bot).

### 2.2 Linking a user to their Telegram chat
1. "Connect Telegram" button → deep link `https://t.me/{botUsername}?start={linkCode}`.
2. Each member has a unique 8-char `telegram_link_code` (generated at member creation, `lib/members.ts`).
3. User sends `/link CODE` → `findMemberByLinkCode()` → `bindChatToMember(memberId, chatId)` stores `members.telegram_chat_id`.
4. Inbound resolution: `findTenantByChatId(chatId)` maps a chat back to `{ tenant, member }`; every created row is scoped by `owner_member_id`.

### 2.3 Message handling
Entry: `app/api/telegram/webhook/route.ts`. Handles three message types:
- **Callback queries** (inline-button taps): `memo:*`, `agent:choice:*`, `kpi:*`, `bulk_kind:*`.
- **Slash commands**: `/link`, `/timezone`, `/help`, `/start`, `/walkie`, `/pitch`, `/bulk`, `/dialer`, `/confirm`, `/report`.
- **Free text** → intent interpretation. Fast path `interpretTelegramMessage()` (Haiku); deep path `interpretTelegramMessageDeep()` (Sonnet) when the fast path is insufficient.
- **Voice notes** → `transcribeTelegramVoice()` (OpenAI Whisper) → archived to Supabase Storage `voice-memos` bucket → interpreted like text.

### 2.4 Intent → action (the core)
Claude returns `{ intents: [...], reply_hint }`. Intent kinds: `add_lead`, `update_lead`, `log_call`, `schedule_followup`, `brain_item` (task/note), `book_meeting`, `reschedule_meeting`, `set_target`, `report`, `bulk_import_leads`, `log_kpi`, `room_post`, `dm_member`, `defer_item`, `question`.

`executeIntent()` dispatches each to a DB write: leads→`leads`, calls→`call_logs`, meetings→Google Calendar API, tasks→`brain_items`, KPIs→`kpi_card_entries`, etc. **This dispatcher is the piece to port** — it's the mapping from natural language to CRM writes. Re-point each case at the CRM's own tables. Start with a subset (add/update lead, log call, book meeting) and expand.

### 2.5 Deeper agent loop (optional, for multi-step requests)
`lib/agent/runAgent.ts` — a tool-using Claude agent (Sonnet, `ANTHROPIC_MODEL_AGENT`). Tools: `list_brain_items`, `get_lead_details`, `list_leads`, `web_search` (Tavily), `remember`/`forget`/`list_learned` (durable per-user prefs), `report_issue`, `delegate_intents`. Guardrails: max 8 tool turns, 35s timeout, daily quota (200 individual / 2000 enterprise) via `agent_usage`.

### 2.6 Proactive outbound (cron)
- `app/api/cron/coach/route.ts` — timezone-aware daily/weekly/monthly briefings ("here's your day / appointments / what needs attention") pushed to Telegram.
- `app/api/cron/confirm-appointments/route.ts` — nudges/dials attendees for meetings 45–75 min out.
- `app/api/cron/booking-reminders/route.ts` — 24h / 1h reminders.
All cron routes auth with `Authorization: Bearer ${CRON_SECRET}`.

### 2.7 Key files
`lib/telegram.ts` (send functions: `sendTelegramMessage`, `sendTelegramVoice`, `answerCallbackQuery`, `editTelegramReplyMarkup`), `app/api/telegram/webhook/route.ts` (handler + `executeIntent`), `lib/claude.ts` (`interpretTelegramMessage` + prompts), `lib/agent/runAgent.ts` (agent loop), `lib/members.ts` (linking), `lib/voice-memos.ts` + `lib/transcribe.ts` (voice), `app/api/cron/coach/route.ts` (briefings).

### 2.8 Tables
```sql
members(id uuid pk, rep_id text, telegram_chat_id text, telegram_link_code text,
  email, display_name, role, timezone, settings jsonb)

voice_memos(id uuid, rep_id text, sender_member_id uuid, recipient_member_id uuid null,
  lead_id uuid null, kind, status, telegram_file_id, storage_path, transcript,
  tg_relay_chat_id, tg_relay_message_id)
-- intents write to your existing CRM tables: leads, call_logs, brain_items, kpi_card_entries, etc.
```

### 2.9 Config
```
TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME / TELEGRAM_WEBHOOK_SECRET
ANTHROPIC_API_KEY
ANTHROPIC_MODEL_FAST / ANTHROPIC_MODEL_SMART / ANTHROPIC_MODEL_AGENT
OPENAI_API_KEY / OPENAI_TRANSCRIBE_MODEL   # Whisper voice transcription (default whisper-1)
TAVILY_API_KEY                              # agent web_search tool (only if you build §2.5)
CRON_SECRET                                 # bearer for the briefing/reminder crons
```

### 2.10 What to build
1. Webhook handler + secret validation + `findTenantByChatId()` resolution.
2. Linking model (`telegram_chat_id` + `telegram_link_code`) + `/link` flow.
3. `interpretTelegramMessage()` + `executeIntent()` pointed at CRM tables (start with core intents).
4. Voice: Whisper transcription → treat as text.
5. Daily briefing cron.
6. (Optional) the tool-using agent loop for multi-step requests.

---

## 3. Trello

**What it does today:** A **read-only** live Kanban view of the user's own Trello boards inside the dashboard. User connects with their own Trello API key + token; the page renders boards → lists → cards (name, description snippet, due date, labels). It does **not** yet create cards from the UI, sync leads↔cards, or receive webhooks. Be clear-eyed: this is a viewer, and everything past that is greenfield.

### 3.1 How it's built
- **Page:** `app/dashboard/trello/page.tsx` (SSR, `dynamic = 'force-dynamic'`) + `TrelloBoardSelect.tsx` (board dropdown). Route `/dashboard/trello`.
- **Auth:** user brings their own Trello **API key + permanent token** (scope `read,write`, `expiration=never`). No shared app secret, no env vars. Setup flow lives in `app/dashboard/integrations/page.tsx` (`saveTrelloToken()` validates via `/members/me`, `disconnectTrello()` clears it).
- **Storage:** all state in the `reps.integrations` JSONB column — `trello_api_key`, `trello_token`, `trello_member_id`, `trello_member`, optional `trello_default_board_id`. No dedicated Trello tables.
- **API wrapper:** `lib/trello.ts` — all calls go straight to `https://api.trello.com/1` with `key=` + `token=` query params:
  | Function | Endpoint | Status |
  |----------|----------|--------|
  | `validateTrelloToken()` | `GET /members/me` | used (setup) |
  | `getTrelloBoards()` | `GET /members/me/boards` | used |
  | `getTrelloListsWithCards()` | `GET /boards/{id}/lists` (+cards) | used |
  | `createTrelloCard()` | `POST /cards` | **exists but unused (stub)** |
- **Gating:** the tab shows purely when a token is present — `dashboardTabs.ts:51` → `hasTrello = Boolean(repRow.integrations?.trello_token)`. No add-on, tier, or brand restriction. If not connected, the page prompts the user to Settings → Integrations.

### 3.2 What's NOT built (greenfield for the CRM)
- Create/edit cards from the UI (the function exists; nothing calls it).
- CRM ↔ Trello sync (leads → cards, disposition → list moves).
- Two-way / webhook-driven live updates.
- Any AI processing of Trello data.

### 3.3 Config
None required globally — per-user API key + token, stored in `reps.integrations`. (Setup links: user gets a key at `https://trello.com/app-key`, then authorizes to get a token.)

### 3.4 What to build
1. **Baseline (port as-is):** connect flow (key+token → validate → store in JSONB), board selector, read-only Kanban render. Cheap, already proven.
2. **First real feature — push CRM → Trello:** wire the existing `createTrelloCard()` to a button/action so a lead can be pushed to a chosen list as a card. Store the resulting `cardId` on the lead so you can update it later.
3. **Sync state:** add a small link table (e.g. `trello_links(lead_id, board_id, list_id, card_id, updated_at)`) so you know which lead maps to which card — this is the prerequisite for any two-way sync.
4. **(Later) live updates:** register a Trello webhook per board → ingest card moves → update lead disposition. This is the only piece that needs new infra beyond the above.
