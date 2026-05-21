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
import { listGmailThreads, getGmailThreadMetadata, type GmailThreadMetadata } from '@/lib/google'
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

CRITICAL RULES:
- Search ALL of the user's mail by default. Gmail's q= already searches the
  full text of every email (subject + body + sender) across the WHOLE
  mailbox, including ARCHIVED mail. So DO NOT add "in:inbox" — that would
  hide archived emails. Only add "in:inbox" / "in:sent" / "in:trash" if the
  user EXPLICITLY names that location ("in my inbox", "in sent").
- Be MINIMAL with operators. Prefer plain keywords over narrow filters.
  Every operator you add can only REMOVE results. When in doubt, use fewer.
- Only add from:/after:/before: when the user is explicit about sender or
  dates. Don't guess a sender's exact address — a bare keyword matches the
  body too.
- Keep meaningful search terms as plain words (Gmail full-text matches them
  in the body). Don't force them into subject: unless the user said "subject".

Operators available: from: to: subject: has:attachment after:YYYY/MM/DD
before:YYYY/MM/DD newer_than:7d older_than:30d is:unread is:starred
in:inbox/sent/trash label: "exact phrase". Combine with implicit AND or OR.

User asked: """${naturalQuery}"""

Respond with ONLY the Gmail query string, nothing else — no quotes, no code fences, no explanation. Examples:
  "find emails from josh about carriers"
    -> from:josh carrier
  "what did pinnacle send me last week"
    -> from:pinnacle newer_than:7d
  "the contract pdf someone sent in may"
    -> contract has:attachment after:${year}/05/01 before:${year}/06/01
  "anything about the bluecross renewal"
    -> bluecross renewal
  "unread emails in my inbox"
    -> is:unread in:inbox`

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

/**
 * Strip Gmail operators down to bare keywords for the fallback pass. Removes
 * from:/after:/in:/etc. tokens, keeps plain words and "quoted phrases".
 */
function rawKeywords(q: string): string {
  return q
    .split(/\s+/)
    .filter((tok) => !/^[a-z_]+:/i.test(tok) && !/^is:|^has:|^label:/i.test(tok))
    .join(' ')
    .trim()
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

  // Step 2: search the user's ENTIRE mailbox (all mail, incl. archived).
  const ownerMemberId = tenant.tier === 'enterprise' ? member.id : null
  let effectiveQuery = gmailQuery
  let search = await listGmailThreads(tenant.id, ownerMemberId, {
    q: effectiveQuery,
    maxResults: MAX_RESULTS,
  })
  if (!search.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: search.error ?? 'gmail_search_failed',
        translated_query: effectiveQuery,
      },
      { status: 502 },
    )
  }

  // Fallback: if the operator query returned nothing, the translation was
  // likely over-constrained (wrong date guess, sender that didn't match,
  // forced subject:). Retry once with bare keywords so Gmail does a plain
  // full-text search across all mail — closer to what the user expects when
  // they "search their inbox" the way Gemini-in-Gmail does.
  let usedFallback = false
  if ((search.threads ?? []).length === 0) {
    const keywords = rawKeywords(effectiveQuery) || rawKeywords(userQ) || userQ
    if (keywords && keywords !== effectiveQuery) {
      const retry = await listGmailThreads(tenant.id, ownerMemberId, {
        q: keywords,
        maxResults: MAX_RESULTS,
      })
      if (retry.ok && (retry.threads ?? []).length > 0) {
        search = retry
        effectiveQuery = keywords
        usedFallback = true
      }
    }
  }

  const entries = search.threads ?? []
  if (entries.length === 0) {
    return NextResponse.json({
      ok: true,
      matches: [],
      translated_query: effectiveQuery,
      used_fallback: usedFallback,
    })
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

  // For matches NOT in our sync cache, fetch lightweight metadata straight
  // from Gmail (From / Subject / Date + snippet, no bodies) so every result
  // shows the real sender + subject — never a blank "see Gmail" row. Bounded
  // parallelism keeps it fast for the ≤20 matches.
  const uncached = entries.filter((e) => e.id && !cacheById.has(e.id))
  const metaById = new Map<string, GmailThreadMetadata>()
  if (uncached.length > 0) {
    const CONCURRENCY = 6
    for (let i = 0; i < uncached.length; i += CONCURRENCY) {
      const batch = uncached.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map((e) => getGmailThreadMetadata(tenant.id, ownerMemberId, e.id!)),
      )
      results.forEach((r, idx) => {
        if (r.ok && r.meta) metaById.set(batch[idx].id!, r.meta)
      })
    }
  }

  const matches: Match[] = entries.map((e) => {
    const cached = cacheById.get(e.id!)
    const meta = e.id ? metaById.get(e.id) : undefined
    return {
      thread_id: cached?.id ?? '',
      gmail_thread_id: e.id ?? '',
      from:
        cached?.from_name ||
        cached?.from_address ||
        meta?.fromName ||
        meta?.fromAddress ||
        null,
      subject: cached?.subject ?? meta?.subject ?? null,
      snippet: cached?.snippet ?? meta?.snippet ?? e.snippet ?? null,
      last_message_at: cached?.last_message_at ?? meta?.lastMessageAt ?? null,
      has_draft: cached ? draftSet.has(cached.id) : false,
      in_cache: Boolean(cached),
    }
  })

  return NextResponse.json({
    ok: true,
    matches,
    translated_query: effectiveQuery,
    used_translation: translated !== null,
    used_fallback: usedFallback,
  })
}
