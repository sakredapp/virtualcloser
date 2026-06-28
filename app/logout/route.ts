import { redirect } from 'next/navigation'
import { clearSessionCookie } from '@/lib/client-auth'

export const dynamic = 'force-dynamic'

// Logout is a Route Handler, not a page. Clearing the session cookie mutates
// cookies, which Next only allows in a Server Action or Route Handler — doing it
// in a page render throws "Cookies can only be modified in a Server Action or
// Route Handler". Reached via <Link href="/logout"> (a GET navigation).
export async function GET() {
  await clearSessionCookie()
  redirect('/login')
}
