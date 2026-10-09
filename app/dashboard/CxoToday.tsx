import Link from 'next/link'
import PageHeader from '@/app/components/PageHeader'
import { supabase } from '@/lib/supabase'
import { listTodos, todaysMeetings, type Todo } from '@/lib/today'
import { cardsAssignedTo, ensureStarterBoard, type AssignedCard } from '@/lib/boards'
import TodayList from './TodayList'
import MessagesCard from './today/MessagesCard'
import { listMessages, messagesMissing } from '@/lib/memberMessages'
import { listReminders } from '@/lib/dueReminders'
import { getTokensForMember } from '@/lib/google'
import { pinnacleMonthToDate, type MonthToDate } from '@/lib/pinnacle/cache'
import { fmtMoney } from '@/lib/pinnacle/kpis'

/**
 * Today — the executive's home, kept lean: the to-do list (from meetings,
 * partners, boards and the exec), today's meetings one line each, and the
 * boards. No numbers here; Revenue has those.
 */
export default async function CxoToday({ tenantId, memberId, firstName, ownerName = null, timezone, showRevenue = false }: { tenantId: string; memberId: string; firstName: string | null; ownerName?: string | null; timezone: string; /** The viewer may see Revenue (not an assistant). */ showRevenue?: boolean }) {
  const tz = timezone || 'America/New_York'
  // The boards strip is never empty: the exec's premade To-do board is made on first visit.
  await ensureStarterBoard(tenantId, memberId).catch(() => false)
  const [todos, cards, meetings, boards, messages, reminders, google, mtd] = await Promise.all([
    listTodos(tenantId, memberId).catch(() => [] as Todo[]),
    cardsAssignedTo(tenantId, memberId).catch(() => [] as AssignedCard[]),
    todaysMeetings(tenantId, memberId, tz).catch(() => null),
    boardStrip(tenantId),
    listMessages(tenantId, memberId).catch((err) => {
      if (!messagesMissing(err)) console.error('[today] messages', err)
      return { inbox: [], sent: [], members: [] }
    }),
    listReminders(tenantId, memberId, tz).catch(() => []),
    getTokensForMember(tenantId, memberId).catch(() => null),
    showRevenue ? pinnacleMonthToDate(tenantId, tz).catch(() => null) : Promise.resolve(null),
  ])
  const googleOn = !!google
  const googleScopes = googleOn ? connectedScopes(google.scope) : []
  const needReply = googleOn ? await emailsNeedingReply(tenantId, memberId) : null
  const brief = morningBrief({ meetings: meetings ? meetings.length : null, needReply, mtd })
  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now)) % 24
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(now)
  const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()
  const nowMs = now.getTime()
  const openWith = meetings?.length ? await openItemsByAttendee(tenantId, meetings.flatMap((m) => m.attendees.map((a) => a.email))) : new Map<string, { name: string; open: number }>()

  return (
    <main className="wrap cx-today">
      <PageHeader eyebrow={`${firstName ? `${greeting}, ${firstName}` : greeting} · ${dateLabel}`} title="Today" subtitle={ownerName ? `${ownerName}'s to-dos, messages and meetings for today.` : 'Your to-dos, messages and meetings for today.'}>
        {googleOn ? (
          <p className="cx-hero-conn">
            <span className="dot" aria-hidden />
            Google connected{googleScopes.length > 0 && <> · {googleScopes.join(', ')}</>}
          </p>
        ) : (
          <p className="cx-hero-conn is-off">
            <a href="/api/google/oauth/start?return=%2Fdashboard">Google not connected · Connect</a>
          </p>
        )}
      </PageHeader>

      <div className="cx-today-pair">
        <TodayList initialTodos={todos} initialCards={cards} ownerName={ownerName ?? firstName} />
        <MessagesCard initial={{ ...messages, reminders }} timezone={tz} brief={brief} emailNeedReply={needReply} />
      </div>

      <section className="cx-today-strip" aria-labelledby="today-meetings">
        <p className="cx-eyebrow" id="today-meetings">
          <Link href="/dashboard/meetings">Meetings today</Link>
        </p>
        {meetings === null ? (
          <div className="cx-gconnect">
            <span>Connect Google to see today&rsquo;s meetings here.</span>
            <a className="cx-btn cx-btn-sm" href="/api/google/oauth/start?return=%2Fdashboard">Connect Google</a>
          </div>
        ) : meetings.length === 0 ? (
          <p className="cx-today-quiet">Nothing on the calendar today.</p>
        ) : (
          <ul className="cx-today-mtgs">
            {meetings.map((m) => {
              const past = !m.allDay && Date.parse(m.end) < nowMs
              const live = !m.allDay && Date.parse(m.start) <= nowMs && nowMs < Date.parse(m.end)
              const withOpen = past ? [] : m.attendees.map((a) => openWith.get(a.email)).filter((x): x is { name: string; open: number } => !!x && x.open > 0)
              return (
                <li key={m.id} className={past ? 'is-past' : live ? 'is-live' : ''}>
                  <Link href="/dashboard/meetings">
                    <span className="t">{m.allDay ? 'All day' : clock(m.start)}</span>
                    <span className="n">{m.title}</span>
                    {withOpen.length > 0 && (
                      <span className="open">
                        {withOpen.map((w) => `${w.open} open ${w.open === 1 ? 'item' : 'items'} with ${w.name.split(/\s+/)[0]}`).join(' · ')}
                      </span>
                    )}
                    {live && <span className="live">Now</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="cx-today-strip" aria-labelledby="today-boards">
        <p className="cx-eyebrow" id="today-boards">
          <Link href="/dashboard/boards">Boards</Link>
        </p>
        {boards.length === 0 ? (
          <p className="cx-today-quiet">
            No boards yet. <Link href="/dashboard/boards">Make one or import a board</Link>.
          </p>
        ) : (
          <ul className="cx-today-boards">
            {boards.map((b) => (
              <li key={b.id}>
                <Link href={`/dashboard/boards?board=${b.id}`}>
                  <span className="n">{b.name}</span>
                  <span className="c">{b.open} open</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

async function boardStrip(repId: string): Promise<Array<{ id: string; name: string; open: number }>> {
  const { data: boards, error } = await supabase.from('cxo_boards').select('id, name').eq('rep_id', repId).order('position').limit(8)
  if (error || !boards?.length) return []
  const { data: cards } = await supabase
    .from('cxo_board_cards')
    .select('board_id, cxo_board_lists(title)')
    .eq('rep_id', repId)
    .is('done_at', null)
    .in('board_id', boards.map((b) => b.id as string))
    .limit(5000)
  const open = new Map<string, number>()
  for (const c of (cards ?? []) as unknown as Array<{ board_id: string; cxo_board_lists: { title: string } | null }>) {
    if (/^done$|^complete/i.test(c.cxo_board_lists?.title?.trim() ?? '')) continue
    open.set(c.board_id, (open.get(c.board_id) ?? 0) + 1)
  }
  return (boards as Array<{ id: string; name: string }>).map((b) => ({ id: b.id, name: b.name, open: open.get(b.id) ?? 0 }))
}

/** Open to-dos and board cards tied to each meeting attendee who is a partner, by lowercased email. */
async function openItemsByAttendee(repId: string, emails: string[]): Promise<Map<string, { name: string; open: number }>> {
  const out = new Map<string, { name: string; open: number }>()
  const uniq = [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 200)
  if (!uniq.length) return out
  const { data: partners } = await supabase.from('cxo_partners').select('id, name, email').eq('rep_id', repId).in('email', uniq)
  const list = (partners ?? []) as Array<{ id: string; name: string; email: string | null }>
  if (!list.length) return out
  const ids = list.map((p) => p.id)
  const idList = ids.join(',')
  const [{ data: todos }, { data: cards }] = await Promise.all([
    supabase
      .from('cxo_todos')
      .select('partner_id, assignee_partner_id, link_id, link_kind')
      .eq('rep_id', repId)
      .is('done_at', null)
      .or(`partner_id.in.(${idList}),assignee_partner_id.in.(${idList}),link_id.in.(${idList})`)
      .limit(2000),
    supabase.from('cxo_board_card_assignees').select('partner_id, cxo_board_cards!inner(done_at)').eq('rep_id', repId).in('partner_id', ids).is('cxo_board_cards.done_at', null).limit(2000),
  ])
  const count = new Map<string, number>()
  for (const t of (todos ?? []) as Array<{ partner_id: string | null; assignee_partner_id: string | null; link_id: string | null; link_kind: string | null }>) {
    const who = new Set([t.partner_id, t.assignee_partner_id, t.link_kind === 'partner' ? t.link_id : null].filter((x): x is string => !!x && ids.includes(x)))
    for (const w of who) count.set(w, (count.get(w) ?? 0) + 1)
  }
  for (const c of (cards ?? []) as Array<{ partner_id: string }>) count.set(c.partner_id, (count.get(c.partner_id) ?? 0) + 1)
  for (const p of list) if (p.email) out.set(p.email.toLowerCase(), { name: p.name, open: count.get(p.id) ?? 0 })
  return out
}

/** Gmail / Calendar, from the scopes the member actually granted. */
function connectedScopes(scope: string | null): string[] {
  const s = (scope ?? '').toLowerCase()
  const out: string[] = []
  if (s.includes('gmail')) out.push('Gmail')
  if (s.includes('calendar')) out.push('Calendar')
  return out
}

/** The member's own inbox: threads Mira triaged as needing a reply, not yet drafted, not noise. */
async function emailsNeedingReply(repId: string, memberId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('owner_member_id', memberId)
    .eq('needs_reply', true)
    .in('status', ['new', 'triaged'])
    .or('priority.is.null,priority.neq.noise')
  if (error) return null
  return count ?? 0
}

/**
 * Mira's morning brief: built from numbers this page already has, no AI call.
 * A line whose data is missing is left out; nothing is guessed.
 */
function morningBrief({ meetings, needReply, mtd }: { meetings: number | null; needReply: number | null; mtd: MonthToDate | null }): string[] {
  const first: string[] = []
  if (meetings !== null) first.push(meetings === 0 ? 'No meetings today' : `${meetings} ${meetings === 1 ? 'meeting' : 'meetings'} today`)
  if (needReply !== null) first.push(needReply === 0 ? 'no emails waiting on a reply' : `${needReply} ${needReply === 1 ? 'email needs' : 'emails need'} a reply`)
  const lines: string[] = []
  if (first.length) {
    const t = first.join(', ')
    lines.push(`${t.charAt(0).toUpperCase()}${t.slice(1)}.`)
  }
  if (mtd) lines.push(`${mtd.monthName} is at ${fmtMoney(mtd.premium)} submitted through ${mtd.monthShort} ${mtd.throughDay}.`)
  return lines
}
