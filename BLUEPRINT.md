# Virtual Closer - Build Blueprint

## What this is
A deployable AI-powered virtual sales assistant. Each instance is scoped to one sales rep.

## Stack (zero recurring server costs)
- Frontend + API: Next.js on Vercel
- Cron jobs: Vercel Cron
- Database: Supabase (Postgres)
- AI brain: Anthropic Claude API
- Notifications: Slack Webhook

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
