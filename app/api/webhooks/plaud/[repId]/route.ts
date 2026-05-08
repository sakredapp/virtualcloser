// Plaud → VirtualCloser webhook (delivered via Zapier).
//
// URL: POST /api/webhooks/plaud/[repId]?secret=<plaud_webhook_secret>
//
// Zapier field mapping:
//   title       → Title
//   summary     → Summary
//   transcript  → Transcript
//   created_at  → Create Time
//
// What it does:
//   1. Auth via ?secret= matching reps.integrations.plaud_webhook_secret
//   2. Stores the call in plaud_notes (title, transcript, summary, action_items)
//   3. If no explicit action_items, uses Claude to extract tasks from the transcript
//   4. Creates brain_items (type='task') so tasks appear on the dashboard

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PlaudPayload = {
  title?: string | null
  name?: string | null
  note_title?: string | null
  transcript?: string | null
  transcription?: string | null
  summary?: string | null
  note_summary?: string | null
  action_items?: unknown
  tasks?: unknown
  todo_items?: string | null
  created_at?: string | null
  date?: string | null
  [key: string]: unknown
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

function pickString(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

async function extractTasksFromText(text: string): Promise<string[]> {
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Extract every concrete action item or next step from the following call transcript. Return ONLY a JSON array of short task strings, nothing else. If there are no clear action items return [].

Transcript:
${text.slice(0, 6000)}`,
      }],
    })
    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return (parsed as unknown[]).map((i) => String(i).trim()).filter((s) => s.length > 0).slice(0, 30)
  } catch {
    return []
  }
}

function parseActionItems(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          return String(o.text ?? o.description ?? '')
        }
        return ''
      })
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  if (typeof raw !== 'string') return []
  const str = raw.trim()
  if (!str) return []
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str)
      if (Array.isArray(parsed)) return parseActionItems(parsed)
    } catch { /* fall through */ }
  }
  const lines = str.split(/\r?\n/).map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim()).filter((l) => l.length > 1)
  if (lines.length > 1) return lines
  const parts = str.split(',').map((l) => l.trim()).filter((l) => l.length > 1)
  if (parts.length > 1) return parts
  return [str]
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')?.trim() ?? ''

  const { data: rep, error: repErr } = await supabase
    .from('reps')
    .select('id, slug, is_active, integrations')
    .eq('id', repId)
    .maybeSingle()

  if (repErr || !rep || !rep.is_active) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  const integrations = (rep.integrations ?? {}) as Record<string, unknown>
  const storedSecret = typeof integrations.plaud_webhook_secret === 'string' ? integrations.plaud_webhook_secret : ''

  if (!storedSecret || !secret || !safeEqual(secret, storedSecret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let payload: PlaudPayload
  try {
    payload = (await req.json()) as PlaudPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const title = pickString(payload.title, payload.name, payload.note_title) ?? 'Plaud note'
  const transcript = pickString(payload.transcript, payload.transcription)
  const summary = pickString(payload.summary, payload.note_summary)
  const occurredAt = pickString(payload.created_at, payload.date) ?? new Date().toISOString()

  // Use explicit action_items if provided, otherwise extract from transcript/summary with Claude
  let actionItems = parseActionItems(payload.action_items ?? payload.tasks ?? payload.todo_items).slice(0, 30)
  if (actionItems.length === 0) {
    const source = transcript ?? summary
    if (source) actionItems = await extractTasksFromText(source)
  }

  // Store in plaud_notes
  const { error: noteErr } = await supabase.from('plaud_notes').insert({
    rep_id: rep.id,
    title,
    transcript: transcript ?? null,
    summary: summary ?? null,
    action_items: actionItems,
    occurred_at: occurredAt,
  })

  if (noteErr) {
    return NextResponse.json({ ok: false, error: 'failed to store note' }, { status: 500 })
  }

  // Create brain_items so tasks appear in Brain Dump for management
  let tasksCreated = 0
  if (actionItems.length > 0) {
    const rows = actionItems.map((content) => ({
      rep_id: rep.id,
      item_type: 'task' as const,
      content,
      priority: 'normal' as const,
      horizon: 'week' as const,
      status: 'open' as const,
    }))
    const { error } = await supabase.from('brain_items').insert(rows)
    if (!error) tasksCreated = rows.length
  }

  return NextResponse.json({
    ok: true,
    tenant: rep.slug,
    tasks_created: tasksCreated,
    note_title: title,
    occurred_at: occurredAt,
  })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'virtualcloser/plaud' })
}
