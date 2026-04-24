import { redirect } from 'next/navigation'
import { clearSessionCookie } from '@/lib/client-auth'

export const dynamic = 'force-dynamic'

export default async function LogoutPage() {
  await clearSessionCookie()
  redirect('/login')
}
