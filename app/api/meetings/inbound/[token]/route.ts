import { NextRequest, NextResponse } from 'next/server'
import { resolveInboundToken, ingestMeetingNote } from '@/lib/meetings/inbound'

/**
 * POST /api/meetings/inbound/<token>
 * Any note-taker via Zapier ("Webhooks by Zapier" → POST). Body (JSON or form):
 *   { title, started_at, attendees[], summary, transcript?, source }
 * The note is attached to the matching calendar meeting by time + attendees.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).email ?? (x as Record<string, unknown>).name ?? '') : ''))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100)
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (s.startsWith('[')) {
      try {
        return list(JSON.parse(s))
      } catch { /* fall through */ }
    }
    return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100)
  }
  return []
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const ctype = (req.headers.get('content-type') ?? '').toLowerCase()
  try {
    if (ctype.includes('application/json')) return (await req.json()) as Record<string, unknown>
    if (ctype.includes('form-data') || ctype.includes('x-www-form-urlencoded')) {
      const fd = await req.formData()
      const obj: Record<string, unknown> = {}
      for (const [k, v] of fd.entries()) {
        if (typeof v !== 'string') continue
        obj[k] = k in obj ? [obj[k], v].flat() : v
      }
      return obj
    }
    const raw = await req.text()
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return Object.fromEntries(new URLSearchParams(raw).entries())
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const owner = await resolveInboundToken(token)
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = await readBody(req)
  if (!body) return NextResponse.json({ ok: false, error: 'unparseable body' }, { status: 400 })

  const summary = str(body.summary, 50_000)
  const transcript = str(body.transcript, 500_000)
  if (!summary && !transcript) {
    return NextResponse.json({ ok: false, error: 'summary or transcript required' }, { status: 400 })
  }

  const res = await ingestMeetingNote(owner.repId, owner.memberId, {
    title: str(body.title, 300),
    startedAt: str(body.started_at, 64) ?? str(body.start_time, 64) ?? str(body.date, 64),
    attendees: list(body.attendees),
    summary,
    transcript,
    source: (str(body.source, 40) ?? 'zapier').toLowerCase(),
  })
  if (res.error) {
    console.error('[meetings-inbound] insert failed', res.error)
    return NextResponse.json({ ok: false, error: 'failed to store note' }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    id: res.id,
    matched_meeting: res.matched ? { title: res.matched.summary, start: res.matched.start } : null,
  })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'meetings-inbound' })
}
