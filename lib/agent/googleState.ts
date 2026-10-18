/**
 * The caller's real Google connection, for the system prompt (QA 2026-10-18,
 * gap 6). Ciao used to guess: it said "ready to send" or offered to read the
 * inbox when nothing was connected. Now the prompt states the truth and says
 * what to do when it is missing: say so plainly, and still draft in chat.
 *
 * Same account rules as the tools: an employee only ever counts a Google
 * account they connected themselves, never a shared or coworker's box.
 */
import { pickCalendarAccount, pickSenderAccount } from '@/lib/partners'
import { inboxAllowed } from '@/lib/cxoFeatures'
import type { AgentContext } from './tools'

export type GoogleState = {
  /** null when this edition has no email feature at all. */
  mail: { connected: boolean; email: string | null } | null
  calendar: { connected: boolean; email: string | null }
}

type Picked = { account: { accountId: string; email: string; memberId: string | null; isShared?: boolean } | null; choices: Array<{ accountId: string; email: string; memberId: string | null; isShared?: boolean }> }

function ownPick(ctx: AgentContext, picked: Picked): string | null {
  if (!ctx.selfOnly) return picked.account?.email ?? null
  const own = picked.choices.filter((a) => a.memberId === ctx.caller.id && !a.isShared)
  return (own.find((a) => a.accountId === picked.account?.accountId) ?? own[0])?.email ?? null
}

export async function googleStateFor(ctx: AgentContext): Promise<GoogleState> {
  const withMail = inboxAllowed(ctx.tenant)
  const [mail, cal] = await Promise.all([
    withMail ? pickSenderAccount(ctx.tenant.id, ctx.caller.id).catch(() => null) : Promise.resolve(null),
    pickCalendarAccount(ctx.tenant.id, ctx.caller.id).catch(() => null),
  ])
  const mailEmail = mail ? ownPick(ctx, mail as Picked) : null
  const calEmail = cal ? ownPick(ctx, cal as Picked) : null
  return {
    mail: withMail ? { connected: Boolean(mailEmail), email: mailEmail } : null,
    calendar: { connected: Boolean(calEmail), email: calEmail },
  }
}

/** The prompt section. Pure, so the wording is pinned by tests. */
export function renderGoogleState(state: GoogleState): string {
  const lines: string[] = ['## Their Google connection (checked just now; trust this over any earlier message)']
  if (state.mail) {
    lines.push(
      state.mail.connected
        ? `- Email: connected as ${state.mail.email}. You can read their inbox and send as them (draft first, send only when they say so).`
        : '- Email: NOT connected. You cannot see their email or send as them. If they ask about their inbox or ask you to send, say plainly that Google is not connected yet and they can connect it on the Calendar page. Then still help: write the full email right here in chat for them to copy. Never say an email is ready to send, sent or queued.',
    )
  }
  lines.push(
    state.calendar.connected
      ? `- Calendar: connected as ${state.calendar.email}.`
      : '- Calendar: NOT connected. You cannot see their calendar or book anything on it. Say so plainly when it matters (they can connect Google on the Calendar page), then help another way, for example a suggested time or a draft invite they can send.',
  )
  return lines.join('\n')
}
