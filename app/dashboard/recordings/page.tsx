import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** Recordings moved to Meetings. Old links keep working. */
export default function RecordingsPage() {
  redirect('/dashboard/meetings')
}
