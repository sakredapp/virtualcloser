'use client'

import { useEffect, useState } from 'react'

/**
 * Last-resort error boundary. Replaces Next.js's default
 * "Application error: a client-side exception has occurred" screen.
 *
 * Like app/error.tsx, this auto-recovers from stale Server Action /
 * stale chunk errors after a deploy. Must include its own <html>/<body>
 * because it replaces the root layout when it renders.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error.tsx]', error)

    if (isRecoverableDeployError(error)) {
      try {
        const key = 'vc:lastStaleReload'
        const now = Date.now()
        const last = Number(sessionStorage.getItem(key) ?? '0')
        if (now - last > 60_000) {
          sessionStorage.setItem(key, String(now))
          setReloading(true)
          window.location.reload()
          return
        }
      } catch {
        // ignore
      }
    }
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ff2800',
          color: '#fff',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
          {reloading ? (
            <p style={{ opacity: 0.85 }}>Updating to the latest version…</p>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: '1.5rem' }}>
                Something went wrong.
              </h1>
              <p style={{ opacity: 0.85, marginTop: '0.6rem' }}>
                {isRecoverableDeployError(error)
                  ? 'A new version of the app shipped while this tab was open. Reload to fix it.'
                  : 'The page hit an unexpected error. Try reloading.'}
              </p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '0.6rem',
                  marginTop: '1.2rem',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setReloading(true)
                    window.location.reload()
                  }}
                  style={btn}
                >
                  Reload page
                </button>
                <button
                  type="button"
                  onClick={() => reset()}
                  style={{ ...btn, background: 'transparent', border: '1px solid rgba(255,255,255,0.6)' }}
                >
                  Try again
                </button>
              </div>
              {error.digest && (
                <p style={{ marginTop: '1.4rem', fontSize: '0.78rem', opacity: 0.6 }}>
                  Reference: {error.digest}
                </p>
              )}
            </>
          )}
        </div>
      </body>
    </html>
  )
}

const btn: React.CSSProperties = {
  background: '#fff',
  color: '#ff2800',
  border: 'none',
  padding: '0.6rem 1.1rem',
  borderRadius: 8,
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: '0.95rem',
}

function isRecoverableDeployError(err: unknown): boolean {
  if (!err) return false
  const msg = (err as { message?: string }).message ?? ''
  const name = (err as { name?: string }).name ?? ''
  return (
    /Server Action.*was not found on the server/i.test(msg) ||
    /failed to find Server Action/i.test(msg) ||
    /UnrecognizedActionError/i.test(msg) ||
    /failed-to-find-server-action/i.test(msg) ||
    /ChunkLoadError/i.test(name) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg)
  )
}
