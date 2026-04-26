'use client'

import { useEffect, useState } from 'react'

/**
 * Root error boundary. Auto-recovers from stale Server Action errors
 * (which happen when a deploy ships while a tab is open: the old page
 * tries to invoke an action by hash, the new server returns 404, and
 * Next throws "Server Action ... was not found on the server").
 *
 * For these specific errors we just hard-reload the page so the user
 * gets the new bundle and their click "just works" the second time.
 *
 * For any other error we show a friendly fallback with a retry button
 * instead of the white "Application error: a client-side exception"
 * screen.
 */
export default function GlobalAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    // Always log so we can see what happened in the console.
    // eslint-disable-next-line no-console
    console.error('[error.tsx]', error)

    if (isStaleServerActionError(error)) {
      // Avoid an infinite reload loop: only auto-reload once per minute.
      try {
        const key = 'vc:lastStaleReload'
        const now = Date.now()
        const last = Number(sessionStorage.getItem(key) ?? '0')
        if (now - last > 60_000) {
          sessionStorage.setItem(key, String(now))
          setReloading(true)
          // Full reload (not router refresh) so we get the new JS chunks
          // and the new server-action hashes.
          window.location.reload()
          return
        }
      } catch {
        // sessionStorage can throw in private mode — fall through to UI.
      }
    }
  }, [error])

  if (reloading) {
    return (
      <main className="wrap" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
        <p style={{ opacity: 0.7 }}>Updating to the latest version…</p>
      </main>
    )
  }

  const stale = isStaleServerActionError(error)

  return (
    <main className="wrap" style={{ padding: '3rem 1.5rem', maxWidth: 640 }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Something went wrong.</h1>
      <p style={{ opacity: 0.85, marginBottom: '1rem' }}>
        {stale
          ? 'A new version of the app shipped while this tab was open. Reloading will fix it.'
          : 'The page hit an unexpected error. You can try again or reload.'}
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn approve"
          onClick={() => {
            setReloading(true)
            window.location.reload()
          }}
        >
          Reload page
        </button>
        {!stale && (
          <button type="button" className="btn" onClick={() => reset()}>
            Try again
          </button>
        )}
      </div>
      {error.digest && (
        <p style={{ marginTop: '1.2rem', fontSize: '0.78rem', opacity: 0.55 }}>
          Reference: {error.digest}
        </p>
      )}
    </main>
  )
}

function isStaleServerActionError(err: unknown): boolean {
  if (!err) return false
  const msg = (err as { message?: string }).message ?? ''
  const name = (err as { name?: string }).name ?? ''
  // Next.js Server Action hash mismatch after a deploy:
  return (
    /Server Action.*was not found on the server/i.test(msg) ||
    /failed to find Server Action/i.test(msg) ||
    /UnrecognizedActionError/i.test(msg) ||
    /failed-to-find-server-action/i.test(msg) ||
    // Stale JS chunks after a deploy (old page tries to load a chunk that
    // no longer exists on the new build):
    /ChunkLoadError/i.test(name) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg)
  )
}
