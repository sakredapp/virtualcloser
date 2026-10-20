import { redirect, unstable_rethrow } from 'next/navigation'
import { getCurrentBrand } from '@/lib/brand'
import { requireMember } from '@/lib/tenant'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import CiaoChat from './CiaoChat'

export const dynamic = 'force-dynamic'

/** Three at most (owner 2026-10-19): what an exec asks their chief of staff first. */
const EXEC_STARTERS = ["What's on my plate today?", 'Prep my next meeting', 'Summarize this week']
const EMPLOYEE_STARTERS = ["What's on my calendar today?", 'What are my to-dos?', 'Any messages for me?']

/**
 * Ciao, full screen: past chats on the left, one conversation in the middle.
 * The same conversation as the bar at the foot of every page (POST
 * /api/mira/ask); this is only a roomier view of it. Suite CXO only, and not
 * for an exec's assistant (they get no Ciao bar either).
 */
export default async function CiaoPage() {
  const brand = await getCurrentBrand()
  if (brand.key !== 'cxo') redirect('/dashboard')
  let ctx
  try {
    ctx = await requireMember()
  } catch (err) {
    unstable_rethrow(err)
    redirect('/login')
  }
  const { member, tenant } = ctx
  if (member.role === 'assistant' || member.acting_assistant) redirect('/dashboard')
  const name = member.display_name || member.email.split('@')[0]
  const employee = isEmployeeOnlyMember(member, tenant)
  return (
    <CiaoChat
      firstName={name.split(' ')[0] || undefined}
      userName={name}
      userEmail={member.email}
      starters={employee ? EMPLOYEE_STARTERS : EXEC_STARTERS}
    />
  )
}
