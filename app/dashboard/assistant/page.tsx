import Link from 'next/link'
import { redirect } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import { getCurrentMember, getCurrentTenant } from '@/lib/tenant'
import { activeExecFor, recentActivity } from '@/lib/assistants'

export const dynamic = 'force-dynamic'

/** Names for the paths an assistant may be sent back from. */
const BLOCKED_NAMES: Array<[string, string]> = [
  ['/dashboard/plan', 'Sales Plan'],
  ['/dashboard/revenue', 'Revenue'],
  ['/dashboard/employees', 'Employees'],
  ['/dashboard/pinnacle', 'Team'],
  ['/dashboard/execs', 'Execs'],
  ['/dashboard/partners', 'Partners'],
  ['/dashboard/integrations', 'Integrations'],
  ['/dashboard/billing', 'Billing'],
  ['/dashboard/accounting', 'Accounting'],
  ['/dashboard/analytics', 'Analytics'],
]

/**
 * The assistant's home for their own seat: who they work for (with the
 * switcher), what they have done, and why a page sent them here.
 */
export default async function AssistantPage({ searchParams }: { searchParams?: Promise<{ blocked?: string }> }) {
  const sp = (await searchParams) ?? {}
  const tenant = await getCurrentTenant()
  if (!tenant) redirect('/login')
  const me = await getCurrentMember()
  if (!me) redirect('/login')
  if (me.role !== 'assistant') redirect('/dashboard/settings#assistant')

  const { active, links } = await activeExecFor(tenant.id, me.id)
  const activity = await recentActivity(tenant.id, { assistantId: me.id }, 25).catch(() => [])
  const execName = new Map(links.map((l) => [l.exec_member_id, l.exec_name.split(' ')[0]]))
  const tz = me.timezone || tenant.timezone || 'America/New_York'
  const when = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  const blocked = typeof sp.blocked === 'string' ? sp.blocked : null
  const blockedName = blocked ? (BLOCKED_NAMES.find(([p]) => blocked === p || blocked.startsWith(`${p}/`))?.[1] ?? 'That page') : null
  const first = (me.display_name || me.email).split(' ')[0]

  return (
    <main className="wrap cx-assist-page">
      <PageHeader eyebrow={`Assistant · ${first}`} title="Working for" subtitle="Whose calendar, boards, to-dos, messages and meetings you are working." />

      {blocked && (
        <section className="card cx-assist-blocked" role="alert" data-testid="assistant-blocked">
          <strong>{blockedName} is for {active ? active.exec_name.split(' ')[0] : 'the executive'} only.</strong>
          <span className="meta">Assistants work the calendar, boards, to-dos, messages and meetings. Pay, payroll, QuickBooks, Sales Plan numbers and usage stay with the executive.</span>
        </section>
      )}

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Executives</h2>
          <p>{links.length === 1 ? 'you assist one executive' : `you assist ${links.length} executives`}</p>
        </div>
        {links.length === 0 ? (
          <p className="meta" style={{ margin: 0 }}>No executive has you as their assistant right now.</p>
        ) : (
          <ul className="cx-ea-list">
            {links.map((l) => {
              const on = l.exec_member_id === active?.exec_member_id
              return (
                <li key={l.exec_member_id} className={on ? 'is-on' : ''}>
                  <div className="cx-ea-who">
                    <strong>{l.exec_name}</strong>
                    <span className="meta">{on ? 'Working for them now' : 'Switch to work for them'}</span>
                  </div>
                  {on ? (
                    <Link href="/dashboard" className="cx-btn cx-btn-sm">Open Today</Link>
                  ) : (
                    <form method="post" action="/api/assistant/switch">
                      <input type="hidden" name="exec" value={l.exec_member_id} />
                      <input type="hidden" name="return" value="/dashboard" />
                      <button type="submit" className="cx-btn cx-btn-sm cx-btn-ghost">Work for {l.exec_name.split(' ')[0]}</button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>What you did</h2>
          <p>shown to each executive as done by you for them</p>
        </div>
        {activity.length === 0 ? (
          <p className="meta" style={{ margin: 0 }}>Nothing yet.</p>
        ) : (
          <ul className="cx-ea-feed">
            {activity.map((r) => (
              <li key={r.id}>
                <span className="t">{when(r.created_at)}</span>
                <span className="n">{r.summary}</span>
                <span className="by">by {first} for {execName.get(r.exec_member_id) ?? 'a former executive'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
