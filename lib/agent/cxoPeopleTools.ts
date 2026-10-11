/**
 * Mira's praise and 1:1 tools (Suite CXO), owner 10-11.
 *
 *  - give_praise        "praise Dana for closing the carrier contract"   (write)
 *  - list_one_on_ones   "when is my next 1:1", "who is overdue for a 1:1" (read)
 *  - add_talking_point  "add pipeline review to my 1:1 with Dana"         (write)
 *
 * For execs and employee logins alike: every call goes through lib/people,
 * which scopes it to the caller's org and to the people they may see (an
 * employee: themself; a manager: their reports; owner/admin: everyone).
 * Data-minimisation (owner 10-09): no pay, no client names, and never the
 * contents of a 1:1 (agenda, notes, private feedback) in what goes back to
 * the model: names of employees, dates and counts only.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { matchEmployee } from '@/lib/employees/shared'
import { recordUsage } from '@/lib/cxoUsage'
import { actionKey } from '@/lib/cxoAdoptionShared'
import { loadPeopleHub, runPeopleAction, viewerFor } from '@/lib/people/data'
import { CADENCE_WORDS, PeopleRefused, type PeopleHubData } from '@/lib/people/shared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const callerName = (ctx: AgentContext) => (ctx.caller.display_name || '').trim() || ctx.caller.email

async function hub(ctx: AgentContext): Promise<{ data: PeopleHubData; who: Parameters<typeof runPeopleAction>[0] }> {
  const viewer = await viewerFor(ctx.tenant, ctx.caller)
  const data = await loadPeopleHub(ctx.tenant, ctx.caller, ctx.todayIso, viewer)
  return { data, who: { viewer, name: callerName(ctx), tz: ctx.timezone } }
}

function pick<T extends { id: string; name: string }>(people: T[], who: string, none: string): { one: T } | { result: ToolHandlerResult } {
  const { match, candidates } = matchEmployee(people, who)
  if (match) return { one: match }
  if (candidates.length > 1) {
    return { result: j({ ok: false, ambiguous: true, say: `More than one person matches "${who}". Which one?`, candidates: candidates.slice(0, 8).map((c) => c.name) }) }
  }
  return { result: j({ ok: false, say: none }) }
}

const refused = (err: unknown): ToolHandlerResult => {
  if (err instanceof PeopleRefused) return j({ ok: false, say: err.message })
  console.error('[mira people]', err instanceof Error ? err.message : err)
  return j({ ok: false, say: 'That did not save. Nothing was changed.' })
}

const give_praise: Handler = async (ctx, args) => {
  const person = str(args.person)
  const note = str(args.note, 600)
  if (!person || !note) return j({ ok: false, say: 'Who is it for, and what did they do well?' })
  try {
    const { data, who } = await hub(ctx)
    if (!data.ready) return j({ ok: false, say: 'Praise is still being switched on for your company.' })
    const hit = pick(data.directory, person, `No employee called "${person}".`)
    if ('result' in hit) return hit.result
    const wanted = str(args.value, 60).toLowerCase()
    const value = wanted ? data.values.find((v) => v.toLowerCase() === wanted) ?? null : null
    await runPeopleAction(who, { action: 'praise', to_employee_id: hit.one.id, body: note, value })
    await recordUsage({ tenant: ctx.tenant, member: ctx.caller }, actionKey('praise_given'))
    return j({ ok: true, praised: hit.one.name, value, say: `Posted praise for ${hit.one.name}. The whole company can see it.` })
  } catch (err) {
    return refused(err)
  }
}

const list_one_on_ones: Handler = async (ctx, args) => {
  try {
    const { data } = await hub(ctx)
    if (!data.ready) return j({ ok: true, one_on_ones: [], say: '1:1s are still being switched on for your company.' })
    const rows = data.people
      .map((p) => ({
        person: p.name,
        mine: p.is_self,
        set_up: !!p.one_on_one,
        with: p.one_on_one?.manager_name ?? null,
        cadence: p.one_on_one ? CADENCE_WORDS[p.one_on_one.cadence] : null,
        next_date: p.one_on_one?.next_date ?? null,
        last_date: p.one_on_one?.last_date ?? null,
        overdue: !!p.one_on_one?.overdue,
        open_talking_points: (p.one_on_one?.items ?? []).filter((i) => i.kind === 'agenda' && !i.done_at).length,
      }))
      .filter((r) => (args.overdue_only === true ? r.overdue : true))
    return j({ ok: true, today: data.today, count: rows.length, one_on_ones: rows.slice(0, 60) })
  } catch (err) {
    return refused(err)
  }
}

const add_talking_point: Handler = async (ctx, args) => {
  const point = str(args.point, 500)
  if (!point) return j({ ok: false, say: 'What is the talking point?' })
  try {
    const { data, who } = await hub(ctx)
    if (!data.ready) return j({ ok: false, say: '1:1s are still being switched on for your company.' })
    const person = str(args.person)
    let target = person ? null : data.people.find((p) => p.is_self) ?? null
    if (person) {
      const hit = pick(data.people, person, `You have no 1:1 with anyone called "${person}".`)
      if ('result' in hit) return hit.result
      target = hit.one
    }
    if (!target) return j({ ok: false, say: 'Whose 1:1 is it for?' })
    if (!target.one_on_one) return j({ ok: false, say: `There is no 1:1 set up with ${target.is_self ? 'your manager' : target.name} yet.` })
    await runPeopleAction(who, { action: 'item_add', employee_id: target.id, kind: 'agenda', body: point })
    return j({ ok: true, say: `Added to the agenda for ${target.is_self ? 'your 1:1' : `your 1:1 with ${target.name}`}.`, next_date: target.one_on_one.next_date })
  } catch (err) {
    return refused(err)
  }
}

export const CXO_PEOPLE_TOOL_HANDLERS: Record<string, Handler> = { give_praise, list_one_on_ones, add_talking_point }

export const CXO_PEOPLE_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'give_praise',
    description: 'Post praise for a colleague to the company praise feed (everyone in the company sees it; the person gets an in-app notice). Use when the user says "praise X for ...", "give X a shout-out", "thank X for ...". Never for the user themself.',
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'The colleague, as the user says the name.' },
        note: { type: 'string', description: 'What they did well, one or two sentences in the words the user used.' },
        value: { type: 'string', description: 'Optional company value it shows (e.g. Ownership, Teamwork). Leave out unless the user names one.' },
      },
      required: ['person', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_one_on_ones',
    description: 'The 1:1s the user is part of: their own, and for a manager or admin the people they run 1:1s with. Returns who, how often, last and next date, and whether it is overdue. Use for "when is my next 1:1", "who is overdue for a 1:1", "who have I not met with". Never returns what was said in a 1:1.',
    input_schema: {
      type: 'object',
      properties: { overdue_only: { type: 'boolean', description: 'True to list only overdue 1:1s.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'add_talking_point',
    description: 'Add a talking point to the shared agenda of a 1:1. Leave person out for the 1:1 the user has with their own manager; give a name for a 1:1 with someone who reports to them.',
    input_schema: {
      type: 'object',
      properties: {
        point: { type: 'string', description: 'The talking point, short.' },
        person: { type: 'string', description: 'Whose 1:1, when it is not the one the user has with their own manager.' },
      },
      required: ['point'],
      additionalProperties: false,
    },
  },
]
