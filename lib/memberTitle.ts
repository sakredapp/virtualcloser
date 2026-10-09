import type { MemberRole } from '@/types'

/**
 * The signed-in person's title for the rail header ("President", "CFO").
 * A stored title wins (members.settings.title); otherwise their role in
 * plain words. An assistant working as their exec is still an assistant.
 */
const ROLE_WORDS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Executive',
  manager: 'Manager',
  rep: 'Team member',
  observer: 'Viewer',
  assistant: 'Executive assistant',
}

export function memberTitle(member: {
  role?: string | null
  settings?: Record<string, unknown> | null
  acting_assistant?: unknown
}): string | null {
  if (member.acting_assistant) return ROLE_WORDS.assistant
  const raw = member.settings?.title
  if (typeof raw === 'string') {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (t) return t
  }
  const role = member.role as MemberRole | undefined
  return (role && ROLE_WORDS[role]) || null
}
