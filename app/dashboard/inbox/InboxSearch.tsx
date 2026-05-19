'use client'

// Gemini-powered natural-language search over the synced inbox.
//
// Spencer types "find the carrier list from josh in may", we send it to
// /api/inbox/search which feeds the query + thread digests to Gemini and
// returns a small ranked list. Click a match → opens that thread in
// Gmail (so the user gets the full message body / attachments / quoted
// reply chain). The list of matches is purely advisory; we don't try to
// inline the body here.

import { useState } from 'react'

type Match = {
  thread_id: string
  gmail_thread_id: string | null
  from: string | null
  subject: string | null
  snippet: string | null
  last_message_at: string | null
  reason: string | null
}

export default function InboxSearch() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query || loading) return
    setLoading(true)
    setError(null)
    setMatches(null)
    try {
      const res = await fetch('/api/inbox/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        matches?: Match[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        setError(json.error ?? `search failed (${res.status})`)
      } else {
        setMatches(json.matches ?? [])
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask Gemini about your inbox — e.g. “carrier list from Josh in May”"
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.55rem 0.8rem',
            borderRadius: '8px',
            border: '1px solid var(--border, #e2e8f0)',
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
          {loading ? 'Searching…' : 'Ask Gemini'}
        </button>
        {matches && (
          <button
            type="button"
            className="btn dismiss"
            onClick={() => {
              setMatches(null)
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
          {error === 'GEMINI_API_KEY not configured'
            ? 'Gemini search not configured yet — set GEMINI_API_KEY on Vercel + Hetzner.'
            : `Search failed: ${error}`}
        </p>
      )}

      {matches && matches.length === 0 && !error && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
          No matches in your last 200 synced threads.
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
                border: '1px solid var(--border, #e2e8f0)',
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
                {m.subject || '(no subject)'}
              </div>
              {m.reason && (
                <p
                  style={{
                    margin: '0.25rem 0',
                    fontSize: '0.8rem',
                    fontStyle: 'italic',
                    color: 'var(--royal, #4338ca)',
                  }}
                >
                  {m.reason}
                </p>
              )}
              <div style={{ marginTop: '0.3rem' }}>
                {m.gmail_thread_id && (
                  <a
                    href={`https://mail.google.com/mail/u/0/#inbox/${m.gmail_thread_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn dismiss"
                    style={{ textDecoration: 'none', fontSize: '0.8rem' }}
                  >
                    Open in Gmail ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
