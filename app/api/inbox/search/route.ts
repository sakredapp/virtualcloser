// Natural-language search across the rep's ENTIRE Gmail mailbox.
//
// Flow:
//   1. Claude (haiku — cheap) translates the user's plain-English query
//      into Gmail search syntax (from:..., after:..., has:attachment).
//   2. We hit Gmail's threads.list?q=... — searches every email in the
//      rep's mailbox, not just our 200-thread sync cache.
//   3. For each match, hydrate metadata from our DB cache when we have
//      it; otherwise display just the snippet + a deep-link to Gmail.
//
// Why this beats searching our cache: full coverage of his ~2,600+
// emails, sub-second response, and rides Gmail's native indexing —
// effectively the same capability as the Gemini sidebar inside Gmail,
// just surfaced inside VC. Uses the Claude key we already have set
// everywhere; no new env vars to provision.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'
import { listGmailThreads } from '@/lib/google'
import { generateText } from '@/lib/claude'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_QUERY_LEN = 500
const MAX_RESULTS = 20

type Match = {
  thread_id: string
  gmail_thread_id: string
  from: string | null
  subject: string | null
  snippet: string | null
  last_message_at: string | null
  has_draft: boolean
  in_cache: boolean
}

async function translateToGmailQuery(naturalQuery: string, today: string): Promise<string | null> {
  const year = today.slice(0, 4)
  const prompt = `Convert this natural-language email-search request into a Gmail search query string.

Today's date (use for relative dates like "last week"): ${today}

Gmail search operators you can use:
  from:<email-or-name>     — sender
  to:<email>               — recipient
  subject:<text>           — subject contains
  has:attachment           — has attachment
  after:YYYY/MM/DD         — sent after date
  before:YYYY/MM/DD        — sent before date
  newer_than:7d            — relative (1h, 1d, 7d, 1m, etc.)
  older_than:30d
  is:unread                — unread
  is:starred               — starred
  in:inbox / in:sent / in:trash
  label:<name>             — labeled
  "exact phrase"           — exact match

Combine with AND (implicit) and OR. Use parens for grouping.

User asked: """${naturalQuery}"""

Respond with ONLY the Gmail query string, nothing else — no quotes, no code fences, no explanation. Examples:
  "find emails from josh about carriers in may"
    -> from:josh "carrier" after:${year}/05/01 before:${year}/06/01
  "what did pinnacle send me last week"
    -> from:pinnacle newer_than:7d
  "unread emails I haven't replied to"
    -> is:unread in:inbox
  "attachments from chase"
    -> from:chase has:attachment`

  try {
    const raw = await generateText({ prompt, maxTokens: 200 })
    const cleaned = raw
      .replace(/```[a-z]*|```/gi, '')
      .replace(/^["'`]|["'`]$/g, '')
      .trim()
    return cleaned || null
  } catch (err) {
    console.error('[inbox-search] claude translate threw', err)
    return null
  }
}

export async function POST(req: NextRequest) {
  let tenant, member
  try {
    ;({ tenant, member } = await requireMember())
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { q?: string }
  const userQ = typeof body.q === 'string' ? body.q.trim().slice(0, MAX_QUERY_LEN) : ''
  if (!userQ) {
    return NextResponse.json({ ok: false, error: 'q required' }, { status: 400 })
  }

  // Step 1: translate via Gemini. If Gemini isn't configured (no key), fall
  // back to passing the raw query — Gmail does decent literal matching too.
  const todayIso = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
  const translated = await translateToGmailQuery(userQ, todayIso)
  const gmailQuery = translated ?? userQ

  // Step 2: search Spencer's entire Gmail mailbox.
  const ownerMemberId = tenant.tier === 'enterprise' ? member.id : null
  const search = await listGmailThreads(tenant.id, ownerMemberId, {
    q: gmailQuery,
    maxResults: MAX_RESULTS,
  })
  if (!search.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: search.error ?? 'gmail_search_failed',
        translated_query: gmailQuery,
      },
      { status: 502 },
    )
  }

  const entries = search.threads ?? []
  if (entries.length === 0) {
    return NextResponse.json({ ok: true, matches: [], translated_query: gmailQuery })
  }

  // Step 3: hydrate metadata from our DB cache for any thread we already
  // have. This avoids a Gmail round-trip per match for the common case
  // (recent threads — most of what Spencer searches for).
  const gmailIds = entries.map((e) => e.id).filter(Boolean) as string[]
  const { data: cached } = await supabase
    .from('email_threads')
    .select(
      'id, gmail_thread_id, subject, from_address, from_name, snippet, last_message_at',
    )
    .eq('rep_id', tenant.id)
    .in('gmail_thread_id', gmailIds)
  const cacheById = new Map<string, {
    id: string
    subject: string | null
    from_address: string | null
    from_name: string | null
    snippet: string | null
    last_message_at: string | null
  }>()
  for (const row of (cached ?? []) as Array<{
    id: string
    gmail_thread_id: string
    subject: string | null
    from_address: string | null
    from_name: string | null
    snippet: string | null
    last_message_at: string | null
  }>) {
    cacheById.set(row.gmail_thread_id, row)
  }

  // Are any of those cached threads draft-ready?
  const cachedThreadIds = Array.from(cacheById.values()).map((c) => c.id)
  const draftSet = new Set<string>()
  if (cachedThreadIds.length > 0) {
    const { data: drafts } = await supabase
      .from('email_drafts')
      .select('thread_id')
      .in('thread_id', cachedThreadIds)
      .eq('status', 'pending')
    for (const d of (drafts ?? []) as Array<{ thread_id: string }>) {
      draftSet.add(d.thread_id)
    }
  }

  const matches: Match[] = entries.map((e) => {
    const cached = cacheById.get(e.id!)
    return {
      thread_id: cached?.id ?? '',
      gmail_thread_id: e.id ?? '',
      from: cached?.from_name || cached?.from_address || null,
      subject: cached?.subject ?? null,
      snippet: cached?.snippet ?? null,
      last_message_at: cached?.last_message_at ?? null,
      has_draft: cached ? draftSet.has(cached.id) : false,
      in_cache: Boolean(cached),
    }
  })

  return NextResponse.json({
    ok: true,
    matches,
    translated_query: gmailQuery,
    used_translation: translated !== null,
  })
}
