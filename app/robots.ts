import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { robotsFor } from '@/lib/seo'

// Host-aware: only www.suitecxo.com is open to crawlers (with the sitemap).
// Company hosts, previews and roleplay.virtualcloser.com get "Disallow: /".
export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  return robotsFor(h.get('x-tenant-host') ?? h.get('host'))
}
