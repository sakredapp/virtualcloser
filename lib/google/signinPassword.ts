/**
 * Retire an emailed starting password when the member's first login is
 * Sign in with Google (the rule is retiresStartingPassword in ./signin).
 *
 * Only the exact hash read at sign-in is cleared, so a password the person
 * set in the meantime is never wiped. The owner's rep row carries the same
 * starting password (the legacy login checks it), so it is cleared too, but
 * only when it is that same hash.
 */
import { supabase } from '@/lib/supabase'
import { retiresStartingPassword } from './signin'

export async function retireStartingPassword(
  member: { id: string; rep_id: string; role?: string | null; last_login_at?: string | null; password_hash?: string | null },
): Promise<boolean> {
  if (!retiresStartingPassword(member)) return false
  const hash = member.password_hash as string
  await supabase.from('members').update({ password_hash: null }).eq('id', member.id).eq('password_hash', hash)
  if (member.role === 'owner') {
    await supabase.from('reps').update({ password_hash: null }).eq('id', member.rep_id).eq('password_hash', hash)
  }
  return true
}
