import { cxoLlmsTxt, isCxoMarketingHost } from '@/lib/seo'

// /llms.txt for AI answer engines, on the public Suite CXO site only. Built
// from the site's own copy (lib/seo.ts). Every other host gets a 404.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const host = req.headers.get('x-tenant-host') ?? req.headers.get('host')
  if (!isCxoMarketingHost(host)) return new Response('Not found', { status: 404 })
  return new Response(cxoLlmsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
