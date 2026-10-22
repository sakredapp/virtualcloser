'use server'

/**
 * Settings › Your assistant: an exec adds or removes their own assistant.
 * The assistant gets their own login (role 'assistant') linked to this exec
 * and sets their own password from a link (the reset-password flow, 7 days).
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { addExecAssistant, removeExecAssistant } from '@/lib/team/execAssistants'

const back = (q: Record<string, string>) => redirect('/dashboard/settings?' + new URLSearchParams(q).toString() + '#assistant')

export async function actionAddExecAssistant(fd: FormData): Promise<void> {
  const { tenant, member } = await requireMember()
  const r = await addExecAssistant(tenant, member, { email: fd.get('email'), displayName: fd.get('display_name'), sendEmail: fd.get('send_email') === 'on' })
  if (!r.ok) back({ ea_error: r.error })
  else {
    revalidatePath('/dashboard/settings')
    back(r.emailed ? { ea_added: r.email, ea_sent: '1' } : { ea_added: r.email })
  }
}

/** Remove (deactivate) an assistant from this exec. Their login stays on only while another exec still has them. */
export async function actionRemoveExecAssistant(fd: FormData): Promise<void> {
  const { tenant, member } = await requireMember()
  const r = await removeExecAssistant(tenant, member, fd.get('assistant_id'))
  if (!r.ok) back({ ea_error: r.error })
  else {
    revalidatePath('/dashboard/settings')
    back({ ea_removed: r.email })
  }
}
