'use client'

/**
 * The Whop Pixel for the public Suite CXO site. Rendered by the root layout
 * only on www.suitecxo.com in a browser (lib/whopPixel.ts cxoPixelHostAllowed);
 * here it loads only on the public selling pages and fires `page` on each
 * client-side route change to another selling page. Never `purchase`.
 */
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { cxoPixelPathAllowed } from '@/lib/whopPixel'
import { whopTrack } from '@/lib/whopPixelClient'

/**
 * `snippet` comes from the server layout (cxoWhopPixelSnippet()), so the
 * snippet and the business id are in the page's HTML, not only in a JS chunk:
 * curl and Whop's own installer check can see them.
 */
export default function WhopPixel({ snippet }: { snippet: string }) {
  const pathname = usePathname() || '/'
  const allowed = cxoPixelPathAllowed(pathname)
  // The path the snippet (or the last route change) already counted.
  const counted = useRef<string | null>(null)
  const loaded = useRef(false)
  if (allowed) loaded.current = true

  useEffect(() => {
    if (!allowed) return
    if (counted.current === null) {
      // First allowed page: the snippet's own whop.track("page") counts it.
      counted.current = pathname
      return
    }
    if (counted.current === pathname) return
    counted.current = pathname
    whopTrack('page')
  }, [allowed, pathname])

  // Not loaded until the visitor is on a selling page; once loaded it stays
  // (Next keeps the script), but only allowed paths ever fire.
  if (!loaded.current) return null
  return (
    <Script id="whop-pixel" strategy="afterInteractive">
      {snippet}
    </Script>
  )
}
