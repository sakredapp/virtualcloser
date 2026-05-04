import { requireMember } from '@/lib/tenant'
import { listShifts } from '@/lib/dialerHours'
import { listSalespeople } from '@/lib/ai-salesperson'
import ShiftsClient from './ShiftsClient'

export const dynamic = 'force-dynamic'

export default async function ShiftsPage() {
  const session = await requireMember()
  const { member, tenant } = session
  const [shifts, salespeople] = await Promise.all([
    listShifts(tenant.id, member.id),
    listSalespeople(tenant.id, { memberIds: [member.id] }),
  ])
  const tz = (member as { timezone?: string | null }).timezone ?? 'UTC'
  const agent = salespeople[0] ?? null
  const agentDisplayName = agent?.voice_persona?.ai_name || agent?.name || null
  const roleTitle = agent?.voice_persona?.role_title ?? null

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Dialing schedule</p>
        <h1>{agentDisplayName ? `When does ${agentDisplayName} clock in?` : 'Dialing shifts'}</h1>

        {agent ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '4px 12px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 999 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: agent.status === 'active' ? '#4ade80' : '#fbbf24', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              {agentDisplayName}{roleTitle ? ` · ${roleTitle}` : ''}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' }}>({agent.status})</span>
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '4px 12px', background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.5)', borderRadius: 999 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fef08a' }}>No AI voice agent assigned</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>— set one up in the Dialer tab first</span>
          </div>
        )}

        <p className="sub" style={{ marginTop: 10 }}>
          Pick the time windows your AI is allowed to dial. All times in your timezone ({tz}).
          Add as many windows per day as you like (e.g. 9–11am and 3–7pm). Outside these windows
          the dialer pauses — already-active calls always finish.
        </p>
      </header>

      <section style={{ marginTop: '0.8rem' }}>
        <ShiftsClient initialShifts={shifts} timezone={tz} />
      </section>
    </main>
  )
}
