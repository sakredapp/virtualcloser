import { redirect, notFound } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import {
  getCrmLead,
  getLeadNotes,
  getLeadEvents,
  getLeadCallLogs,
  getLeadTasks,
  getLeadSmsMessages,
} from '@/lib/crmLeads'
import { supabase } from '@/lib/supabase'
import ProspectDetail from './ProspectDetail'

export const dynamic = 'force-dynamic'

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    redirect('/login')
  }

  const { member } = ctx
  const { id } = await params

  const [lead, notes, events, calls, tasks, smsMessages, membersRes] = await Promise.all([
    getCrmLead(member.rep_id, id),
    getLeadNotes(member.rep_id, id),
    getLeadEvents(member.rep_id, id),
    getLeadCallLogs(member.rep_id, id),
    getLeadTasks(member.rep_id, id),
    getLeadSmsMessages(member.rep_id, id),
    supabase.from('members').select('id, display_name, email').eq('rep_id', member.rep_id),
  ])

  if (!lead) notFound()

  return (
    <ProspectDetail
      lead={lead}
      initialNotes={notes}
      events={events}
      calls={calls as any[]}
      tasks={tasks as any[]}
      smsMessages={smsMessages}
      members={(membersRes.data ?? []) as { id: string; display_name: string; email: string }[]}
      currentMemberId={member.id}
      repId={member.rep_id}
    />
  )
}
