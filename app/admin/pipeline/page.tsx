import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function PipelinePage() {
  redirect('/admin/prospects?view=kanban')
}
