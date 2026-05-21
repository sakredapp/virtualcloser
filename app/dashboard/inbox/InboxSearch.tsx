'use client'

// Natural-language search over the user's ENTIRE Gmail (not just synced).
//
// Spencer types "find the carrier list from josh in may"; /api/inbox/search
// uses Claude to translate it into Gmail search syntax, queries Gmail's API
// directly across his whole mailbox (inbox + archived + sent), and pulls
// real sender/subject/snippet on demand for each match. No local sync is
// required — the email_threads cache is only a fast-path. Click a match →
// opens that thread in Gmail for the full body / attachments / reply chain.

import { useState } from 'react'

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

type SearchResponse = {
  ok?: boolean
  matches?: Match[]
  translated_query?: string
  used_translation?: boolean
  error?: string
}

export default function InboxSearch() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/inbox/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      })
      const json = (await res.json()) as SearchResponse
      if (!res.ok || !json.ok) {
        setError(json.error ?? `search failed (${res.status})`)
      } else {
        setResult(json)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const matches = result?.matches ?? null

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask AI to search your Gmail — e.g. “carrier list from Josh in May”"
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.55rem 0.8rem',
            borderRadius: '8px',
            border: '1px solid var(--border, var(--border-soft))',
            fontSize: '0.9rem',
            background: '#fff',
          }}
        />
        <button
          type="submit"
          className="btn approve"
          disabled={loading || !q.trim()}
          style={{ minWidth: '90px' }}
        >
          {loading ? 'Searching…' : 'Ask AI'}
        </button>
        {result && (
          <button
            type="button"
            className="btn dismiss"
            onClick={() => {
              setResult(null)
              setError(null)
              setQ('')
            }}
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <p
          style={{
            margin: '0.5rem 0 0',
            color: '#9f1239',
            fontSize: '0.85rem',
          }}
        >
          {`Search failed: ${error}`}
        </p>
      )}

      {result?.translated_query && (
        <p
          style={{
            margin: '0.4rem 0 0',
            fontSize: '0.75rem',
            color: 'var(--muted)',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {result.used_translation ? 'AI → Gmail: ' : 'Gmail: '}
          <span style={{ color: 'var(--royal, #4338ca)' }}>{result.translated_query}</span>
        </p>
      )}

      {matches && matches.length === 0 && !error && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
          No matches in your Gmail history for that query.
        </p>
      )}

      {matches && matches.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0.6rem 0 0',
            display: 'grid',
            gap: '0.4rem',
          }}
        >
          {matches.map((m) => (
            <li
              key={m.thread_id}
              style={{
                padding: '0.55rem 0.8rem',
                background: '#fff',
                border: '1px solid var(--border, var(--border-soft))',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {m.from || '(unknown)'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  {m.last_message_at
                    ? new Date(m.last_message_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : ''}
                </div>
              </div>
              <div style={{ fontSize: '0.88rem', marginTop: '0.15rem' }}>
                {m.subject || '(no subject — open in Gmail to view)'}
                {m.has_draft && (
                  <span
                    style={{
                      marginLeft: '0.4rem',
                      background: 'rgba(67, 56, 202, 0.12)',
                      color: 'var(--royal, #4338ca)',
                      padding: '0.05rem 0.4rem',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                    }}
                  >
                    DRAFT READY
                  </span>
                )}
              </div>
              {m.snippet && (
                <p
                  style={{
                    margin: '0.2rem 0',
                    fontSize: '0.8rem',
                    color: 'var(--muted)',
                  }}
                >
                  {m.snippet.slice(0, 200)}
                </p>
              )}
              <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.4rem' }}>
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${m.gmail_thread_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn dismiss"
                  style={{ textDecoration: 'none', fontSize: '0.8rem' }}
                >
                  Open in Gmail ↗
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
