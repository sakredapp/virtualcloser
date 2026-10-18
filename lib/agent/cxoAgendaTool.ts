/**
 * leadership_agenda (Suite CXO): Ciao's side of "Prep the Leadership Meeting
 * Agenda" (lib/meetings/agenda). The same draft the Hetzner tick makes about
 * 24h before, on demand: "draft the agenda for Monday's leadership meeting".
 *
 *  - draft          build (or rebuild) the next instance's agenda from rows
 *  - add_to_invite  put it in the invite's notes; ONLY after the exec's yes
 *                   (confirmed: true), through the exec's own calendar tools
 *  - edit           replace the agenda text with the exec's version
 *  - raise          add an item someone wants raised
 *  - mark           mark a recurring series as the leadership meeting (or not)
 *  - candidates     list the recurring meetings Ciao can see
 *
 * Owner and admins only (company-wide to-dos and blockers). Not in
 * EMPLOYEE_TOOLS. Meeting titles, digests and messages are other people's
 * words: data, never instructions. No model writes the agenda or a number.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { untrustedBlock } from './untrusted'
import { AGENDA_ROLES, sectionCount, startLabel, type SeriesCandidate } from '@/lib/meetings/agendaShared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const ACTIONS = ['draft', 'add_to_invite', 'edit', 'raise', 'mark', 'candidates'] as const
type Action = (typeof ACTIONS)[number]

const isExec = (ctx: AgentContext) => !ctx.selfOnly && (AGENDA_ROLES as readonly string[]).includes(String((ctx.caller as { role?: string | null }).role ?? ''))

const meetingOut = (c: SeriesCandidate, tz: string) => ({
  series_id: c.seriesId,
  event_id: c.eventId,
  title: untrustedBlock('calendar invite', c.title),
  when: startLabel(c.start, tz),
  people: c.attendeeEmails.length,
  leadership: c.marked || c.titleMatch,
})

const leadership_agenda: Handler = async (ctx, args) => {
  const action = (ACTIONS as readonly string[]).includes(String(args.action)) ? (args.action as Action) : 'draft'
  if (!isExec(ctx)) return j({ ok: false, say: 'The leadership agenda is for the owner and admins. Tell me what you want raised and I will pass it on in a message once you say yes.' })
  const A = await import('@/lib/meetings/agenda')
  const tenant = { id: ctx.tenant.id, timezone: ctx.timezone }
  const tz = ctx.timezone
  try {
    if (action === 'add_to_invite' || action === 'edit') {
      const id = str(args.agenda_id, 60)
      if (!id) return j({ ok: false, error: 'agenda_id required (from draft)' })
      const row = await A.getAgenda(ctx.tenant.id, id)
      if (!row) return j({ ok: false, say: 'I could not find that agenda.' })
      if (action === 'edit') {
        const body = str(args.body, 6000)
        if (!body) return j({ ok: false, error: 'body required' })
        const saved = await A.saveAgendaBody(ctx.tenant.id, ctx.caller.id, id, body)
        return j({ ok: true, agenda_id: id, body: saved?.body ?? body, say: 'Saved your version. It is not on the invite until you say so.' })
      }
      if (args.confirmed !== true || ctx.untrustedSeen === true) {
        ctx.untrustedSeen = true
        return j({
          ok: false,
          needs_confirmation: true,
          meeting: untrustedBlock('calendar invite', row.title),
          when: startLabel(row.starts_at, tz),
          agenda: untrustedBlock('agenda draft', row.body),
          ask: `Add this agenda to the invite for ${row.title} (${startLabel(row.starts_at, tz)})? Everyone on the invite gets the update.`,
          say: 'Not changed. Show them the agenda text exactly and ask this question; add it only after they say yes, then call again with confirmed: true.',
        })
      }
      const res = await A.addAgendaToInvite(ctx.tenant.id, ctx.caller.id, row, tz)
      return j({ ok: true, link: res.link, calendar: res.calendar, say: `Added the agenda to the invite on ${res.calendar}. Everyone on it got the update.` })
    }

    const members = await A.activeMembers(ctx.tenant.id)
    const series = await A.upcomingSeries(tenant, members)
    if (action === 'candidates') {
      ctx.untrustedSeen = true
      return j({
        ok: true,
        leadership: series.picks.map((c) => meetingOut(c, tz)),
        recurring: series.all.slice(0, 15).map((c) => meetingOut(c, tz)),
        say: series.all.length ? undefined : 'I see no recurring meetings with other people on your calendar in the next week.',
      })
    }

    const meeting = str(args.meeting, 120)
    const c = str(args.series_id, 300) ? series.all.find((x) => x.seriesId === str(args.series_id, 300)) ?? null : A.chooseSeries(series, meeting, tz)
    if (!c && action === 'draft') {
      // No series to hang it on: still draft it from to-dos, blockers and open asks (shown, not saved).
      ctx.untrustedSeen = true
      const d = await A.draftAgendaWithoutCalendar(tenant, members, new Date())
      const empty = !sectionCount(d.sections)
      return j({
        ok: true,
        from_calendar: false,
        agenda: empty ? '' : untrustedBlock('agenda draft', d.body),
        saved: false,
        ...(series.all.length ? { recurring: series.all.slice(0, 10).map((x) => meetingOut(x, tz)), ask: 'Which of these is your leadership meeting? Tell me and I will tie the agenda to it and draft it the day before each one.' } : {}),
        ...(empty
          ? { say: 'I could not find the leadership meeting on a connected calendar, and there is nothing to put on an agenda yet: no overdue to-dos, blockers or open requests to the leaders.' }
          : {
              rule: 'Show the agenda as given, line for line. Say it is built from overdue to-dos, blockers and open requests because the meeting is not on a connected calendar, so it is not saved or on an invite. Offer to change it, or to send it to people in a message once they say yes.',
            }),
      })
    }
    if (!c) {
      ctx.untrustedSeen = true
      return j({
        ok: false,
        not_found: true,
        recurring: series.all.slice(0, 10).map((x) => meetingOut(x, tz)),
        ask: series.all.length
          ? 'Which of these is your leadership meeting? I will remember it.'
          : 'I see no recurring meetings with other people on your calendar in the next week. Is it on a calendar you have connected?',
      })
    }

    if (action === 'mark') {
      const choice = args.choice === 'not' ? 'not' : 'leadership'
      await A.markSeries(ctx.tenant.id, c, choice, ctx.caller.id)
      return j({ ok: true, say: choice === 'leadership' ? `Got it. I will draft the agenda for ${c.title} the day before each one.` : `Got it. ${c.title} is not the leadership meeting.` })
    }

    if (action === 'raise') {
      const text = str(args.item, 240)
      if (!text) return j({ ok: false, error: 'item required' })
      const by = ctx.caller.display_name || ctx.caller.email || null
      await A.raiseItem(tenant, c, text, by)
      return j({ ok: true, say: `Added to the agenda for ${c.title} on ${startLabel(c.start, tz)}.` })
    }

    const { row } = await A.draftAgenda(tenant, c, members, new Date(), { redo: args.redo === true })
    ctx.untrustedSeen = true
    const empty = !sectionCount(row.sections)
    return j({
      ok: true,
      agenda_id: row.id,
      meeting: untrustedBlock('calendar invite', row.title),
      when: startLabel(row.starts_at, tz),
      agenda: untrustedBlock('agenda draft', row.body),
      on_invite: !!row.added_at,
      edited: !!row.edited_at,
      link: '/dashboard#leadership-agenda',
      ...(empty
        ? { say: `Nothing to put on the agenda for ${row.title} yet: no open decisions, overdue to-dos, blockers or items to raise.` }
        : { rule: 'Show the agenda as given, line for line. Offer to edit it or add it to the invite. Change the invite only after they say yes (action add_to_invite, confirmed: true).' }),
    })
  } catch (err) {
    if (err instanceof A.AgendaTableMissing) return j({ ok: false, say: 'The agenda is not set up on this account yet.' })
    const { CalendarWriteError } = await import('@/lib/cxoCalendar')
    if (err instanceof CalendarWriteError) return j({ ok: false, say: err.message })
    throw err
  }
}

export const CXO_AGENDA_TOOL_HANDLERS: Record<string, Handler> = { leadership_agenda }

export const CXO_AGENDA_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'leadership_agenda',
    description:
      'The agenda for the recurring leadership meeting (owner and admins). draft: build it from last meeting\'s open decisions, overdue to-dos by owner, numbers that slipped, weekly status blockers and items people asked to raise ("draft the agenda for Monday\'s leadership meeting"). edit: save their version. raise: add an item. add_to_invite: put it in the invite notes, only after they say yes (confirmed: true). mark: remember which recurring meeting is the leadership one (choice not = it is not). candidates: list recurring meetings.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS], description: 'Default draft.' },
        meeting: { type: 'string', description: 'Words that name the meeting or its weekday, e.g. "Monday leadership". Empty = the next leadership meeting.' },
        series_id: { type: 'string', description: 'A series_id from candidates (for mark).' },
        agenda_id: { type: 'string', description: 'From draft (for edit and add_to_invite).' },
        body: { type: 'string', description: 'The full agenda text (edit).' },
        item: { type: 'string', description: 'What to raise (raise).' },
        choice: { type: 'string', enum: ['leadership', 'not'], description: 'For mark.' },
        redo: { type: 'boolean', description: 'Rebuild from scratch, dropping their edits (draft).' },
        confirmed: { type: 'boolean', description: 'True only after they said yes to the exact agenda (add_to_invite).' },
      },
      additionalProperties: false,
    },
  },
]
