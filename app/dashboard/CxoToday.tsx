import Link from 'next/link'
import PageHeader from '@/app/components/PageHeader'
import { supabase } from '@/lib/supabase'
import { listTodos, todaysMeetings, type Todo } from '@/lib/today'
import { cardsAssignedTo, type AssignedCard } from '@/lib/boards'
import TodayList from './TodayList'

/**
 * Today — the executive's home, kept lean: the to-do list (from meetings,
 * partners, boards and the exec), today's meetings one line each, and the
 * boards. No numbers here; Revenue has those.
 */
export default async function CxoToday({ tenantId, memberId, firstName, timezone }: { tenantId: string; memberId: string; firstName: string | null; timezone: string }) {
  const tz = timezone || 'America/New_York'
  const [todos, cards, meetings, boards] = await Promise.all([
    listTodos(tenantId, memberId).catch(() => [] as Todo[]),
    cardsAssignedTo(tenantId, memberId).catch(() => [] as AssignedCard[]),
    todaysMeetings(tenantId, memberId, tz).catch(() => null),
    boardStrip(tenantId),
  ])
  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now)) % 24
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(now)
  const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()
  const nowMs = now.getTime()

  return (
    <main className="wrap cx-today">
      <PageHeader eyebrow={firstName ? `${greeting}, ${firstName}` : greeting} title="Today" subtitle={dateLabel} />

      <TodayList initialTodos={todos} initialCards={cards} />

      <section className="cx-today-strip" aria-labelledby="today-meetings">
        <p className="cx-eyebrow" id="today-meetings">
          <Link href="/dashboard/meetings">Meetings today</Link>
        </p>
        {meetings === null ? (
          <p className="cx-today-quiet">
            Calendar not connected. <Link href="/dashboard/integrations">Connect Google</Link> and today&rsquo;s meetings line up here.
          </p>
        ) : meetings.length === 0 ? (
          <p className="cx-today-quiet">Nothing on the calendar today.</p>
        ) : (
          <ul className="cx-today-mtgs">
            {meetings.map((m) => {
              const past = !m.allDay && Date.parse(m.end) < nowMs
              const live = !m.allDay && Date.parse(m.start) <= nowMs && nowMs < Date.parse(m.end)
              return (
                <li key={m.id} className={past ? 'is-past' : live ? 'is-live' : ''}>
                  <Link href="/dashboard/meetings">
                    <span className="t">{m.allDay ? 'All day' : clock(m.start)}</span>
                    <span className="n">{m.title}</span>
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
