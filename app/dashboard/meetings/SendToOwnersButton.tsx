'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Result = {
  sent: number
  already: number
  people: Array<{ name: string; count: number }>
  unmatched: Array<{ owner: string | null; text: string; reason: 'no-owner' | 'not-on-team' | 'ambiguous' }>
}

const WHY: Record<Result['unmatched'][number]['reason'], string> = {
  'no-owner': 'no owner named',
  'not-on-team': 'not on your team in Suite CXO',
  ambiguous: 'matches more than one person',
}

/**
 * "Send to each owner's Today": one tap files every action item onto its
 * owner's Today list (POST /api/meetings/send-to-owners), then a toast says
 * how many went and lists, by name, anyone it could not match.
 */
export default function SendToOwnersButton({ noteId, itemCount }: { noteId: string; itemCount: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!result || result.unmatched.length) return
    const t = window.setTimeout(() => setResult(null), 6000)
    return () => window.clearTimeout(t)
  }, [result])

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/meetings/send-to-owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      })
      const json = (await res.json().catch(() => ({}))) as Result & { error?: string }
      if (!res.ok) {
        setError(json.error || 'Could not send. Try again.')
        return
      }
      setResult(json)
      router.refresh()
    } catch {
      setError('Could not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const headline = result
    ? result.sent > 0
      ? `${result.sent} ${result.sent === 1 ? 'to-do' : 'to-dos'} sent${result.people.length ? ` to ${result.people.map((p) => `${p.name.split(' ')[0]} (${p.count})`).join(', ')}` : ''}`
      : result.already > 0
        ? 'Already on their Today lists'
        : 'Nothing sent'
    : null

  return (
    <div className="cx-mtg-send">
      <button type="button" className="cx-btn cx-btn-sm" disabled={busy || itemCount === 0} onClick={send} data-testid="send-to-owners">
        {busy ? 'Sending' : "Send to each owner's Today"}
      </button>
      {error && <p className="cx-mtg-send-err" role="alert">{error}</p>}
      {result && (
        <div className="cx-mtg-toast" role="status" aria-live="polite" data-testid="send-toast">
          <div className="cx-mtg-toast-top">
            <strong>{headline}</strong>
            <button type="button" aria-label="Close" onClick={() => setResult(null)}>×</button>
          </div>
          {result.sent > 0 && result.already > 0 && <p>{result.already} were already there.</p>}
          {result.unmatched.length > 0 && (
            <>
              <p>Not sent ({result.unmatched.length}):</p>
              <ul>
                {result.unmatched.map((u, i) => (
                  <li key={i}>
                    <span className="b">{u.text}</span>
                    <span className="w">{u.owner ? `${u.owner}: ` : ''}{WHY[u.reason]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
