import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default async function AdminHome() {
  if (!(await isAdminAuthed())) redirect('/admin/login')
  redirect('/admin/pipeline')
  // unreachable
  return (
    <main>
      <Link href="/admin/pipeline">Pipeline</Link>
    </main>
  )
}
