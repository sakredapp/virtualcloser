import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { sitemapFor } from '@/lib/seo'

// Host-aware: the public marketing pages on www.suitecxo.com, empty anywhere else.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers()
  return sitemapFor(h.get('x-tenant-host') ?? h.get('host'))
}
