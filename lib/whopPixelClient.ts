/**
 * Browser-only helper: call window.whop.track once the pixel stub exists.
 * The stub is set by the inline snippet (afterInteractive), which can run
 * after a page's own effect, so wait for it briefly (up to ~10s), then give up.
 */
type WhopGlobal = { track: (...args: unknown[]) => void }

export function whopTrack(...args: unknown[]): void {
  if (typeof window === 'undefined') return
  let tries = 0
  const go = () => {
    const w = (window as unknown as { whop?: WhopGlobal }).whop
    if (w && typeof w.track === 'function') {
      try {
        w.track(...args)
      } catch {
        // Tracking never breaks the page.
      }
      return
    }
    if (++tries < 40) setTimeout(go, 250)
  }
  go()
}
