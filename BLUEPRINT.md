# Virtual Closer - Build Blueprint

## What this is
A deployable AI-powered virtual sales assistant. Each instance is scoped to one sales rep.

## Stack
**App / infra**
- Next.js 15 + React 19 (App Router) on Vercel
- Vercel Cron for scheduled agents
- Vercel API (programmatic subdomain attach) — `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`

**Database**
- Supabase (Postgres, service-role key) — all tenant data, RLS on, app filters by `rep_id`

**AI**
- Anthropic Claude (`@anthropic-ai/sdk`) — drafts, classification, briefings — `ANTHROPIC_API_KEY`
- OpenAI Whisper — Telegram voice-note transcription — `OPENAI_API_KEY` (model `whisper-1`)

**Messaging / inbound**
- Telegram Bot API — text + voice in, alerts out — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `ADMIN_TELEGRAM_CHAT_ID`

**Email**
- Resend — branded transactional email — `RESEND_API_KEY`, `RESEND_FROM`

**Calendar / meetings**
- Cal.com — public booking + webhook → prospects — `CAL_WEBHOOK_SECRET`, `NEXT_PUBLIC_CAL_BOOKING_URL`
- Google OAuth (Gmail + Calendar) — per-rep — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI

**Per-tenant integrations (optional)**
- HubSpot (`hubspot_token` per rep)
- Pipedrive (sync target)
- Fathom / Fireflies / Gong (call intelligence)
- Zapier inbound webhook + outbound catch-hook

**Auth / secrets**
- bcryptjs for password hashing (admin + client)
- `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH`, `ROOT_DOMAIN`

## Agent schedule
- 8:00 AM: morning scan
- 10:00 AM: dormant check
- 2:00 PM: hot lead pulse

## Core schema
Tables:
- leads
- agent_actions
- agent_runs

See project setup notes in user specification for SQL details.
