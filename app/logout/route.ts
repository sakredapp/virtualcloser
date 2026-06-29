import { redirect } from 'next/navigation'
import { clearSessionCookie } from '@/lib/client-auth'

export const dynamic = 'force-dynamic'

// Logout clears the session cookie. It's reached via <Link href="/logout"> (a GET
// navigation). CRITICAL: Next.js <Link> and browsers PREFETCH GET routes — a
// speculative prefetch of this route would silently clear the session just from
// rendering a page that links here, logging the user out on their next click
// (a site-wide "everyone keeps getting logged out" outage). So only clear on a
// REAL navigation; treat any prefetch as a no-op.
export async function GET(request: Request) {
  const h = request.headers
  const isPrefetch =
    h.get('next-router-prefetch') === '1' ||
    h.get('purpose') === 'prefetch' ||
    (h.get('sec-purpose') ?? '').includes('prefetch')
  if (isPrefetch) return new Response(null, { status: 204 })

  await clearSessionCookie()
  redirect('/login')
}
