import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { listCrmLeads } from '@/lib/crmLeads'
import { supabase } from '@/lib/supabase'
import ProspectsClient from './ProspectsClient'

export const dynamic = 'force-dynamic'

export default async function ProspectsPage() {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    redirect('/login')
  }

  const { member } = ctx

  const [leads, membersResult] = await Promise.all([
    listCrmLeads(member.rep_id),
    supabase.from('members').select('id, display_name, email').eq('rep_id', member.rep_id),
  ])

  return (
    <ProspectsClient
      initialLeads={leads}
      members={(membersResult.data ?? []) as { id: string; display_name: string; email: string }[]}
      currentMemberId={member.id}
      repId={member.rep_id}
    />
  )
}
