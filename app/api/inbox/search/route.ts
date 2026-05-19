// Natural-language search over the rep's synced inbox, powered by Gemini.
//
// Spencer types "find the carrier list from josh in may" → we pull the
// most-recent N threads from email_threads for his rep_id, render them
// as tiny digests (sender, subject, snippet, sent_at), pass the digest
// to Gemini along with the query, and Gemini returns the matching
// thread ids + a one-line reason.
//
// Why Gemini specifically: the rep asked for Gemini. Architecturally
// any LLM works — Claude/OpenAI/Gemini all handle this fine. Gemini's
// 2M context lets us pass a lot more thread digests in one shot, which
// is a real advantage at inbox scale.
//
// Auth: viewer must be a logged-in member. Results are scoped to their
// rep_id at the DB layer, not at the model layer — Gemini only sees
// what we feed it.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_THREADS_IN_CONTEXT = 200
const MAX_QUERY_LEN = 500
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

type ThreadDigest = {
  id: string
  gmail_thread_id: string
  from_address: string | null
  from_name: string | null
  subject: string | null
  snippet: string | null
  last_message_at: string | null
  priority: string | null
}

export async function POST(req: NextRequest) {
  let tenant
  try {
    ;({ tenant } = await requireMember())
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'GEMINI_API_KEY not configured' },
      { status: 503 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { q?: string }
  const q = typeof body.q === 'string' ? body.q.trim().slice(0, MAX_QUERY_LEN) : ''
  if (!q) {
    return NextResponse.json({ ok: false, error: 'q required' }, { status: 400 })
  }

  // Pull the rep's most recent threads as digest context.
  const { data: threads } = await supabase
    .from('email_threads')
    .select(
      'id, gmail_thread_id, from_address, from_name, subject, snippet, last_message_at, priority',
    )
    .eq('rep_id', tenant.id)
    .order('last_message_at', { ascending: false })
    .limit(MAX_THREADS_IN_CONTEXT)

  const digests: ThreadDigest[] = (threads ?? []) as ThreadDigest[]
  if (digests.length === 0) {
    return NextResponse.json({ ok: true, matches: [], note: 'no threads synced yet' })
  }

  const digestText = digests
    .map((t, i) => {
      const date = t.last_message_at
        ? new Date(t.last_message_at).toISOString().slice(0, 10)
        : '?'
      const from = t.from_name ? `${t.from_name} <${t.from_address}>` : t.from_address
      return `[${i}] id=${t.id} | date=${date} | from=${from} | subject=${t.subject ?? ''} | snippet=${(t.snippet ?? '').slice(0, 140)}`
    })
    .join('\n')

  const prompt = `You are searching the inbox of a sales rep. Below is a digest of their most recent ${digests.length} email threads (one per line, indexed in brackets). The rep asked: "${q}"

Return ONLY JSON in the shape:
{"matches": [{"id": "<thread id>", "reason": "one short sentence why this matches"}]}

Rules:
- Return at most 10 matches, ordered by best fit.
- Be conservative: prefer precision over recall. If nothing genuinely matches, return {"matches": []}.
- "reason" should quote the specific signal — sender, subject keyword, or snippet phrase — don't be vague.

THREADS:
${digestText}`

  // Gemini REST API — generateContent.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`
  let modelText = ''
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      console.error('[inbox-search] gemini failed', res.status, text.slice(0, 300))
      return NextResponse.json(
        { ok: false, error: `gemini_${res.status}` },
        { status: 502 },
      )
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    modelText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  } catch (err) {
    console.error('[inbox-search] gemini call threw', err)
    return NextResponse.json({ ok: false, error: 'gemini_unreachable' }, { status: 502 })
  }

  // Parse model JSON (may be wrapped in ```json fences).
  let parsed: { matches?: Array<{ id?: string; reason?: string }> } = {}
  try {
    const cleaned = modelText.replace(/```json|```/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({
      ok: true,
      matches: [],
      note: 'model returned non-JSON',
      raw: modelText.slice(0, 400),
    })
  }

  // Validate matches: only return ones that actually exist in our digest set
  // (so the model can't hallucinate a thread id and we can't accidentally
  // leak cross-tenant data even if it tried to).
  const knownIds = new Set(digests.map((d) => d.id))
  const matchesRaw = parsed.matches ?? []
  const matches = matchesRaw
    .filter((m) => m && typeof m.id === 'string' && knownIds.has(m.id))
    .slice(0, 10)
    .map((m) => {
      const t = digests.find((d) => d.id === m.id)
      return {
        thread_id: m.id,
        gmail_thread_id: t?.gmail_thread_id ?? null,
        from: t?.from_name || t?.from_address || null,
        subject: t?.subject ?? null,
        snippet: t?.snippet ?? null,
        last_message_at: t?.last_message_at ?? null,
        reason: typeof m.reason === 'string' ? m.reason.slice(0, 200) : null,
      }
    })

  return NextResponse.json({ ok: true, matches })
}
